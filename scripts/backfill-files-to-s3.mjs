// One-time migration: move base64 `data:` URIs stored in Invoice.fileUrl and
// Statement.fileUrl into S3, replacing each value with the S3 object key.
//
// Idempotent — it only selects rows whose fileUrl still starts with "data:",
// so re-running it is safe (already-migrated rows hold keys and won't match).
//
// Run:  node --env-file=.env scripts/backfill-files-to-s3.mjs
//
// (Do a DB snapshot/branch first if you want a rollback point — this rewrites
// fileUrl in place. The S3 bucket + S3_* env vars must already be set up.)

import { PrismaClient } from "@prisma/client";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();

const { S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } =
  process.env;

if (!S3_REGION || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
  console.error(
    "Missing S3_* env vars. Run: node --env-file=.env scripts/backfill-files-to-s3.mjs",
  );
  process.exit(1);
}

const s3 = new S3Client({
  region: S3_REGION,
  credentials: {
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  },
});

const EXT = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function parseDataUrl(value) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(value);
  if (!m) return null;
  return { contentType: m[1], buffer: Buffer.from(m[2], "base64") };
}

async function upload(kind, companyId, value) {
  const parsed = parseDataUrl(value);
  if (!parsed) return null;
  const ext = EXT[parsed.contentType] ?? "bin";
  const key = `${kind}/${companyId}/${randomUUID()}.${ext}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: parsed.buffer,
      ContentType: parsed.contentType,
    }),
  );
  return key;
}

async function main() {
  let invCount = 0;
  let stmtCount = 0;
  let skipped = 0;

  const invoices = await prisma.invoice.findMany({
    where: { fileUrl: { startsWith: "data:" } },
    select: { id: true, fileUrl: true, senderCompanyId: true },
  });
  console.log(`Invoices to migrate: ${invoices.length}`);
  for (const inv of invoices) {
    const key = await upload("invoices", inv.senderCompanyId, inv.fileUrl);
    if (!key) {
      skipped++;
      console.warn(`  skip invoice ${inv.id} (unparseable data URL)`);
      continue;
    }
    await prisma.invoice.update({
      where: { id: inv.id },
      data: { fileUrl: key },
    });
    invCount++;
    console.log(`  invoice ${inv.id} -> ${key}`);
  }

  const statements = await prisma.statement.findMany({
    where: { fileUrl: { startsWith: "data:" } },
    select: { id: true, fileUrl: true, senderCompanyId: true },
  });
  console.log(`Statements to migrate: ${statements.length}`);
  for (const s of statements) {
    const key = await upload("statements", s.senderCompanyId, s.fileUrl);
    if (!key) {
      skipped++;
      console.warn(`  skip statement ${s.id} (unparseable data URL)`);
      continue;
    }
    await prisma.statement.update({
      where: { id: s.id },
      data: { fileUrl: key },
    });
    stmtCount++;
    console.log(`  statement ${s.id} -> ${key}`);
  }

  console.log(
    `\nDone. Migrated ${invCount} invoices, ${stmtCount} statements. Skipped ${skipped}.`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
