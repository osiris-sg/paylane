"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth, useClerk } from "@clerk/nextjs";
import { api } from "~/trpc/react";

// Set ONCE per full page load (module evaluation). If this value DIFFERS
// between repeated console lines, the page is hard-RELOADING (not re-rendering).
const PAGE_LOAD_ID = Math.random().toString(36).slice(2, 8);
const PAGE_LOAD_AT = Date.now();

// Module-level counters survive component remounts within the same page load.
let renderCount = 0;
let mountCount = 0;

// Circuit breaker: a runaway re-render loop (seen when an auth/session provider
// re-validates non-stop — usually a device with a wrong clock) makes the app
// flash/refresh endlessly. Track render timestamps; if we blow past a very high
// threshold in a short window, stop rendering the app and show a recovery
// screen instead, so the page is usable instead of stuck in the loop.
let renderTimes: number[] = [];
let tripped = false;
const WINDOW_MS = 3000;
const MAX_RENDERS = 80; // normal pages never approach this in 3s

export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const clerk = useClerk();
  const { isLoaded: authLoaded, isSignedIn, sessionId, orgId } = useAuth();
  const q = api.onboarding.getStatus.useQuery();
  const { data: status, isLoading, error } = q;
  const needsOnboarding = !!status && !status.onboarded;

  renderCount += 1;
  const now = Date.now();
  renderTimes.push(now);
  renderTimes = renderTimes.filter((t) => now - t < WINDOW_MS);
  if (!tripped && renderTimes.length > MAX_RENDERS) {
    tripped = true;
    console.error("[OG] CIRCUIT BREAKER tripped — runaway re-render loop", {
      rendersInWindow: renderTimes.length,
      windowMs: WINDOW_MS,
    });
  }

  console.log("[OG]", {
    pageLoadId: PAGE_LOAD_ID,
    msSinceLoad: now - PAGE_LOAD_AT,
    renderCount,
    mountCount,
    pathname,
    // Clerk auth state — if these flip every render, the session is flapping.
    authLoaded,
    isSignedIn,
    sessionId,
    orgId,
    isLoading,
    isFetching: q.isFetching,
    fetchStatus: q.fetchStatus,
    queryStatus: q.status,
    dataUpdatedAt: q.dataUpdatedAt,
    hasError: !!error,
    onboarded: status?.onboarded,
    needsOnboarding,
  });

  useEffect(() => {
    mountCount += 1;
    return undefined;
  }, []);

  const redirectedRef = useRef(false);
  useEffect(() => {
    if (needsOnboarding && !redirectedRef.current) {
      redirectedRef.current = true;
      router.replace("/onboarding");
    }
  }, [needsOnboarding, router]);

  // Recovery screen — breaks the visible loop and gives the user a way out.
  if (tripped) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-gray-50 px-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">We&apos;re having trouble loading your session</h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            This is almost always caused by your device&apos;s <strong>date &amp; time</strong> being
            incorrect. Set it to <strong>automatic</strong>, then reload. If it keeps happening,
            sign out and sign back in.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={() => void clerk.signOut(() => router.push("/sign-in"))}
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-100"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || needsOnboarding) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
