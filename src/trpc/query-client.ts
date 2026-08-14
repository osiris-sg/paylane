import {
  defaultShouldDehydrateQuery,
  QueryClient,
} from "@tanstack/react-query";
import SuperJSON from "superjson";

/**
 * Shared QueryClient factory used by both the client provider (react.tsx)
 * and the server-side RSC prefetch helper (server.ts). The SuperJSON
 * (de)serialization config lets queries prefetched on the server hydrate
 * cleanly on the client.
 *
 * Deliberately NOT dehydrating "pending" queries: streaming an in-flight
 * promise into the hydration boundary breaks inside the installed PWA (the
 * service worker interferes with the streamed RSC payload), which left the
 * hydrated entry flip-flopping success↔pending in a tight loop — the render
 * storm behind the "trouble loading your session" screen. RSC pages must
 * `await` their prefetches instead so only settled data is dehydrated.
 */
export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        staleTime: 30 * 1000,
      },
      dehydrate: {
        serializeData: SuperJSON.serialize,
        shouldDehydrateQuery: defaultShouldDehydrateQuery,
      },
      hydrate: {
        deserializeData: SuperJSON.deserialize,
      },
    },
  });
