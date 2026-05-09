"use client";

import { ImportContacts } from "~/components/contacts/import-contacts";
import { useSendAccess } from "~/lib/use-send-access";
import { LockedSendingCTA } from "~/components/subscription/locked-sending-cta";
import { ExpiredBanner } from "~/components/subscription/expired-banner";

export default function ImportCustomersPage() {
  const access = useSendAccess();

  if (access.state === "loading") return null;

  if (access.state === "locked") {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-3xl font-bold tracking-tight">Import Customers</h1>
        <LockedSendingCTA />
      </div>
    );
  }

  if (access.state === "expired") {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-3xl font-bold tracking-tight">Import Customers</h1>
        <ExpiredBanner message="Your free trial has ended. Upgrade to import customers." />
      </div>
    );
  }

  return <ImportContacts kind="customers" />;
}
