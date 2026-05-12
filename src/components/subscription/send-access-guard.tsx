"use client";

import { useSendAccess } from "~/lib/use-send-access";
import { LockedSendingCTA } from "~/components/subscription/locked-sending-cta";
import { ExpiredBanner } from "~/components/subscription/expired-banner";

/**
 * Client-side guard for sender-only routes (e.g. /invoices/new, /invoices/upload).
 * Renders a locked CTA or expired banner instead of the form when access is denied.
 * Server still enforces this — this is purely a UX shortcut.
 */
export function SendAccessGuard({
  children,
  title,
  lockedTitle,
  lockedBody,
  expiredMessage,
}: {
  children: React.ReactNode;
  title: string;
  lockedTitle?: string;
  lockedBody?: string;
  expiredMessage?: string;
}) {
  const access = useSendAccess();

  if (access.state === "loading") return null;

  if (access.state === "locked") {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <LockedSendingCTA title={lockedTitle} body={lockedBody} />
      </div>
    );
  }

  if (access.state === "expired") {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <ExpiredBanner message={expiredMessage} />
      </div>
    );
  }

  return <>{children}</>;
}
