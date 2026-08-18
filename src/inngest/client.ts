import { Inngest } from "inngest";

/**
 * Inngest client. Events are typed here so `inngest.send()` and the
 * functions that consume them agree on the payload shape.
 *
 * Locally: `npx inngest-cli@latest dev` gives you a dev server + UI at
 * http://localhost:8288 that discovers /api/inngest automatically.
 * Production: set INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY (Vercel integration
 * does this for you) and register the app at /api/inngest.
 */
export const inngest = new Inngest({
  id: "estatementnow",
  schemas: undefined,
});

export type ImportRequestedEvent = {
  name: "import/contacts.requested";
  data: { jobId: string };
};
