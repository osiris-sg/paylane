import { api, HydrateClient } from "~/trpc/server";
import { DashboardClient } from "./dashboard-client";

// Authenticated, per-request data — render dynamically (the server-side
// prefetch needs request headers/auth, so it can't be prerendered at build).
export const dynamic = "force-dynamic";

export default function DashboardPage() {
  // Prefetch the above-the-fold queries on the server so the summary cards
  // render with data on first paint instead of after a client round-trip.
  // (Non-blocking `void` — results stream into the hydration boundary.)
  void api.dashboard.getSummary.prefetch();
  void api.onboarding.getStatus.prefetch();

  return (
    <HydrateClient>
      <DashboardClient />
    </HydrateClient>
  );
}
