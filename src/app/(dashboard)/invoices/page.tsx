import { api, HydrateClient } from "~/trpc/server";
import { InvoicesClient } from "./invoices-client";

// Server-rendered per request (the prefetch needs request headers/auth).
export const dynamic = "force-dynamic";

export default function InvoicesPage() {
  // Prefetch the page-chrome queries on the server so the tabs, badges,
  // send-access state and customer filter render on first paint without a
  // client round-trip. `invoice.list` is intentionally left to the client —
  // its input depends on the active tab + URL filters resolved client-side,
  // and it's now index-backed so it returns quickly on its own.
  void api.onboarding.getStatus.prefetch();
  void api.invoice.getTabCounts.prefetch();
  void api.subscription.getStatus.prefetch();
  void api.featureFlag.getAll.prefetch();
  void api.customer.list.prefetch({ limit: 100 });

  return (
    <HydrateClient>
      <InvoicesClient />
    </HydrateClient>
  );
}
