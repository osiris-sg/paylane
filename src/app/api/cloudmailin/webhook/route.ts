import { NextRequest, NextResponse } from "next/server";
import { db } from "~/lib/db";
import { env } from "~/env";
import {
  extractInvoiceForIngestion,
  mediaTypeFromFilename,
  type SupportedMediaType,
} from "~/lib/extract-invoice";
import { sendPushToCompany } from "~/lib/push-notifications";

// CloudMailin payloads can include multi-MB PDF attachments. Increase the body size limit
// and run on Node (not Edge) so we have access to the Anthropic SDK and Prisma.
export const runtime = "nodejs";
export const maxDuration = 60;

function verifyBasicAuth(req: NextRequest): boolean {
  const expectedUser = env.CLOUDMAILIN_BASIC_AUTH_USER;
  const expectedPass = env.CLOUDMAILIN_BASIC_AUTH_PASSWORD;
  const header = req.headers.get("authorization");

  // Debug logging — booleans + lengths only, never the actual secret.
  // Remove once auth issues are resolved.
  const debug = {
    hasExpectedUser: !!expectedUser,
    hasExpectedPass: !!expectedPass,
    expectedUserLen: expectedUser?.length ?? 0,
    expectedPassLen: expectedPass?.length ?? 0,
    hasAuthHeader: !!header,
    authPrefix: header?.slice(0, 6) ?? null,
    receivedUser: "",
    receivedUserLen: 0,
    receivedPassLen: 0,
    userMatches: false,
    passMatches: false,
  };

  if (!expectedUser || !expectedPass) {
    console.warn("[cloudmailin] auth fail — env not configured", debug);
    return false;
  }
  if (!header?.startsWith("Basic ")) {
    console.warn("[cloudmailin] auth fail — missing Basic header", debug);
    return false;
  }

  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf-8");
  const idx = decoded.indexOf(":");
  if (idx < 0) {
    console.warn("[cloudmailin] auth fail — malformed Basic payload", debug);
    return false;
  }
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  debug.receivedUser = user; // username is non-secret
  debug.receivedUserLen = user.length;
  debug.receivedPassLen = pass.length;
  debug.userMatches = user === expectedUser;
  debug.passMatches = pass === expectedPass;

  const ok = debug.userMatches && debug.passMatches;
  if (!ok) {
    console.warn("[cloudmailin] auth fail — mismatch", debug);
  } else {
    console.log("[cloudmailin] auth ok", { receivedUser: user });
  }
  return ok;
}

// Pull the company-routing token out of a "to" address.
// CloudMailin catch-all `xyz@cloudmailin.net` accepts plus-addressing:
// `xyz+co_<companyId>@cloudmailin.net` → token = `co_<companyId>`.
function extractInboundToken(toAddress: string | null | undefined): string | null {
  if (!toAddress) return null;
  // toAddress may be "Name <email>" or just "email"
  const match = toAddress.match(/<([^>]+)>/);
  const email = (match ? match[1] : toAddress).trim().toLowerCase();
  const local = email.split("@")[0];
  if (!local) return null;
  const plus = local.indexOf("+");
  if (plus < 0) return null;
  return local.slice(plus + 1);
}

// CloudMailin "Multipart Normalized" sends bracket-notation fields with
// lowercase snake_case keys: headers[subject], headers[message_id], envelope[to], ...
// We accept several casings of each key for robustness.
function readField(form: FormData, key: string): string | null {
  const v = form.get(key);
  return typeof v === "string" ? v : null;
}

