import { api, HydrateClient } from "~/trpc/server";
import { InvoicesClient } from "./invoices-client";

// Server-rendered per request (the prefetch needs request headers/auth).
export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  // Prefetch the page-chrome queries on the server so the tabs, send-access
  // state and customer filter render on first paint without a client
  // round-trip. `invoice.list` is intentionally left to the client — its input
  // depends on the active tab + URL filters resolved client-side, and it's now
  // index-backed so it returns quickly on its own.
  // AWAITED on purpose: only settled queries are dehydrated now — streaming
  // pending promises into the hydration boundary broke inside the installed
  // PWA and caused the render-storm behind the session recovery screen.
  await Promise.all([
    api.onboarding.getStatus.prefetch(),
    api.subscription.getStatus.prefetch(),
    api.featureFlag.getAll.prefetch(),
    api.customer.list.prefetch({ limit: 100 }),
  ]);

  return (
    <HydrateClient>
      <InvoicesClient />
    </HydrateClient>
  );
}
