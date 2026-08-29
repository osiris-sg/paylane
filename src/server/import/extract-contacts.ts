import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";
import { PDFDocument } from "pdf-lib";
import { env } from "~/env";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Pages per background chunk. Claude's hard cap is 100 pages per document
 * block, but a dense 100-page statement chunk measured ~180s to extract —
 * uncomfortably close to the worker's 300s per-step ceiling. 50 pages keeps
 * each durable step around 90s with headroom, and smaller documents are read
 * more reliably too.
 */
export const MAX_PAGES_PER_CHUNK = 50;

/**
 * Anything up to this many pages is extracted inline in the upload request;
 * bigger files go through the background import job (chunked + async).
 * Kept well under 100 so a single request also comfortably fits the
 * serverless timeout.
 */
export const INLINE_PAGE_LIMIT = 40;

export interface Contact {
  company: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  /** ISO 4217 code the customer is billed in; callers default to SGD. */
  currency?: string;
}

type Field = "company" | "name" | "email" | "phone" | "address" | "currency";

/** Keep only a clean 3-letter code; anything else → undefined (→ SGD default). */
export function normaliseContactCurrency(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(v) ? v : undefined;
}
type ColumnMapping = Record<string, Field | "ignore">;

const stripFences = (t: string) =>
  t.trim().replace(/^```json?\n?/, "").replace(/\n?```$/, "");

export function isSpreadsheet(name: string, type: string): boolean {
  const n = name.toLowerCase();
  return (
    type === "text/csv" ||
    type === "application/vnd.ms-excel" ||
    type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    n.endsWith(".xlsx") ||
    n.endsWith(".xls") ||
    n.endsWith(".csv")
  );
}

/** Page count of a PDF buffer (0 for non-PDF / unreadable). */
export async function pdfPageCount(buffer: Uint8Array): Promise<number> {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return doc.getPageCount();
  } catch {
    return 0;
  }
}

/**
 * Split a PDF into consecutive chunks of at most `size` pages. Returns each
 * chunk as its own standalone PDF (bytes) plus its page range for logging.
 */
export async function splitPdf(
  buffer: Uint8Array,
  size = MAX_PAGES_PER_CHUNK,
): Promise<{ bytes: Uint8Array; from: number; to: number }[]> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const total = src.getPageCount();
  const out: { bytes: Uint8Array; from: number; to: number }[] = [];
  for (let start = 0; start < total; start += size) {
    const end = Math.min(start + size, total);
    const chunk = await PDFDocument.create();
    const pages = await chunk.copyPages(
      src,
      Array.from({ length: end - start }, (_, i) => start + i),
    );
    for (const p of pages) chunk.addPage(p);
    out.push({ bytes: await chunk.save(), from: start + 1, to: end });
  }
  return out;
}

// ─── Spreadsheets ────────────────────────────────────────────────────────────

/**
 * Ask Claude what each column header means. Sending only the headers + a few
 * sample rows keeps the request small even for huge sheets — we apply the
 * returned mapping locally in JS.
 */
async function inferColumnMapping(
  headers: string[],
  sampleRows: Record<string, unknown>[],
): Promise<ColumnMapping> {
  const message = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 1000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `You are mapping spreadsheet columns to a contact schema. Look at the column headers and the sample values below, then decide what each column represents.

Columns and sample values:
${JSON.stringify(
              headers.map((h) => ({
                column: h,
                samples: sampleRows.slice(0, 5).map((r) => r[h]),
              })),
              null,
              2,
            )}

Return ONLY a JSON object (no markdown, no commentary) mapping each column to one of these fields:
- "company"  — the business / organisation / startup name (e.g. "Acme Corp", "Stripe")
- "name"     — the human contact's name (e.g. "John Doe")
- "email"    — an email address
- "phone"    — a phone or mobile number
- "address"  — a postal / street address
- "currency" — the billing currency code (SGD, USD, IDR, …)
- "ignore"   — anything else (IDs, dates, internal codes, totals, etc.)

Use semantic understanding, not just header text. For example a column called "Startup" or "Brand" full of business names should map to "company". A column "Mobile" or "Cell" should map to "phone". When values look like emails it's "email" regardless of header.

Shape:
{
  "<exact header name>": "company" | "name" | "email" | "phone" | "address" | "currency" | "ignore"
}

Map every header. If two columns claim the same field, pick the one with the better data and "ignore" the other.`,
          },
        ],
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("AI did not return a column mapping");
  }
  return JSON.parse(stripFences(textBlock.text)) as ColumnMapping;
}

