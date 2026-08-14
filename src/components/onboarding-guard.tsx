"use client";

import { useEffect, useRef, useState } from "react";
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
let trippedAt = 0;
let tripCount = 0;
const WINDOW_MS = 3000;
const MAX_RENDERS = 80; // normal pages never approach this in 3s
// App Router navigations are client-side, so module state survives them. A
// tripped breaker must therefore auto-reset after a cool-down — otherwise one
// transient storm pins the recovery screen on EVERY page until a hard reload.
const COOLDOWN_MS = 8000;
// If it keeps re-tripping right after each reset, the loop is genuinely still
// running (e.g. wrong device clock) — stop auto-retrying and require the user
// to act. Trips more than a minute apart are treated as unrelated.
const MAX_CONSECUTIVE_TRIPS = 3;

export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const clerk = useClerk();
  const { isLoaded: authLoaded, isSignedIn, sessionId, orgId } = useAuth();
  const q = api.onboarding.getStatus.useQuery();
  const { data: status, isLoading, error } = q;
  const needsOnboarding = !!status && !status.onboarded;

  // Re-render tick so resetting the module-level breaker actually re-renders.
  const [, setRetryTick] = useState(0);

  renderCount += 1;
  const now = Date.now();
  renderTimes.push(now);
  renderTimes = renderTimes.filter((t) => now - t < WINDOW_MS);
  if (!tripped && renderTimes.length > MAX_RENDERS) {
    tripped = true;
    // A trip long after the previous one is a fresh incident, not an ongoing
    // loop — restart the consecutive-trip count instead of accumulating.
    tripCount = now - trippedAt > 60_000 ? 1 : tripCount + 1;
    trippedAt = now;
    console.error("[OG] CIRCUIT BREAKER tripped — runaway re-render loop", {
      rendersInWindow: renderTimes.length,
      windowMs: WINDOW_MS,
      tripCount,
    });
  }
  const autoRetrying = tripped && tripCount < MAX_CONSECUTIVE_TRIPS;

  // Auto-recover after a cool-down: clear the breaker and re-render. If the
  // loop is still running it re-trips within WINDOW_MS and we land back here;
  // after MAX_CONSECUTIVE_TRIPS we stop retrying and wait for the user.
  useEffect(() => {
    if (!autoRetrying) return;
    const t = setTimeout(() => {
      tripped = false;
      renderTimes = [];
      console.log("[OG] circuit breaker reset — retrying render");
      setRetryTick((n) => n + 1);
    }, COOLDOWN_MS);
    return () => clearTimeout(t);
  }, [autoRetrying]);

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
  // While auto-retrying it's a soft pause; after repeated trips it's manual.
  if (tripped) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-gray-50 px-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">We&apos;re having trouble loading your session</h1>
          {autoRetrying ? (
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Give us a moment — we&apos;ll retry automatically in a few seconds.
            </p>
          ) : (
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              This is almost always caused by your device&apos;s <strong>date &amp; time</strong> being
              incorrect. Set it to <strong>automatic</strong>, then reload. If it keeps happening,
              sign out and sign back in.
            </p>
          )}
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
