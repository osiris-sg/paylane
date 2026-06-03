import "server-only";

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

const BUCKET = process.env.S3_BUCKET;

let cached: S3Client | null = null;

function client(): S3Client {
  if (cached) return cached;
  const { S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (!S3_REGION || !BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    throw new Error(
      "S3 is not configured — set S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.",
    );
  }
  cached = new S3Client({
    region: S3_REGION,
    credentials: {
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
    },
  });
  return cached;
}

/**
 * A stored `fileUrl` is an S3 object key UNLESS it's a legacy inline data URI
 * or an absolute URL — those are served as-is (backward compatibility with
 * everything created before the S3 migration).
 */
export function isInlineOrExternal(fileUrl: string | null | undefined): boolean {
  if (!fileUrl) return false;
  return (
    fileUrl.startsWith("data:") ||
    fileUrl.startsWith("http://") ||
    fileUrl.startsWith("https://")
  );
}

const EXT_BY_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Namespaced, unguessable object key, e.g. `invoices/<companyId>/<uuid>.pdf`. */
export function buildKey(
  kind: "invoices" | "statements" | "delivery-orders",
  companyId: string,
  contentType: string,
): string {
  const ext = EXT_BY_TYPE[contentType] ?? "bin";
  return `${kind}/${companyId}/${randomUUID()}.${ext}`;
}

/** Presigned PUT URL for client-direct upload. Client must PUT with the same Content-Type. */
export function presignUpload(
  key: string,
  contentType: string,
  expiresIn = 300,
): Promise<string> {
  return getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn },
  );
}

/**
 * Short-lived presigned GET URL for a private object.
 * Pass `filename` to make S3 return `Content-Disposition: attachment`, which
 * forces the browser to download (with that name) instead of rendering inline.
 */
export function presignDownload(
  key: string,
  expiresIn = 3600,
  opts?: { filename?: string },
): Promise<string> {
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ...(opts?.filename
        ? { ResponseContentDisposition: `attachment; filename="${opts.filename}"` }
        : {}),
    }),
    { expiresIn },
  );
}

/** Server-side upload (email-ingest webhook, backfill). */
export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteObject(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

/** Fetch a private object's raw bytes server-side (e.g. to bundle into a zip). */
export async function getObjectBuffer(key: string): Promise<Buffer> {
  const res = await client().send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
  );
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

/**
 * Resolve a stored `fileUrl` for viewing: legacy inline/external values pass
 * through unchanged; S3 keys become a short-lived presigned GET URL.
 */
export async function resolveFileUrl(
  fileUrl: string | null | undefined,
): Promise<string | undefined> {
  if (!fileUrl) return undefined;
  if (isInlineOrExternal(fileUrl)) return fileUrl;
  return presignDownload(fileUrl);
}
