import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { db } from "~/lib/db";
import { getObjectBuffer, isInlineOrExternal } from "~/lib/storage";

function extFor(fileUrl: string): string {
  if (fileUrl.startsWith("data:application/pdf")) return "pdf";
  if (fileUrl.startsWith("data:image/png")) return "png";
  if (fileUrl.startsWith("data:image/webp")) return "webp";
  if (fileUrl.startsWith("data:image/")) return "jpg";
  return /\.([a-z0-9]+)$/i.exec(fileUrl)?.[1]?.toLowerCase() ?? "pdf";
}

/** Bundle the selected delivery-order files into a single zip download. */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ids } = (await req.json().catch(() => ({}))) as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "No delivery orders selected" }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { clerkId: userId },
    select: { companyId: true },
  });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only files the caller's company sent OR received.
  const orders = await db.deliveryOrder.findMany({
    where: {
      id: { in: ids.filter((x): x is string => typeof x === "string") },
      OR: [
        { senderCompanyId: user.companyId },
        { receiverCompanyId: user.companyId },
      ],
    },
    select: { id: true, doNumber: true, fileUrl: true },
  });

  if (orders.length === 0) {
    return NextResponse.json({ error: "Nothing to download" }, { status: 404 });
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();

  for (const o of orders) {
    let buf: Buffer;
    try {
      if (isInlineOrExternal(o.fileUrl)) {
        if (o.fileUrl.startsWith("data:")) {
          buf = Buffer.from(o.fileUrl.split(",")[1] ?? "", "base64");
        } else {
          const r = await fetch(o.fileUrl);
          buf = Buffer.from(await r.arrayBuffer());
        }
      } else {
        buf = await getObjectBuffer(o.fileUrl);
      }
    } catch (err) {
      console.error(`[download-zip] skipped DO ${o.id}:`, err);
      continue;
    }

    const safe = o.doNumber.replace(/[^a-zA-Z0-9._-]+/g, "-") || "delivery-order";
    let name = `DO-${safe}.${extFor(o.fileUrl)}`;
    let n = 2;
    while (usedNames.has(name)) {
      name = `DO-${safe}-${n}.${extFor(o.fileUrl)}`;
      n += 1;
    }
    usedNames.add(name);
    zip.file(name, buf);
  }

  const body = await zip.generateAsync({ type: "uint8array" });
  return new NextResponse(body as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="delivery-orders.zip"`,
    },
  });
}
