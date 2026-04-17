"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { InvoiceTable } from "~/components/invoices/invoice-table";
import { api } from "~/trpc/react";

function InvoicesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data: status } = api.onboarding.getStatus.useQuery();
  const companyModule = status?.module;

  // Default tab based on module
  const canSend = companyModule === "SEND" || companyModule === "BOTH";
  const canReceive = companyModule === "RECEIVE" || companyModule === "BOTH";
  const defaultTab = canReceive && !canSend ? "received" : "sent";
  const activeTab = searchParams.get("tab") ?? defaultTab;

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    params.delete("page");
    params.delete("search");
    params.delete("status");
    router.push(`/invoices?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-4 p-3 md:gap-6 md:p-6">
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
            <Button variant="outline" asChild>
              <Link href="/invoices/upload">
                <Upload className="mr-2 h-4 w-4" />
                Upload Invoice
              </Link>
            </Button>
            <Button asChild>
              <Link href="/invoices/new">
                <Plus className="mr-2 h-4 w-4" />
                Create Invoice
              </Link>
            </Button>
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          {canSend && <TabsTrigger value="sent">Sent Invoices</TabsTrigger>}
          {canReceive && <TabsTrigger value="received">Received Invoices</TabsTrigger>}
        </TabsList>
        {canSend && (
          <TabsContent value="sent" className="mt-4">
            <InvoiceTable type="sent" />
          </TabsContent>
        )}
        {canReceive && (
          <TabsContent value="received" className="mt-4">
            <InvoiceTable type="received" />
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
