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
  if (!expectedUser || !expectedPass) {
    // Not configured — refuse to accept anything to avoid silent acceptance of forged traffic.
    return false;
  }

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf-8");
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  return user === expectedUser && pass === expectedPass;
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

function parseEnvelope(raw: FormDataEntryValue | null): { to?: string; from?: string; recipients?: string[] } {
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseHeaders(raw: FormDataEntryValue | null): Record<string, string | string[]> {
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function asString(headerVal: string | string[] | undefined): string | undefined {
  if (Array.isArray(headerVal)) return headerVal[0];
  return headerVal;
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

  const envelope = parseEnvelope(formData.get("envelope"));
  const headers = parseHeaders(formData.get("headers"));
  const toAddress =
    envelope.to ??
    asString(headers["To"] as string | string[] | undefined) ??
    envelope.recipients?.[0];
  const fromAddress =
    envelope.from ??
    asString(headers["From"] as string | string[] | undefined) ??
    "unknown@unknown";
  const subject = asString(headers["Subject"] as string | string[] | undefined) ?? null;
  const messageId =
    asString(headers["Message-ID"] as string | string[] | undefined) ??
    asString(headers["Message-Id"] as string | string[] | undefined) ??
    null;
  const plainBody = (formData.get("plain") as string | null) ?? null;
  const htmlBody = (formData.get("html") as string | null) ?? null;

  const inboundToken = extractInboundToken(toAddress);
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
    console.warn("[cloudmailin] unknown inbound token:", inboundToken);
    return NextResponse.json({ ok: true, ignored: "unknown_token" });
  }

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

  // Gmail confirmation URL pattern; falls back to any URL on google's mail-settings host.
  const linkMatch =
    body.match(/https:\/\/mail-settings\.google\.com\/mail\/vf-[A-Za-z0-9_-]+/) ??
    body.match(/https:\/\/mail\.google\.com\/[^\s"'<>]*vf-[A-Za-z0-9_-]+/);
  const codeMatch = body.match(/\b(\d{9})\b/);

  return {
    link: linkMatch ? linkMatch[0] : null,
    code: codeMatch ? codeMatch[1] : null,
  };
}