export async function extractFromSpreadsheet(buffer: Buffer): Promise<Contact[]> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const out: Contact[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (rows.length === 0) continue;

    const headers = Object.keys(rows[0]!);
    let mapping: ColumnMapping;
    try {
      mapping = await inferColumnMapping(headers, rows);
    } catch (err) {
      console.error("[extract-contacts] column mapping failed", err);
      continue;
    }

    for (const row of rows) {
      const contact: Partial<Contact> = {};
      for (const [header, field] of Object.entries(mapping)) {
        if (field === "ignore") continue;
        const raw = row[header];
        if (raw === undefined || raw === null || raw === "") continue;
        contact[field] = String(raw).trim();
      }
      if (contact.company || contact.name || contact.email) {
        out.push({
          company: contact.company || contact.name || "(Unnamed)",
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
          address: contact.address,
          currency: normaliseContactCurrency(contact.currency),
        });
      }
    }
  }

  return out;
}

// ─── Documents (PDF / images) ────────────────────────────────────────────────

const EXTRACT_PROMPT = `This document lists business contacts (customers or suppliers).

Extract every distinct contact and return ONLY a JSON object (no markdown, no commentary) in this exact shape:

{
  "contacts": [
    {
      "company": "string - business / company name (REQUIRED, never empty)",
      "name": "string or null - contact person name",
      "email": "string or null",
      "phone": "string or null",
      "address": "string or null",
      "currency": "string or null - 3-letter ISO code (SGD, USD, IDR…) this customer is billed in, if the document shows it"
    }
  ]
}

Rules:
- "company" is required for every entry. If only a person name is shown, use that name as the company.
- Skip header rows, totals, and any non-contact rows.
- Return all contacts you can see. Do not summarise or de-duplicate.
- Phone may include country code; preserve formatting.`;

type ImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/**
 * Extract contacts from ONE document that already fits Claude's limits
 * (a PDF of ≤100 pages, or an image). Callers split larger PDFs first.
 */
export async function extractFromDocument(
  bytes: Uint8Array,
  mediaType: "application/pdf" | ImageType,
): Promise<Contact[]> {
  const base64 = Buffer.from(bytes).toString("base64");
  const fileBlock =
    mediaType === "application/pdf"
      ? {
          type: "document" as const,
          source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 },
        }
      : {
          type: "image" as const,
          source: { type: "base64" as const, media_type: mediaType, data: base64 },
        };

  const message = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    // A ≤100-page chunk can hold a lot of contacts; give the answer room so
    // the JSON isn't truncated mid-array.
    max_tokens: 16000,
    messages: [{ role: "user", content: [fileBlock, { type: "text", text: EXTRACT_PROMPT }] }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No response from AI");
  }
  const parsed = JSON.parse(stripFences(textBlock.text)) as { contacts?: Contact[] };
  return (parsed.contacts ?? []).map((c) => ({
    ...c,
    currency: normaliseContactCurrency(c.currency),
  }));
}

export function imageMediaType(fileType: string): ImageType {
  if (fileType === "image/png") return "image/png";
  if (fileType === "image/webp") return "image/webp";
  if (fileType === "image/gif") return "image/gif";
  return "image/jpeg";
}

/**
 * Merge chunk results. Chunks are page-ranges of one document, so the same
 * customer can straddle a boundary or appear on several pages — dedupe by
 * normalised company name + currency (a business billed in two currencies is
 * two customers), keeping the entry that carries the most detail.
 */
export function mergeContacts(chunks: Contact[][]): Contact[] {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const score = (c: Contact) =>
    [c.name, c.email, c.phone, c.address].filter(Boolean).length;
  const byKey = new Map<string, Contact>();
  for (const c of chunks.flat()) {
    if (!c?.company) continue;
    const key = `${norm(c.company)}|${c.currency ?? "SGD"}`;
    const prev = byKey.get(key);
    if (!prev || score(c) > score(prev)) byKey.set(key, c);
  }
  return Array.from(byKey.values());
}
