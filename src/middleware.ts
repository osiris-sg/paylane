import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/api/cloudmailin/(.*)",
  "/manifest.json",
  "/sw.js",
  "/push-sw.js",
  "/privacy",
  "/terms",
]);

// Static sub-pages under /invoices that are NOT a shareable invoice detail.
const INVOICE_SUBPAGES = new Set(["new", "upload", "accept-invite", "import-statement"]);

// `/invoices/<id>` is the deep link we put in invite emails/WhatsApp. A new
// customer arriving here is logged out — send them to sign-up (not sign-in)
// so they can create an account, and keep the invoice as the post-auth target.
function invoiceDeepLinkPath(pathname: string): string | null {
  const m = /^\/invoices\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  return INVOICE_SUBPAGES.has(m[1]!) ? null : pathname;
}

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  const { userId } = await auth();
  if (!userId) {
    const target = invoiceDeepLinkPath(req.nextUrl.pathname);
    if (target) {
      const signUp = new URL("/sign-up", req.nextUrl);
      signUp.searchParams.set("redirect_url", target);
      return NextResponse.redirect(signUp);
    }
  }

  await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
