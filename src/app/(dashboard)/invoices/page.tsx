"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { InvoiceTable } from "~/components/invoices/invoice-table";

function InvoicesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "sent";

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    params.delete("page");
    params.delete("search");
    params.delete("status");
    router.push(`/invoices?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Invoices</h1>
          <p className="text-muted-foreground">
            Manage your sent and received invoices
          </p>
        </div>
        <Button asChild>
          <Link href="/invoices/new">
            <Plus className="mr-2 h-4 w-4" />
            Create Invoice
          </Link>
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="sent">Sent Invoices</TabsTrigger>
          <TabsTrigger value="received">Received Invoices</TabsTrigger>
        </TabsList>
        <TabsContent value="sent" className="mt-4">
          <InvoiceTable type="sent" />
        </TabsContent>
        <TabsContent value="received" className="mt-4">
          <InvoiceTable type="received" />
        </TabsContent>
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
