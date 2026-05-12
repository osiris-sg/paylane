import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type SupportedMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "application/pdf";

const ExtractedItemSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  amount: z.number(),
});

const ExtractedInvoiceSchema = z.object({
  isInvoice: z.boolean(),
  invoiceNumber: z.string().nullable(),
  vendorName: z.string().nullable(),
  vendorEmail: z.string().nullable(),
  customerName: z.string().nullable(),
  reference: z.string().nullable(),
  invoicedDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  paymentTerms: z.number().nullable(),
  currency: z.string().nullable(),
  subtotal: z.number().nullable(),
  taxRate: z.number().nullable(),
  taxAmount: z.number().nullable(),
  totalAmount: z.number().nullable(),
  items: z.array(ExtractedItemSchema),
  notes: z.string().nullable(),
});

export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;

const PROMPT = `You are examining a document that arrived via email. First decide whether it is actually an invoice or bill that the recipient owes money on. Newsletters, receipts for already-paid items, marketing material, statements of account, and shipping notifications are NOT invoices. Return ONLY a JSON object — no markdown, no explanation — with this shape:

{
  "isInvoice": "boolean — true only if this is a payable invoice/bill",
  "invoiceNumber": "string or null",
  "vendorName": "string or null — the company that issued the invoice (the 'from' / 'bill from' party)",
  "vendorEmail": "string or null — email of the issuing company if visible",
  "customerName": "string or null — the 'bill to' party",
  "reference": "string or null — PO number, reference number, or order number",
  "invoicedDate": "string or null — YYYY-MM-DD",
  "dueDate": "string or null — YYYY-MM-DD",
  "paymentTerms": "number or null — payment terms in days (e.g. Net 30 = 30)",
  "currency": "string or null — ISO 4217 code like SGD, USD, EUR",
  "subtotal": "number or null",
  "taxRate": "number or null — percent",
  "taxAmount": "number or null",
  "totalAmount": "number or null",
  "items": [
    { "description": "string", "quantity": "number", "unitPrice": "number", "amount": "number" }
  ],
  "notes": "string or null — payment terms, bank details, etc."
}

If isInvoice is false, set all other fields to null and items to []. Numbers must be numbers, not strings.`;

export async function extractInvoiceForIngestion(
  buffer: Buffer,
  mediaType: SupportedMediaType,
): Promise<ExtractedInvoice> {
  const base64 = buffer.toString("base64");
  const isPdf = mediaType === "application/pdf";

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: [
          isPdf
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
                  media_type: mediaType as Exclude<SupportedMediaType, "application/pdf">,
                  data: base64,
                },
              },
          { type: "text" as const, text: PROMPT },
        ],
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const jsonStr = textBlock.text
    .trim()
    .replace(/^```json?\n?/, "")
    .replace(/\n?```$/, "");
  const raw = JSON.parse(jsonStr);
  return ExtractedInvoiceSchema.parse(raw);
}

export function mediaTypeFromFilename(filename: string): SupportedMediaType | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return null;
}