function readBracketField(form: FormData, root: string, ...keyCandidates: string[]): string | null {
  for (const k of keyCandidates) {
    const v = form.get(`${root}[${k}]`);
    if (typeof v === "string") return v;
  }
  // Fall back to a JSON-stringified `<root>` field in case the format is switched to JSON Normalized.
  const raw = form.get(root);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const k of keyCandidates) {
        const v = parsed?.[k];
        if (typeof v === "string") return v;
        if (Array.isArray(v) && typeof v[0] === "string") return v[0];
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (!verifyBasicAuth(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    console.error("[cloudmailin] failed to parse multipart:", err);
    return new NextResponse("Bad request", { status: 400 });
  }

  const toAddress =
    readBracketField(formData, "envelope", "to") ??
    readField(formData, "envelope[recipients][]") ??
    readField(formData, "envelope[recipients][0]") ??
    readBracketField(formData, "headers", "to", "To");
  const fromAddress =
    readBracketField(formData, "envelope", "from") ??
    readBracketField(formData, "headers", "from", "From") ??
    "unknown@unknown";
  const subject = readBracketField(formData, "headers", "subject", "Subject");
  const messageId = readBracketField(
    formData,
    "headers",
    "message_id",
    "Message-ID",
    "Message-Id",
  );
  const plainBody = readField(formData, "plain");
  const htmlBody = readField(formData, "html");

  const inboundToken = extractInboundToken(toAddress);
  console.log("[cloudmailin] routing", { toAddress, inboundToken, fromAddress, subject });

  if (!inboundToken) {
    console.warn("[cloudmailin] no inbound token in to-address:", toAddress);
    // Still return 200 so CloudMailin doesn't retry — we just can't route this.
    return NextResponse.json({ ok: true, ignored: "no_token" });
  }

  const integration = await db.emailIntegration.findUnique({
    where: { inboundToken },
    include: { company: true },
  });

  if (!integration) {
    const allTokens = await db.emailIntegration.findMany({
      select: { inboundToken: true, companyId: true },
    });
    console.warn("[cloudmailin] unknown inbound token:", inboundToken, "known:", allTokens);
    return NextResponse.json({ ok: true, ignored: "unknown_token", got: inboundToken });
  }

  console.log("[cloudmailin] matched integration", { companyId: integration.companyId });

  // Dedup by Message-ID if we have one
  if (messageId) {
    const existing = await db.ingestedEmail.findUnique({ where: { messageId } });
    if (existing) {
      return NextResponse.json({ ok: true, ignored: "duplicate", ingestedEmailId: existing.id });
    }
  }

  // Forwarding-confirmation emails from Gmail/Outlook — extract code + link and surface in UI.
  const confirmation = detectForwardingConfirmation({ fromAddress, subject, plainBody, htmlBody });
  if (confirmation) {
    const ingested = await db.ingestedEmail.create({
      data: {
        emailIntegrationId: integration.id,
        fromAddress,
        subject,
        messageId,
        plainBody,
        htmlBody,
        confirmationLink: confirmation.link,
        confirmationCode: confirmation.code,
        status: "CONFIRMATION",
      },
    });
    return NextResponse.json({ ok: true, ingestedEmailId: ingested.id, kind: "confirmation" });
  }

  // Collect parseable attachments (PDFs + images)
  const attachments: Array<{ name: string; mediaType: SupportedMediaType; buffer: Buffer }> = [];
  for (const [, value] of Array.from(formData.entries())) {
    if (typeof value === "string") continue;
    const file = value as File;
    const mt =
      (file.type as SupportedMediaType | "") ||
      mediaTypeFromFilename(file.name) ||
      null;
    if (!mt) continue;
    if (
      mt !== "application/pdf" &&
      mt !== "image/jpeg" &&
      mt !== "image/png" &&
      mt !== "image/webp" &&
      mt !== "image/gif"
    ) {
      continue;
    }
    const buf = Buffer.from(await file.arrayBuffer());
    attachments.push({ name: file.name, mediaType: mt, buffer: buf });
  }

  const ingested = await db.ingestedEmail.create({
    data: {
      emailIntegrationId: integration.id,
      fromAddress,
      subject,
      messageId,
      status: "RECEIVED",
    },
  });

  if (attachments.length === 0) {
    await db.ingestedEmail.update({
      where: { id: ingested.id },
      data: { status: "IGNORED", failureReason: "No parseable attachments" },
    });
    return NextResponse.json({ ok: true, ignored: "no_attachments", ingestedEmailId: ingested.id });
  }

  // Try each attachment in order; first one classified as an invoice wins.
  let extractionError: string | null = null;
  for (const att of attachments) {
    try {
      const extracted = await extractInvoiceForIngestion(att.buffer, att.mediaType);
      if (!extracted.isInvoice) continue;

      const invoice = await createInvoiceFromExtraction({
        integrationCompanyId: integration.companyId,
        fromAddress,
        extracted,
        attachment: att,
      });

      await db.ingestedEmail.update({
        where: { id: ingested.id },
        data: { status: "PARSED", invoiceId: invoice.id },
      });

      await sendPushToCompany(integration.companyId, {
        title: "Invoice received by email",
        body: `${invoice.invoiceNumber} from ${extracted.vendorName ?? fromAddress}`,
        url: `/invoices/${invoice.id}`,
      }).catch((e) => console.error("[cloudmailin] push failed:", e));

      return NextResponse.json({
        ok: true,
        invoiceId: invoice.id,
        ingestedEmailId: ingested.id,
      });
    } catch (err) {
      console.error("[cloudmailin] extraction error for", att.name, err);
      extractionError = err instanceof Error ? err.message : String(err);
    }
  }

  await db.ingestedEmail.update({
    where: { id: ingested.id },
    data: {
      status: extractionError ? "FAILED" : "IGNORED",
      failureReason: extractionError ?? "No attachment classified as invoice",
    },
  });

  return NextResponse.json({
    ok: true,
    ignored: extractionError ? "extraction_failed" : "not_an_invoice",
    ingestedEmailId: ingested.id,
  });
}

// Implementation lives in a separate function for readability — see helpers below.
async function createInvoiceFromExtraction(args: {
  integrationCompanyId: string;
  fromAddress: string;
  extracted: import("~/lib/extract-invoice").ExtractedInvoice;
  attachment: { name: string; mediaType: SupportedMediaType; buffer: Buffer };
}) {
  const { integrationCompanyId, fromAddress, extracted, attachment } = args;

  const vendorEmail = (extracted.vendorEmail ?? extractEmail(fromAddress) ?? "").toLowerCase();
  const vendorName = extracted.vendorName ?? vendorEmail.split("@")[0] ?? "Unknown vendor";

  // Find-or-create the supplier on the receiver's side.
  let supplier = await db.supplier.findFirst({
    where: {
      companyId: integrationCompanyId,
      OR: [
        vendorEmail ? { email: vendorEmail } : undefined,
        { company: { equals: vendorName, mode: "insensitive" } },
      ].filter(Boolean) as never,
    },
  });

  if (!supplier) {
    supplier = await db.supplier.create({
      data: {
        name: vendorName,
        company: vendorName,
        email: vendorEmail || null,
        companyId: integrationCompanyId,
      },
    });
  }

  // Find-or-create a stub Company to be the senderCompanyId on the Invoice.
  let senderCompanyId = supplier.linkedCompanyId;
  if (!senderCompanyId) {
    const stub = await db.company.create({
      data: {
        name: vendorName,
        email: vendorEmail || null,
        isStub: true,
        module: "SEND",
      },
    });
    senderCompanyId = stub.id;
    await db.supplier.update({
      where: { id: supplier.id },
      data: { linkedCompanyId: stub.id },
    });
  }

  const invoicedDate = parseDate(extracted.invoicedDate) ?? new Date();
  const dueDate =
    parseDate(extracted.dueDate) ??
    new Date(invoicedDate.getTime() + (extracted.paymentTerms ?? 30) * 24 * 60 * 60 * 1000);
  const totalAmount = extracted.totalAmount ?? extracted.subtotal ?? 0;

  // Inline data URL for the file so the receiver can view it in-app.
  // Matches the existing Invoice.fileUrl convention (data URL or external URL).
  const fileUrl = `data:${attachment.mediaType};base64,${attachment.buffer.toString("base64")}`;

  const invoiceNumber =
    extracted.invoiceNumber?.trim() || `EMAIL-${Date.now().toString(36).toUpperCase()}`;

  const invoice = await db.invoice.create({
    data: {
      invoiceNumber,
      reference: extracted.reference,
      invoicedDate,
      dueDate,
      paymentTerms: extracted.paymentTerms ?? 30,
      amount: totalAmount,
      subtotal: extracted.subtotal ?? totalAmount,
      taxRate: extracted.taxRate ?? 0,
      taxAmount: extracted.taxAmount ?? 0,
      currency: extracted.currency ?? "SGD",
      invoiceStatus: "SENT",
      source: "EMAIL_FORWARD",
      fromAddress: vendorEmail || null,
      description: extracted.notes,
      fileUrl,
      senderCompanyId,
      receiverCompanyId: integrationCompanyId,
      items: {
        create: extracted.items.map((item, idx) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.amount,
          sortOrder: idx,
        })),
      },
      timelineItems: {
        create: { message: `Invoice ingested via email from ${fromAddress}` },
      },
    },
  });

  return invoice;
}

