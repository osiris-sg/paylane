/**
 * Canonical base URL for links we put in emails / external messages.
 *
 * Order: explicit NEXT_PUBLIC_APP_URL (the custom domain) → Vercel's
 * production domain → localhost. The middle fallback means a deployment
 * where NEXT_PUBLIC_APP_URL was forgotten still emails real links instead
 * of http://localhost:3000 ones.
 */
export function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProd) return `https://${vercelProd}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}
