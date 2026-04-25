import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed one-shot tokens for "open this specific invoice after signup".
 *
 * Format: base64url(payloadJson).hexsignature
 * Signature is HMAC-SHA256 over the payload using a secret derived from
 * CLERK_SECRET_KEY so we don't need a new env var. Tokens are valid for 30
 * days; verification rejects malformed, mistyped or expired ones.
 */

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface InvitePayload {
  invoiceId: string;
  email: string;
  iat: number; // issued-at, ms since epoch
}

function getSecret(): string {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) throw new Error("CLERK_SECRET_KEY is required to sign invite tokens");
  return `paylane.invoice-invite.v1:${secret}`;
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

export function signInviteToken({ invoiceId, email }: { invoiceId: string; email: string }): string {
  const payload: InvitePayload = {
    invoiceId,
    email: email.toLowerCase(),
    iat: Date.now(),
  };
  const payloadEncoded = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const signature = createHmac("sha256", getSecret()).update(payloadEncoded).digest("hex");
  return `${payloadEncoded}.${signature}`;
}

export function verifyInviteToken(token: string): InvitePayload | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payloadEncoded = token.slice(0, dot);
  const sigHex = token.slice(dot + 1);

  const expectedSig = createHmac("sha256", getSecret()).update(payloadEncoded).digest("hex");
  let provided: Buffer;
  try {
    provided = Buffer.from(sigHex, "hex");
  } catch {
    return null;
  }
  const expected = Buffer.from(expectedSig, "hex");
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let payload: InvitePayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadEncoded).toString("utf8")) as InvitePayload;
  } catch {
    return null;
  }
  if (typeof payload.invoiceId !== "string" || typeof payload.email !== "string" || typeof payload.iat !== "number") {
    return null;
  }
  if (Date.now() - payload.iat > TOKEN_TTL_MS) return null;

  return payload;
}
