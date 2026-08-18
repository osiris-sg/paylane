import { Suspense } from "react";
import { ImportContacts } from "~/components/contacts/import-contacts";

// ImportContacts reads ?job=<id> via useSearchParams, which needs a Suspense
// boundary so the page can still be statically prerendered.
export default function ImportSuppliersPage() {
  return (
    <Suspense fallback={null}>
      <ImportContacts kind="suppliers" />
    </Suspense>
  );
}
