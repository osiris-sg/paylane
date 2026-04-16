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

    // Determine media type
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
      max_tokens: 2000,
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
              text: `Extract the following fields from this invoice. Return ONLY a JSON object with these fields, no markdown, no explanation:

{
  "invoiceNumber": "string - the invoice number",
  "customerName": "string - the customer/bill-to company or person name",
  "customerEmail": "string or null - customer email if visible",
  "reference": "string or null - PO number, reference number, or order number",
  "invoicedDate": "string - invoice date in YYYY-MM-DD format",
  "dueDate": "string or null - due date in YYYY-MM-DD format if visible",
  "paymentTerms": "number or null - payment terms in days if visible (e.g. Net 30 = 30)",
  "currency": "string - currency code like SGD, USD, EUR",
  "subtotal": "number - subtotal before tax",
  "taxRate": "number or null - tax rate percentage if visible",
  "taxAmount": "number or null - tax amount",
  "totalAmount": "number - total amount",
  "items": [
    {
      "description": "string - item description",
      "quantity": "number",
      "unitPrice": "number",
      "amount": "number"
    }
  ],
  "notes": "string or null - any notes, terms, or bank details"
}

If a field is not visible, use null. For items, extract as many line items as visible. Ensure all numbers are actual numbers, not strings.`,
            },
          ],
        },
      ],
    });

    // Extract the text response
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "No response from AI" }, { status: 500 });
    }

    // Parse the JSON from the response
    const jsonStr = textBlock.text.trim().replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    const extracted = JSON.parse(jsonStr);

    return NextResponse.json({ data: extracted });
  } catch (error) {
    console.error("Invoice extraction error:", error);
    return NextResponse.json(
      { error: "Failed to extract invoice data" },
      { status: 500 },
    );
  }
}
