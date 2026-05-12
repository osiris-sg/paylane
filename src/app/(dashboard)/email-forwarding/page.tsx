"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Copy, Check, Mail, ExternalLink } from "lucide-react";

export default function EmailForwardingPage() {
  const integrationQ = api.emailIntegration.get.useQuery();
  const recentQ = api.emailIntegration.recentIngested.useQuery();
  const [copied, setCopied] = useState(false);

  const address = integrationQ.data?.forwardingAddress;

  const copyAddress = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    toast.success("Address copied");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Email forwarding</h1>
        <p className="text-sm text-gray-600">
          Auto-import invoices by forwarding them to your unique paylane address.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Your forwarding address
          </CardTitle>
        </CardHeader>
        <CardContent>
          {integrationQ.isLoading ? (
            <div className="text-sm text-gray-500">Loading…</div>
          ) : !integrationQ.data?.configured ? (
            <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              Email forwarding isn&apos;t configured yet. An admin needs to set{" "}
              <code>CLOUDMAILIN_INBOUND_ADDRESS</code> in the environment.
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md border bg-gray-50 p-3">
              <code className="flex-1 break-all font-mono text-sm">{address}</code>
              <Button size="sm" variant="outline" onClick={copyAddress}>
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How to set this up</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-gray-700">
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              <strong>Open Gmail</strong> → Settings (gear icon) → <em>See all settings</em> →{" "}
              <em>Forwarding and POP/IMAP</em>.
            </li>
            <li>
              Click <strong>Add a forwarding address</strong> and paste your paylane address from
              above. Gmail will send a confirmation code to that address.
            </li>
            <li>
              The confirmation will appear in your{" "}
              <Link href="#recent" className="text-blue-600 underline">
                recent emails
              </Link>{" "}
              below — open it and click the verification link inside, or paste the code back into
              Gmail.
            </li>
            <li>
              Back in Gmail settings, go to <strong>Filters and Blocked Addresses</strong> →{" "}
              <strong>Create a new filter</strong>. Use this search:
              <pre className="mt-1 overflow-x-auto rounded bg-gray-100 px-2 py-1 font-mono text-xs">
                subject:(invoice OR bill OR receipt) has:attachment filename:pdf
              </pre>
            </li>
            <li>
              Click <strong>Create filter</strong> → tick <em>Forward it to</em> and select your
              paylane address.
            </li>
          </ol>
          <p className="text-xs text-gray-500">
            Outlook works the same way — set up a forwarding rule that matches on subject and
            forwards to your paylane address.
          </p>
        </CardContent>
      </Card>

      <Card id="recent">
        <CardHeader>
          <CardTitle>Recent emails</CardTitle>
        </CardHeader>
        <CardContent>
          {recentQ.isLoading ? (
            <div className="text-sm text-gray-500">Loading…</div>
          ) : (recentQ.data ?? []).length === 0 ? (
            <div className="text-sm text-gray-500">
              No emails yet. Forward one to your address and refresh.
            </div>
          ) : (
            <div className="divide-y">
              {recentQ.data!.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {row.subject ?? "(no subject)"}
                    </div>
                    <div className="truncate text-xs text-gray-500">
                      from {row.fromAddress} ·{" "}
                      {new Date(row.receivedAt).toLocaleString()}
                    </div>
                  </div>
                  <StatusBadge status={row.status} />
                  {row.invoice && (
                    <Link
                      href={`/invoices/${row.invoice.id}`}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    >
                      {row.invoice.invoiceNumber}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    PARSED: "default",
    RECEIVED: "outline",
    IGNORED: "secondary",
    FAILED: "destructive",
  };
  return <Badge variant={tone[status] ?? "outline"}>{status.toLowerCase()}</Badge>;
}
