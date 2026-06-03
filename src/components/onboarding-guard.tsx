"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { api } from "~/trpc/react";

// Set ONCE per full page load (module evaluation). If this value DIFFERS
// between repeated console lines, the page is hard-RELOADING (not re-rendering).
const PAGE_LOAD_ID = Math.random().toString(36).slice(2, 8);
const PAGE_LOAD_AT = Date.now();

// Module-level counters survive component remounts within the same page load.
let renderCount = 0;
let mountCount = 0;

export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const q = api.onboarding.getStatus.useQuery();
  const { data: status, isLoading, error } = q;
  const needsOnboarding = !!status && !status.onboarded;

  renderCount += 1;
  // Rich diagnostic to find the loop cause. Read the FIRST few lines:
  //  - pageLoadId changes each line  → full PAGE RELOAD loop
  //  - mountCount climbs (same id)   → component REMOUNT loop (nav/key churn)
  //  - only renderCount climbs       → in-page RE-RENDER loop; check fetchStatus
  //  - fetchStatus flips fetching    → getStatus REFETCH loop
  //  - pathname changes              → NAVIGATION loop
  console.log("[OG]", {
    pageLoadId: PAGE_LOAD_ID,
    navType:
      typeof performance !== "undefined"
        ? (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type
        : undefined,
    msSinceLoad: Date.now() - PAGE_LOAD_AT,
    renderCount,
    mountCount,
    pathname,
    online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    visibility: typeof document !== "undefined" ? document.visibilityState : undefined,
    isLoading,
    isFetching: q.isFetching,
    fetchStatus: q.fetchStatus,
    queryStatus: q.status,
    dataUpdatedAt: q.dataUpdatedAt,
    errorUpdateCount: q.errorUpdateCount,
    failureCount: q.failureCount,
    hasError: !!error,
    errorMsg: error?.message,
    onboarded: status?.onboarded,
    needsOnboarding,
  });

  useEffect(() => {
    mountCount += 1;
    console.log("[OG] MOUNT", { pageLoadId: PAGE_LOAD_ID, mountCount });
    return () => console.log("[OG] UNMOUNT", { pageLoadId: PAGE_LOAD_ID, mountCount });
  }, []);

  // Trigger the redirect from an effect, not during render. Calling
  // router.replace synchronously while rendering can cause invalid-element
  // errors (React #300) when the next page mounts mid-flush.
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (needsOnboarding && !redirectedRef.current) {
      redirectedRef.current = true;
      console.log("[OG] redirecting to /onboarding");
      router.replace("/onboarding");
    }
  }, [needsOnboarding, router]);

  if (isLoading || needsOnboarding) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
