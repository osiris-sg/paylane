"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { api } from "~/trpc/react";

// Set ONCE per full page load (module evaluation). If this value DIFFERS
// between repeated console lines, the page is hard-RELOADING (not re-rendering).
const PAGE_LOAD_ID = Math.random().toString(36).slice(2, 8);
const PAGE_LOAD_AT = Date.now();

// Which deployment this bundle came from — lets a diagnostics screenshot show
// whether the client is on the fixed build. Inlined at build time by Vercel
// ("Automatically expose System Environment Variables" must be on; falls back
// to "unknown" locally).
const BUILD_ID =
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "unknown";

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

// Rolling buffer of recent render snapshots. Each entry records the fields the
// guard renders from plus WHICH of them changed since the previous render —
// when the breaker trips, the recovery screen prints this so a user can
// screenshot exactly what was flapping (session id, query state, pathname…).
type RenderSnap = {
  t: number; // ms since page load
  n: number; // render number
  path: string;
  loaded: boolean;
  sess: string | null;
  qs: string; // react-query status
  fs: string; // react-query fetchStatus
  upd: number; // dataUpdatedAt
  err: boolean;
  chg: string; // comma list of fields that differ from the previous snapshot
};
let snaps: RenderSnap[] = [];
const MAX_SNAPS = 40;

function formatSnap(s: RenderSnap): string {
  const sess = s.sess ? `…${s.sess.slice(-6)}` : "-";
  return `+${s.t}ms #${s.n} ${s.path} q=${s.qs}/${s.fs} sess=${sess} chg=${s.chg}`;
}

export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // NOTE: deliberately NOT useAuth() here. Subscribing to session state means a
  // Clerk token-refresh loop (wrong device clock, blocked cookies) re-renders
  // this guard — and the whole page tree under it — on every flap. The guard's
  // logic only needs the onboarding query; auth fields below are read
  // imperatively off the clerk instance for diagnostics, without subscribing.
  const clerk = useClerk();
  const q = api.onboarding.getStatus.useQuery();
  const { data: status, isLoading, error } = q;
  const needsOnboarding = !!status && !status.onboarded;

  // Re-render tick so resetting the module-level breaker actually re-renders.
  const [, setRetryTick] = useState(0);

  renderCount += 1;
  const now = Date.now();
  renderTimes.push(now);
  renderTimes = renderTimes.filter((t) => now - t < WINDOW_MS);

  // Record this render in the diagnostic buffer, noting what changed.
  {
    const snap: RenderSnap = {
      t: now - PAGE_LOAD_AT,
      n: renderCount,
      path: pathname,
      loaded: clerk.loaded,
      sess: clerk.session?.id ?? null,
      qs: q.status,
      fs: q.fetchStatus,
      upd: q.dataUpdatedAt,
      err: !!error,
      chg: "",
    };
    const prev = snaps[snaps.length - 1];
    snap.chg = !prev
      ? "first"
      : (["path", "loaded", "sess", "qs", "fs", "upd", "err"] as const)
          .filter((k) => prev[k] !== snap[k])
          .join(",") || "none";
    snaps.push(snap);
    if (snaps.length > MAX_SNAPS) snaps = snaps.slice(-MAX_SNAPS);
  }

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
  // Snapshot the module flag for this render so effects/JSX see one value.
  const isTripped = tripped;
  const autoRetrying = isTripped && tripCount < MAX_CONSECUTIVE_TRIPS;

  // While tripped, measure device-clock skew against the server's Date header —
  // the #1 root cause. Shown in the technical panel below.
  const [skewMs, setSkewMs] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!isTripped || skewMs !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const t0 = Date.now();
        const res = await fetch("/", { method: "HEAD", cache: "no-store" });
        const t1 = Date.now();
        const dateHeader = res.headers.get("date");
        if (!dateHeader || cancelled) return;
        const server = new Date(dateHeader).getTime();
        if (!Number.isFinite(server)) return;
        // Positive = device clock is ahead of the server.
        setSkewMs(Math.round((t0 + t1) / 2 - server));
      } catch {
        /* offline — leave unknown */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isTripped, skewMs]);

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
    // Clerk auth state, read imperatively (no subscription) — if sessionId
    // differs between lines, the session is flapping.
    authLoaded: clerk.loaded,
    isSignedIn: !!clerk.session,
    sessionId: clerk.session?.id ?? null,
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
  if (isTripped) {
    const skewLine =
      skewMs === null
        ? "clockSkew=checking…"
        : `clockSkew=${skewMs > 0 ? "+" : ""}${(skewMs / 1000).toFixed(1)}s (device vs server)`;
    const clockVerdict =
      skewMs !== null && Math.abs(skewMs) > 60_000
        ? `⚠ device clock is off by ~${Math.round(Math.abs(skewMs) / 60_000)} min — likely the cause\n`
        : "";
    const summary =
      `build=${BUILD_ID} pageLoad=${PAGE_LOAD_ID} trip#${tripCount} renders(${WINDOW_MS / 1000}s)=${renderTimes.length} totalRenders=${renderCount} mounts=${mountCount}\n` +
      `${skewLine} online=${typeof navigator !== "undefined" ? String(navigator.onLine) : "?"}\n` +
      clockVerdict +
      `ua=${typeof navigator !== "undefined" ? navigator.userAgent : "?"}`;
    const snapLines = snaps.slice(-25).map(formatSnap).join("\n");
    const copyDiagnostics = () => {
      const dump = JSON.stringify(
        {
          build: BUILD_ID,
          pageLoadId: PAGE_LOAD_ID,
          at: new Date().toISOString(),
          tripCount,
          rendersInWindow: renderTimes.length,
          totalRenders: renderCount,
          mounts: mountCount,
          clockSkewMs: skewMs,
          online: typeof navigator !== "undefined" ? navigator.onLine : null,
          ua: typeof navigator !== "undefined" ? navigator.userAgent : null,
          renders: snaps.map(formatSnap),
        },
        null,
        1,
      );
      void navigator.clipboard?.writeText(dump).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    };

    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 overflow-y-auto bg-gray-50 px-6 py-8 text-center">
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

        {/* Technical diagnostics — safe to screenshot/share with support.
            `chg` shows which fields changed between consecutive renders:
            sess flapping → session refresh loop; qs/fs/upd flapping → query
            churn; chg=none → the re-render came from a parent provider. */}
        <div className="w-full max-w-2xl text-left">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Technical details
            </p>
            <button
              type="button"
              onClick={copyDiagnostics}
              className="rounded border px-2 py-1 text-xs font-medium hover:bg-gray-100"
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-white p-3 text-left font-mono text-[10px] leading-relaxed text-gray-700">
            {summary + "\n─── last renders ───\n" + snapLines}
          </pre>
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
