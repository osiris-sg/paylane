import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface Contact {
  company: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
}

type Field = "company" | "name" | "email" | "phone" | "address";
type ColumnMapping = Record<string, Field | "ignore">;

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
    model: "claude-sonnet-4-20250514",
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
- "ignore"   — anything else (IDs, dates, internal codes, totals, currency, etc.)

Use semantic understanding, not just header text. For example a column called "Startup" or "Brand" full of business names should map to "company". A column "Mobile" or "Cell" should map to "phone". When values look like emails it's "email" regardless of header.

Shape:
{
  "<exact header name>": "company" | "name" | "email" | "phone" | "address" | "ignore"
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
  const jsonStr = textBlock.text.trim().replace(/^```json?\n?/, "").replace(/\n?```$/, "");
  return JSON.parse(jsonStr) as ColumnMapping;
}

async function parseSheet(buffer: Buffer): Promise<Contact[]> {
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
        });
      }
    }
  }

  return out;
}

async function extractWithAI(file: File): Promise<Contact[]> {
  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  const isPdf = file.type === "application/pdf";

  const fileBlock = isPdf
    ? {
        type: "document" as const,
        source: {
          type: "base64" as const,
          media_type: "application/pdf" as const,
          data: base64,
        },
      }
    : {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: (file.type === "image/png"
            ? "image/png"
            : file.type === "image/webp"
              ? "image/webp"
              : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
          data: base64,
        },
      };

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content: [
          fileBlock,
          {
            type: "text",
            text: `This document lists business contacts (customers or suppliers).

Extract every distinct contact and return ONLY a JSON object (no markdown, no commentary) in this exact shape:

{
  "contacts": [
    {
      "company": "string - business / company name (REQUIRED, never empty)",
      "name": "string or null - contact person name",
      "email": "string or null",
      "phone": "string or null",
      "address": "string or null"
    }
  ]
}

Rules:
- "company" is required for every entry. If only a person name is shown, use that name as the company.
- Skip header rows, totals, and any non-contact rows.
- Return all contacts you can see. Do not summarise or de-duplicate.
- Phone may include country code; preserve formatting.`,
          },
        ],
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No response from AI");
  }

  const jsonStr = textBlock.text.trim().replace(/^```json?\n?/, "").replace(/\n?```$/, "");
  const parsed = JSON.parse(jsonStr) as { contacts: Contact[] };
  return parsed.contacts ?? [];
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const isSheet =
      file.type === "text/csv" ||
      file.type === "application/vnd.ms-excel" ||
      file.type ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.name.toLowerCase().endsWith(".xlsx") ||
      file.name.toLowerCase().endsWith(".xls") ||
      file.name.toLowerCase().endsWith(".csv");

    let contacts: Contact[];
    if (isSheet) {
      const buffer = Buffer.from(await file.arrayBuffer());
      contacts = await parseSheet(buffer);
    } else {
      contacts = await extractWithAI(file);
    }

    return NextResponse.json({ contacts });
  } catch (error) {
    console.error("Contact extraction error:", error);
    return NextResponse.json(
      { error: "Failed to extract contacts" },
      { status: 500 },
    );
  }
}
