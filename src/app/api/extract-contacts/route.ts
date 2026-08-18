import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import {
  extractFromDocument,
  extractFromSpreadsheet,
  imageMediaType,
  isSpreadsheet,
  pdfPageCount,
  INLINE_PAGE_LIMIT,
} from "~/server/import/extract-contacts";

// Inline extraction for SMALL files only. Anything over INLINE_PAGE_LIMIT
// pages is refused with `tooLarge: true` and the client routes it through
// the background import job instead (chunked, async, notified when done).
export const maxDuration = 60;

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

    const buffer = Buffer.from(await file.arrayBuffer());

    if (isSpreadsheet(file.name, file.type)) {
      const contacts = await extractFromSpreadsheet(buffer);
      return NextResponse.json({ contacts });
    }

    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      const pages = await pdfPageCount(buffer);
      if (pages > INLINE_PAGE_LIMIT) {
        return NextResponse.json(
          {
            error: `This PDF has ${pages} pages — too large to extract instantly.`,
            tooLarge: true,
            pages,
          },
          { status: 413 },
        );
      }
      const contacts = await extractFromDocument(buffer, "application/pdf");
      return NextResponse.json({ contacts });
    }

    const contacts = await extractFromDocument(buffer, imageMediaType(file.type));
    return NextResponse.json({ contacts });
  } catch (error) {
    console.error("Contact extraction error:", error);
    return NextResponse.json({ error: "Failed to extract contacts" }, { status: 500 });
  }
}
