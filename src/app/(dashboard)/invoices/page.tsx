"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { InvoiceTable } from "~/components/invoices/invoice-table";
import { api } from "~/trpc/react";
import { useSendAccess } from "~/lib/use-send-access";
import { ExpiredBanner } from "~/components/subscription/expired-banner";
import { LockedSendingCTA } from "~/components/subscription/locked-sending-cta";

function InvoicesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data: status } = api.onboarding.getStatus.useQuery();
  const companyModule = status?.module;
  const access = useSendAccess();
  const sendDisabled = !access.canSend;
  const counts = api.invoice.getTabCounts.useQuery();

  // Default tab based on module
  const canSend = companyModule === "SEND" || companyModule === "BOTH";
  const canReceive = companyModule === "RECEIVE" || companyModule === "BOTH";
  const defaultTab = canReceive && !canSend ? "received" : "sent";
  const requestedTab = searchParams.get("tab") ?? defaultTab;
  // If the requested tab isn't available for this user's module, fall back
  const activeTab =
    (requestedTab === "sent" && canSend) || (requestedTab === "received" && canReceive)
      ? requestedTab
      : defaultTab;

  const urlStatus = searchParams.get("status") ?? undefined;
  const urlSearch = searchParams.get("search") ?? undefined;
  const urlCustomerId = searchParams.get("customerId") ?? undefined;
  const urlSenderCompanyId = searchParams.get("senderCompanyId") ?? undefined;

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    params.delete("page");
    params.delete("search");
    params.delete("status");
    router.push(`/invoices?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Invoices</h1>
          <p className="text-muted-foreground">
            {canSend && canReceive
              ? "Manage your sent and received invoices"
              : canSend
                ? "Manage your sent invoices"
                : "Manage your received invoices"}
          </p>
        </div>
        {canSend && (
          <div className="flex flex-wrap items-center gap-2">
            {sendDisabled ? (
              <Button variant="outline" disabled>
                <Upload className="mr-2 h-4 w-4" />
                Upload Invoice
              </Button>
            ) : (
              <Button variant="outline" asChild>
                <Link href="/invoices/upload">
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Invoice
                </Link>
              </Button>
            )}
            {sendDisabled ? (
              <Button disabled>
                <Plus className="mr-2 h-4 w-4" />
                Create Invoice
              </Button>
            ) : (
              <Button asChild>
                <Link href="/invoices/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Invoice
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>

      {canSend && access.state === "locked" && (
        <LockedSendingCTA
          title="Sending invoices is locked"
          body="Start your free 14-day trial to create and send invoices to your customers."
        />
      )}
      {canSend && access.state === "expired" && (
        <ExpiredBanner message="Your free trial has ended. Upgrade to create or send new invoices." />
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          {canSend && (
            <TabsTrigger value="sent" className="font-bold">
              CUSTOMER
              <TabBadge count={counts.data?.unviewedByRecipient ?? 0} />
            </TabsTrigger>
          )}
          {canReceive && (
            <TabsTrigger value="received" className="font-bold">
              SUPPLIER
              <TabBadge count={counts.data?.newReceived ?? 0} />
            </TabsTrigger>
          )}
        </TabsList>
        {canSend && (
          <TabsContent value="sent" className="mt-4">
            <InvoiceTable type="sent" initialStatus={urlStatus} initialSearch={urlSearch} initialCustomerId={urlCustomerId} />
          </TabsContent>
        )}
        {canReceive && (
          <TabsContent value="received" className="mt-4">
            <InvoiceTable type="received" initialStatus={urlStatus} initialSearch={urlSearch} initialCustomerId={urlCustomerId} initialSenderCompanyId={urlSenderCompanyId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

export default function InvoicesPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center p-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" /></div>}>
      <InvoicesContent />
    </Suspense>
  );
}

function TabBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold leading-none text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}
