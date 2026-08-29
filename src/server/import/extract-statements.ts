import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { env } from "~/env";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** What Claude reads off ONE page of a statement run. */
export interface StatementPage {
  /** 1-based page number in the ORIGINAL document (offset applied). */
  page: number;
  customerName: string;
  /** "PAGE : n" on the statement header — >1 means a continuation page. */
  statementPage: number;
  currency: string;
  accountCode: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}

/** One customer's statement = a run of consecutive pages. */
export interface StatementSegment {
  from: number; // 1-based, inclusive
  to: number; // 1-based, inclusive
  customerName: string;
  currency: string;
  accountCode: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}

const normCur = (raw: unknown): string => {
  const v = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(v) ? v : "SGD";
};
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/**
 * Read every page of a ≤50-page chunk of a statement run. `pageOffset` is
 * the 0-based index of the chunk's first page in the original document, so
 * returned page numbers are document-global.
 */
export async function extractStatementPages(
  chunkBytes: Uint8Array,
  pageOffset: number,
): Promise<StatementPage[]> {
  const message = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 12000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: Buffer.from(chunkBytes).toString("base64"),
            },
          },
          {
            type: "text",
            text: `This PDF is a statement-of-account run from ONE supplier: every page is a statement addressed to ONE customer (the "To :" block). A customer's statement can continue onto the next page — the header shows "PAGE : n", where n > 1 means a continuation of the previous page's customer.

For EVERY page, in order, return ONLY a JSON object (no markdown, no commentary):

{
  "pages": [
    {
      "page": 1,
      "customerName": "string - the customer in the To: block (the recipient, NOT the supplier at the top)",
      "statementPage": 1,
      "currency": "3-letter code from the CURRENCY field, e.g. SGD",
      "accountCode": "string or null - the ACCN CODE / account number",
      "phone": "string or null - the customer's telephone (TEL), digits as printed",
      "email": "string or null",
      "address": "string or null - the customer's address lines joined with ', '"
    }
  ]
}

Rules:
- One entry per page. Do not skip pages, even blank or continuation pages (repeat the customer for continuations).
- Numbers in the page field are the page's position in THIS document, starting at 1.`,
          },
        ],
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("No response from AI");
  const raw = JSON.parse(
    textBlock.text.trim().replace(/^```json?\n?/, "").replace(/\n?```$/, ""),
  ) as { pages?: Array<Record<string, unknown>> };

  return (raw.pages ?? []).map((p, i) => ({
    page: pageOffset + (typeof p.page === "number" && p.page > 0 ? p.page : i + 1),
    customerName: str(p.customerName) ?? "",
    statementPage:
      typeof p.statementPage === "number" && p.statementPage > 0 ? p.statementPage : 1,
    currency: normCur(p.currency),
    accountCode: str(p.accountCode),
    phone: str(p.phone),
    email: str(p.email),
    address: str(p.address),
  }));
}

/**
 * Group consecutive pages into per-customer segments. A page joins the
 * previous segment when it's a continuation (statementPage > 1) or has the
 * same customer + currency; otherwise it starts a new one. Pages with no
 * readable customer name are attached to the previous segment (they're
 * almost always overflow pages), or dropped if there is none.
 */
export function segmentStatementPages(pages: StatementPage[]): StatementSegment[] {
  const sorted = [...pages].sort((a, b) => a.page - b.page);
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const out: StatementSegment[] = [];
  for (const p of sorted) {
    const prev = out[out.length - 1];
    const continues =
      !!prev &&
      (p.statementPage > 1 ||
        !p.customerName ||
        (norm(p.customerName) === norm(prev.customerName) && p.currency === prev.currency)) &&
      p.page === prev.to + 1;
    if (continues && prev) {
      prev.to = p.page;
      prev.phone ??= p.phone;
      prev.email ??= p.email;
      prev.address ??= p.address;
      prev.accountCode ??= p.accountCode;
      continue;
    }
    if (!p.customerName) continue; // orphan blank page with nothing before it
    out.push({
      from: p.page,
      to: p.page,
      customerName: p.customerName,
      currency: p.currency,
      accountCode: p.accountCode,
      phone: p.phone,
      email: p.email,
      address: p.address,
    });
  }
  return out;
}

// ─── Result stored on ImportJob.result for kind = STATEMENTS ────────────────

export interface StatementSegmentRow extends StatementSegment {
  index: number;
  /** Existing customer the extractor thinks this is (name + currency match). */
  suggestedCustomerId: string | null;
  matchConfidence: "exact" | "fuzzy" | null;
  /** The user's decision from the review screen (set by startStatementSend). */
  decision: { action: "send"; customerId: string | null } | { action: "skip" } | null;
  /** Send-phase outcome. */
  status: "pending" | "sent" | "skipped" | "error";
  statementId?: string;
  customerId?: string;
  error?: string;
}

export interface StatementsResult {
  kind: "statements";
  pageCount: number;
  segments: StatementSegmentRow[];
}

/** Bytes of pages [from, to] (1-based, inclusive) as a standalone PDF. */
export async function slicePdf(
  source: Uint8Array,
  from: number,
  to: number,
): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(source, { ignoreEncryption: true });
  const doc = await PDFDocument.create();
  const idx = Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
  const pages = await doc.copyPages(src, idx);
  for (const p of pages) doc.addPage(p);
  return doc.save();
}
