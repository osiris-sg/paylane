import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "~/env";

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
    if (file.type === "application/pdf") mediaType = "application/pdf";
    else if (file.type === "image/png") mediaType = "image/png";
    else if (file.type === "image/webp") mediaType = "image/webp";
    else mediaType = "image/jpeg";

    const isPdf = mediaType === "application/pdf";

    const message = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
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
              text: `This document is a Delivery Order (DO) issued to a customer.

Extract the data and return ONLY a JSON object (no markdown, no explanation) in this exact shape:

{
  "doNumber": "string - the delivery order number / DO no. shown on the document",
  "reference": "string or null - any reference / PO no. / 'Your Ref' / 'Our Ref' on the document",
  "doDate": "string or null - the document's date in YYYY-MM-DD format",
  "customer": {
    "company": "string - the customer's company name (the 'Customer' / 'Deliver To' / 'Bill To' field)",
    "name": "string or null - the contact / attention person name if shown (e.g. an 'Attention:' line)",
    "email": "string or null - customer email if visible",
    "phone": "string or null - customer contact / mobile number if shown (e.g. an 'Mobile:' or 'Tel:' line for the customer, NOT the issuer's number)"
  }
}

Rules:
- doNumber is the document's own DO number (look for labels like 'DO No', 'Delivery Order No', 'D.O. No', 'DO #').
- Prefer the recipient/customer company, not the sender/issuer.
- For phone, capture the customer's contact number; if multiple are shown, return the first.
- Convert any DD/MM/YYYY date to YYYY-MM-DD.
- Return null for any field you can't find. Do not invent values.`,
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
    console.error("Delivery order extraction error:", error);
    return NextResponse.json({ error: "Failed to extract delivery order data" }, { status: 500 });
  }
}
