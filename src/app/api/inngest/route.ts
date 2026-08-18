import { serve } from "inngest/next";
import { inngest } from "~/inngest/client";
import { importContacts } from "~/inngest/functions/import-contacts";

// Inngest calls back into this route to execute function steps. Each step
// runs as its own invocation, so a 400-page import is many short calls
// rather than one long one — no single request needs to outlive the
// serverless timeout.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [importContacts],
});
