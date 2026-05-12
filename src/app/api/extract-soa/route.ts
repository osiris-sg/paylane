import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Extracts the customer/bill-to identity from a Statement of Account.
 * Used by the bulk SOA upload flow to auto-tag each file to a customer.
 */
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

    let mediaType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
    if (file.type === "application/pdf") mediaType = "application/pdf";
    else if (file.type === "image/png") mediaType = "image/png";
    else if (file.type === "image/webp") mediaType = "image/webp";
    else mediaType = "image/jpeg";

    const isPdf = mediaType === "application/pdf";

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 600,
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
                    media_type: mediaType as
                      | "image/jpeg"
                      | "image/png"
                      | "image/webp",
                    data: base64,
                  },
                },
            {
              type: "text",
              text: `This is a Statement of Account. Extract who the statement is FOR (the customer being billed), not the supplier issuing it. Return ONLY a JSON object, no markdown, no explanation:

{
  "customerName": "string - the bill-to customer's company name (the recipient)",
  "customerEmail": "string or null - the customer's email if visible",
  "totalOutstanding": "number or null - total outstanding amount if shown",
  "currency": "string or null - currency code like SGD, USD",
  "statementDate": "string or null - statement date in YYYY-MM-DD format",
  "confidence": "high | medium | low - how confident you are in the customer name extraction"
}

If a field is not visible, use null.`,
            },
          ],
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        { error: "No response from extractor" },
        { status: 502 },
      );
    }

    const cleaned = textBlock.text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: "Could not parse extractor output", raw: textBlock.text },
        { status: 502 },
      );
    }

    return NextResponse.json({ extraction: parsed });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
