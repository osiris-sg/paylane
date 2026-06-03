"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import dayjs from "dayjs";
import { toast } from "sonner";
import {
  Upload,
  ExternalLink,
  Download,
  Send,
  Trash2,
  PackageCheck,
  Inbox,
  AlertTriangle,
  Search,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { api } from "~/trpc/react";
import { useSendAccess } from "~/lib/use-send-access";
import { formatCurrency } from "~/lib/currency";

function DeliveryOrdersContent() {
  const { data: access, isLoading } = api.deliveryOrder.getAccess.useQuery();
  const sendAccess = useSendAccess();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  const canSend = access?.canSend ?? false;
  const hasReceived = access?.hasReceived ?? false;
  const defaultTab = canSend ? "sent" : "received";

  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Delivery Orders</h1>
          <p className="text-muted-foreground">
            {canSend
              ? "Upload delivery orders and send them to your customers"
              : "Delivery orders your suppliers have sent you"}
          </p>
        </div>
        {canSend && (
          <Button asChild disabled={!sendAccess.canSend}>
            <Link href="/delivery-orders/upload">
              <Upload className="mr-2 h-4 w-4" />
              Upload Delivery Order
            </Link>
          </Button>
        )}
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          {canSend && (
            <TabsTrigger value="sent" className="font-bold">
              CUSTOMER
            </TabsTrigger>
          )}
          {hasReceived && (
            <TabsTrigger value="received" className="font-bold">
              SUPPLIER
            </TabsTrigger>
          )}
        </TabsList>
        {canSend && (
          <TabsContent value="sent" className="mt-4">
            <SentTable />
          </TabsContent>
        )}
        {hasReceived && (
          <TabsContent value="received" className="mt-4">
            <ReceivedTable />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

export default function DeliveryOrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center p-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        </div>
      }
    >
      <DeliveryOrdersContent />
    </Suspense>
  );
}

function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative mb-3 sm:max-w-sm">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder="Autocomplete search..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9"
      />
    </div>
  );
}