function extractEmail(raw: string): string | null {
  const m = raw.match(/<([^>]+)>/) ?? raw.match(/[\w.+-]+@[\w.-]+/);
  return m ? (m[1] ?? m[0]).toLowerCase() : null;
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Recognises Gmail (and Outlook) "verify your forwarding address" emails and pulls
// out the click-to-confirm URL + numeric code so we can surface them in the UI.
function detectForwardingConfirmation(args: {
  fromAddress: string;
  subject: string | null;
  plainBody: string | null;
  htmlBody: string | null;
}): { link: string | null; code: string | null } | null {
  const { fromAddress, subject, plainBody, htmlBody } = args;
  const from = fromAddress.toLowerCase();
  const subj = (subject ?? "").toLowerCase();

  const isGmail =
    from.includes("forwarding-noreply@google.com") ||
    subj.includes("gmail forwarding confirmation");
  const isOutlook =
    from.includes("microsoft-noreply@microsoft.com") ||
    subj.includes("verify your forwarding email");

  if (!isGmail && !isOutlook) return null;

  const body = `${plainBody ?? ""}\n${htmlBody ?? ""}`;

  // Gmail confirmation URLs include URL-encoded chars (%5B, %5D, etc.), so allow
  // anything that's not whitespace or a quote/angle-bracket terminator.
  const linkMatch =
    body.match(/https:\/\/mail-settings\.google\.com\/mail\/[^\s"'<>]+/) ??
    body.match(/https:\/\/mail\.google\.com\/mail\/[^\s"'<>]+vf-[^\s"'<>]+/);
  const codeMatch = body.match(/\b(\d{9})\b/);

  return {
    link: linkMatch ? linkMatch[0] : null,
    code: codeMatch ? codeMatch[1] : null,
  };
}
