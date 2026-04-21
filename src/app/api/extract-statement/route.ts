import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");

    let mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "application/pdf";
    if (file.type === "application/pdf") {
      mediaType = "application/pdf";
    } else if (file.type === "image/png") {
      mediaType = "image/png";
    } else if (file.type === "image/webp") {
      mediaType = "image/webp";
    } else {
      mediaType = "image/jpeg";
    }

    const isPdf = mediaType === "application/pdf";

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8000,
      messages: [
        {
          role: "user",
          content: [
            isPdf
              ? {
                  type: "document" as const,
                  source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 },
                }
              : {
                  type: "image" as const,
                  source: { type: "base64" as const, media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: base64 },
                },
            {
              type: "text",
              text: `This document is a Statement of Account listing multiple invoices issued to a single customer.

Extract the data and return ONLY a JSON object (no markdown, no explanation) in this exact shape:

{
  "customer": {
    "company": "string - the customer's company name (from the 'To:' field)",
    "name": "string or null - contact person name if shown",
    "email": "string or null - customer email if visible",
    "accountCode": "string or null - customer account code / debtor code if present (e.g. 'DA098')"
  },
  "currency": "string - currency code like SGD, USD, EUR, RP (use the page's stated currency)",
  "periodEnding": "string or null - period ending label if shown (e.g. 'Apr 2026')",
  "invoices": [
    {
      "invoiceNumber": "string - the reference / invoice number for this line (e.g. 'INV 121357')",
      "invoicedDate": "string - invoice date in YYYY-MM-DD format",
      "xReference": "string or null - the X-Reference or secondary reference if present",
      "amount": "number - the debit amount for this invoice (use debit column, not balance)",
      "description": "string or null - any description or type label shown for this row (e.g. 'INVOICE')"
    }
  ]
}

Rules:
- Only include rows that are actual invoices (skip opening balance lines, subtotals, page footers, 'Continue Next Page' markers).
- Use the Debit column for amount. Ignore the Balance column.
- If a date is in DD/MM/YYYY format, convert to YYYY-MM-DD.
- Return every invoice row you can see. Do not summarise.
- All amounts must be numbers, not strings.`,
            },
          ],
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "No response from AI" }, { status: 500 });
    }

    const jsonStr = textBlock.text.trim().replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    const extracted = JSON.parse(jsonStr);

    return NextResponse.json({ data: extracted });
  } catch (error) {
    console.error("Statement extraction error:", error);
    return NextResponse.json(
      { error: "Failed to extract statement data" },
      { status: 500 },
    );
  }
}
