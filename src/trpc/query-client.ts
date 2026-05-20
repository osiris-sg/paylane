import {
  defaultShouldDehydrateQuery,
  QueryClient,
} from "@tanstack/react-query";
import SuperJSON from "superjson";

/**
 * Shared QueryClient factory used by both the client provider (react.tsx)
 * and the server-side RSC prefetch helper (server.ts). The SuperJSON
 * (de)serialization config lets queries prefetched on the server hydrate
 * cleanly on the client — including in-flight ("pending") queries, so a
 * page can stream prefetched data without an extra client round-trip.
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
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
      hydrate: {
        deserializeData: SuperJSON.deserialize,
      },
    },
  });
