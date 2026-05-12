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
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild={!sendDisabled} disabled={sendDisabled}>
              {sendDisabled ? (
                <span className="cursor-not-allowed">
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Invoice
                </span>
              ) : (
                <Link href="/invoices/upload">
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Invoice
                </Link>
              )}
            </Button>
            <Button asChild={!sendDisabled} disabled={sendDisabled}>
              {sendDisabled ? (
                <span className="cursor-not-allowed">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Invoice
                </span>
              ) : (
                <Link href="/invoices/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Invoice
                </Link>
              )}
            </Button>
          </div>
        )}
      </div>

      {canSend && access.state === "locked" && <LockedSendingCTA />}
      {canSend && access.state === "expired" && <ExpiredBanner />}

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          {canSend && <TabsTrigger value="sent" className="font-bold">CUSTOMER</TabsTrigger>}
          {canReceive && <TabsTrigger value="received" className="font-bold">SUPPLIER</TabsTrigger>}
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
