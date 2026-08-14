import { api, HydrateClient } from "~/trpc/server";
import { DashboardClient } from "./dashboard-client";

// Authenticated, per-request data — render dynamically (the server-side
// prefetch needs request headers/auth, so it can't be prerendered at build).
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Prefetch the above-the-fold queries on the server so the summary cards
  // render with data on first paint instead of after a client round-trip.
  // AWAITED on purpose: only settled queries are dehydrated now — streaming
  // pending promises into the hydration boundary broke inside the installed
  // PWA and caused the render-storm behind the session recovery screen.
  await Promise.all([
    api.dashboard.getSummary.prefetch(),
    api.onboarding.getStatus.prefetch(),
  ]);

  return (
    <HydrateClient>
      <DashboardClient />
    </HydrateClient>
  );
}