function CountBanner({ count, label }: { count: number; label: string }) {
  return (
    <div className="mb-3 overflow-hidden rounded-xl border-2 border-blue-300 bg-gradient-to-br from-blue-50 via-blue-100/70 to-blue-50 px-4 py-3 shadow-sm dark:border-blue-700 dark:from-blue-950/50 dark:via-blue-900/30 dark:to-blue-950/40">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
          <PackageCheck className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-800 dark:text-blue-200">
            {label}
          </p>
          <p className="text-xl font-bold tabular-nums tracking-tight text-blue-900 dark:text-blue-100 sm:text-2xl">
            {count} delivery order{count === 1 ? "" : "s"}
          </p>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ sentAt }: { sentAt: Date | string | null }) {
  const sent = !!sentAt;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        sent
          ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300"
          : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
      }`}
    >
      {sent ? "Sent" : "Draft"}
    </span>
  );
}

function useDownload() {
  const utils = api.useUtils();
  const [busyId, setBusyId] = useState<string | null>(null);
  const download = async (id: string) => {
    setBusyId(id);
    try {
      const { url, filename } = await utils.deliveryOrder.getDownloadUrl.fetch({ id });
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't download the file");
    } finally {
      setBusyId(null);
    }
  };
  return { download, busyId };
}

function SentTable() {
  const utils = api.useUtils();
  const sendAccess = useSendAccess();
  const list = api.deliveryOrder.listSent.useQuery();
  const { download, busyId } = useDownload();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const send = api.deliveryOrder.send.useMutation({
    onSuccess: () => {
      toast.success("Delivery order sent");
      void utils.deliveryOrder.listSent.invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to send"),
  });
  const del = api.deliveryOrder.delete.useMutation({
    onSuccess: () => {
      toast.success("Delivery order deleted");
      setConfirmDelete(null);
      void utils.deliveryOrder.listSent.invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to delete"),
  });

  if (list.isLoading) return <TableSkeleton />;
  const rows = list.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<PackageCheck className="h-10 w-10 text-muted-foreground" />}
        title="No delivery orders yet"
        body="Upload a delivery order — the AI reads the DO number and customer, then you can send it."
      />
    );
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (d) =>
          d.doNumber.toLowerCase().includes(q) ||
          (d.customer?.company ?? "").toLowerCase().includes(q) ||
          (d.customer?.name ?? "").toLowerCase().includes(q) ||
          d.fileName.toLowerCase().includes(q),
      )
    : rows;

  return (
    <Card>
      <CardContent className="p-3">
        <SearchBar value={search} onChange={setSearch} />
        <CountBanner count={filtered.length} label="Total sent" />
        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No delivery orders match &ldquo;{search}&rdquo;.
          </p>
        ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>DO #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">
                    <Link href={`/delivery-orders/${d.id}`} className="text-blue-600 hover:underline">
                      {d.doNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{d.customer ? d.customer.company || d.customer.name : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="max-w-[150px] truncate text-muted-foreground">{d.reference || "—"}</TableCell>
                  <TableCell className="text-sm">{d.doDate ? dayjs(d.doDate).format("D MMM YYYY") : "—"}</TableCell>
                  <TableCell><StatusBadge sentAt={d.sentAt} /></TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {d.amount != null ? formatCurrency(Number(d.amount), d.currency) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" onClick={() => download(d.id)} disabled={busyId === d.id}>
                        <Download className="mr-1.5 h-3.5 w-3.5" />
                        {busyId === d.id ? "…" : "Download"}
                      </Button>
                      {!d.sentAt && (
                        <Button
                          size="sm"
                          disabled={!sendAccess.canSend || !d.customer || send.isPending}
                          onClick={() => send.mutate({ id: d.id })}
                        >
                          <Send className="mr-1.5 h-3.5 w-3.5" />
                          Send
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-red-300 text-red-600 hover:bg-red-50"
                        onClick={() => setConfirmDelete(d.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        )}

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <DialogTitle>Delete this delivery order?</DialogTitle>
            <DialogDescription>
              This permanently deletes the delivery order and its file.
              <span className="mt-2 block font-medium text-red-600">This cannot be undone.</span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={del.isPending}
              onClick={() => confirmDelete && del.mutate({ id: confirmDelete })}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </CardContent>
    </Card>
  );
}

function ReceivedTable() {
  const list = api.deliveryOrder.listReceived.useQuery();
  const { download, busyId } = useDownload();
  const [search, setSearch] = useState("");

  if (list.isLoading) return <TableSkeleton />;
  const rows = list.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-10 w-10 text-muted-foreground" />}
        title="No delivery orders received"
        body="When a supplier sends you a delivery order, it'll show up here."
      />
    );
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (d) =>
          d.doNumber.toLowerCase().includes(q) ||
          d.senderCompany.name.toLowerCase().includes(q) ||
          d.fileName.toLowerCase().includes(q),
      )
    : rows;

  return (
    <Card>
      <CardContent className="p-3">
        <SearchBar value={search} onChange={setSearch} />
        <CountBanner count={filtered.length} label="Total received" />
        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No delivery orders match &ldquo;{search}&rdquo;.
          </p>
        ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead>DO #</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">
                    <Link href={`/delivery-orders/${d.id}`} className="text-blue-600 hover:underline">
                      {d.doNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{d.senderCompany.name}</TableCell>
                  <TableCell className="max-w-[150px] truncate text-muted-foreground">{d.reference || "—"}</TableCell>
                  <TableCell className="text-sm">{d.doDate ? dayjs(d.doDate).format("D MMM YYYY") : d.sentAt ? dayjs(d.sentAt).format("D MMM YYYY") : "—"}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {d.amount != null ? formatCurrency(Number(d.amount), d.currency) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/delivery-orders/${d.id}`}>
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                          View
                        </Link>
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => download(d.id)} disabled={busyId === d.id}>
                        <Download className="mr-1.5 h-3.5 w-3.5" />
                        {busyId === d.id ? "…" : "Download"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        )}
      </CardContent>
    </Card>
  );
}

function TableSkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-muted/50" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        {icon}
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}
