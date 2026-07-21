"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import { keepPreviousData } from "@tanstack/react-query";
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
import { Checkbox } from "~/components/ui/checkbox";
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
import { useRowSelection } from "~/lib/use-row-selection";
import {
  ALL_DATES,
  resolveDateRange,
  type DateFilterValue,
} from "~/components/filters/date-filter";
import { FilterMenu, EntityFilterSection } from "~/components/filters/filter-menu";
import { TablePagination } from "~/components/table-pagination";

const PAGE_SIZE = 10;

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
  const trigger = async (id: string) => {
    const { url, filename } = await utils.deliveryOrder.getDownloadUrl.fetch({ id });
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const download = async (id: string) => {
    setBusyId(id);
    try {
      await trigger(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't download the file");
    } finally {
      setBusyId(null);
    }
  };
  // Bundle several DO files into one zip (built server-side) and download it.
  const downloadZip = async (ids: string[]) => {
    setBusyId("bulk");
    try {
      const res = await fetch("/api/delivery-orders/download-zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Couldn't build the zip");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "delivery-orders.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't download the files");
    } finally {
      setBusyId(null);
    }
  };
  return { download, downloadZip, busyId };
}

function SentTable() {
  const utils = api.useUtils();
  const sendAccess = useSendAccess();
  const { download, downloadZip, busyId } = useDownload();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilterValue>(ALL_DATES);
  const [customerId, setCustomerId] = useState<string | undefined>(undefined);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const dateRange = resolveDateRange(dateFilter);
  const list = api.deliveryOrder.listSent.useQuery(
    {
      page,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      customerId: customerId || undefined,
      dateFrom: dateRange?.from,
      dateTo: dateRange?.to,
    },
    { placeholderData: keepPreviousData },
  );
  const { data: customerOptions } = api.deliveryOrder.sentCustomers.useQuery();

  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  // Row ids in display order — drives select-all and shift-click ranges.
  const rowIds = useMemo(() => rows.map((d) => d.id), [rows]);
  const {
    selectedIds,
    setSelectedIds,
    toggle: toggleSelect,
    toggleAll: toggleSelectAll,
    isAllSelected,
    isSomeSelected,
  } = useRowSelection(rowIds);
  const totalCount = list.data?.totalCount ?? 0;
  const totalPages = list.data?.totalPages ?? 1;
  const hasFilters =
    !!debouncedSearch || !!customerId || dateFilter.preset !== "all";

  const send = api.deliveryOrder.send.useMutation({
    onError: (e) => toast.error(e.message || "Failed to send"),
  });
  const bulkDelete = api.deliveryOrder.bulkDelete.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.count} delivery order(s) deleted`);
      setSelectedIds(new Set());
      setConfirmOpen(false);
      void utils.deliveryOrder.listSent.invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to delete"),
  });

  const single =
    selectedIds.size === 1 ? rows.find((d) => selectedIds.has(d.id)) ?? null : null;
  const anyDraftSelected = rows.some((d) => selectedIds.has(d.id) && !d.sentAt);

  const handleBulkSend = async () => {
    const toSend = rows.filter((d) => selectedIds.has(d.id) && !d.sentAt && d.customer);
    for (const d of toSend) {
      try { await send.mutateAsync({ id: d.id }); } catch {}
    }
    setSelectedIds(new Set());
    void utils.deliveryOrder.listSent.invalidate();
    if (toSend.length) toast.success(`${toSend.length} delivery order(s) sent`);
  };

  if (list.isLoading) return <TableSkeleton />;
  if (totalCount === 0 && !hasFilters) {
    return (
      <EmptyState
        icon={<PackageCheck className="h-10 w-10 text-muted-foreground" />}
        title="No delivery orders yet"
        body="Upload a delivery order — the AI reads the DO number and customer, then you can send it."
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-3">
        {/* Fixed-height control bar — swaps between search and selection actions
            so selecting never shifts the table (matches invoices/statements). */}
        <div className="mb-3 h-10">
          {isSomeSelected ? (
            <div className="flex h-10 items-center gap-2 overflow-x-auto whitespace-nowrap">
              <span className="shrink-0 text-sm font-medium">{selectedIds.size} selected</span>
              {single && (
                <Button size="sm" variant="outline" className="shrink-0" asChild>
                  <Link href={`/delivery-orders/${single.id}`}>
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    View
                  </Link>
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                disabled={busyId !== null}
                onClick={() =>
                  single ? download(single.id) : downloadZip(Array.from(selectedIds))
                }
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                {busyId === "bulk" ? "Zipping…" : "Download"}
              </Button>
              {anyDraftSelected && (
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={!sendAccess.canSend || send.isPending}
                  onClick={handleBulkSend}
                >
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  Send
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 border-red-300 text-red-600 hover:bg-red-50"
                disabled={bulkDelete.isPending}
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                {bulkDelete.isPending ? "Deleting..." : "Delete"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto shrink-0"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </Button>
            </div>
          ) : (
            <div className="flex h-10 items-center gap-2">
              <div className="relative flex-1 sm:max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Autocomplete search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <FilterMenu
                date={dateFilter}
                onDateChange={(v) => {
                  setDateFilter(v);
                  setPage(1);
                }}
                extraActiveCount={customerId ? 1 : 0}
                onClearExtra={() => {
                  setCustomerId(undefined);
                  setPage(1);
                }}
              >
                <EntityFilterSection
                  label="Customer"
                  options={customerOptions ?? []}
                  selectedId={customerId}
                  onChange={(id) => {
                    setCustomerId(id);
                    setPage(1);
                  }}
                />
              </FilterMenu>
            </div>
          )}
        </div>

        <CountBanner count={totalCount} label="Total sent" />

        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {debouncedSearch
              ? <>No delivery orders match &ldquo;{debouncedSearch}&rdquo;.</>
              : "No delivery orders match your filters."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={isAllSelected} onCheckedChange={toggleSelectAll} aria-label="Select all" />
                  </TableHead>
                  <TableHead>DO #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => {
                  const isSelected = selectedIds.has(d.id);
                  return (
                    <TableRow
                      key={d.id}
                      onClick={(e) => toggleSelect(d.id, e)}
                      className={`cursor-pointer select-none ${isSelected ? "bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30" : ""}`}
                    >
                      <TableCell>
                        <Checkbox
                          checked={isSelected}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelect(d.id, e);
                          }}
                          aria-label={`Select ${d.doNumber}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link
                          href={`/delivery-orders/${d.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-blue-600 hover:underline"
                        >
                          {d.doNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{d.customer ? d.customer.company || d.customer.name : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="max-w-[150px] truncate text-muted-foreground">{d.reference || "—"}</TableCell>
                      <TableCell className="text-sm">{d.doDate ? dayjs(d.doDate).format("D MMM YYYY") : "—"}</TableCell>
                      <TableCell><StatusBadge sentAt={d.sentAt} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <TablePagination
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <DialogTitle>Delete selected delivery orders?</DialogTitle>
            <DialogDescription>
              {selectedIds.size} delivery order(s) will be permanently deleted.
              <span className="mt-2 block font-medium text-red-600">This cannot be undone.</span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={bulkDelete.isPending}
              onClick={() => bulkDelete.mutate({ ids: Array.from(selectedIds) })}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ReceivedTable() {
  const { download, downloadZip, busyId } = useDownload();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilterValue>(ALL_DATES);
  const [supplierId, setSupplierId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const dateRange = resolveDateRange(dateFilter);
  const list = api.deliveryOrder.listReceived.useQuery(
    {
      page,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      supplierId: supplierId || undefined,
      dateFrom: dateRange?.from,
      dateTo: dateRange?.to,
    },
    { placeholderData: keepPreviousData },
  );
  const { data: supplierOptions } = api.deliveryOrder.receivedSuppliers.useQuery();

  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  // Row ids in display order — drives select-all and shift-click ranges.
  const rowIds = useMemo(() => rows.map((d) => d.id), [rows]);
  const {
    selectedIds,
    toggle: toggleSelect,
    toggleAll: toggleSelectAll,
    clear: clearSelection,
    isAllSelected,
    isSomeSelected,
  } = useRowSelection(rowIds);
  const totalCount = list.data?.totalCount ?? 0;
  const totalPages = list.data?.totalPages ?? 1;
  const hasFilters =
    !!debouncedSearch || !!supplierId || dateFilter.preset !== "all";

  const single =
    selectedIds.size === 1 ? rows.find((d) => selectedIds.has(d.id)) ?? null : null;

  if (list.isLoading) return <TableSkeleton />;
  if (totalCount === 0 && !hasFilters) {
    return (
      <EmptyState
        icon={<Inbox className="h-10 w-10 text-muted-foreground" />}
        title="No delivery orders received"
        body="When a supplier sends you a delivery order, it'll show up here."
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-3">
        <div className="mb-3 h-10">
          {isSomeSelected ? (
            <div className="flex h-10 items-center gap-2 overflow-x-auto whitespace-nowrap">
              <span className="shrink-0 text-sm font-medium">{selectedIds.size} selected</span>
              {single && (
                <Button size="sm" variant="outline" className="shrink-0" asChild>
                  <Link href={`/delivery-orders/${single.id}`}>
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    View
                  </Link>
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                disabled={busyId !== null}
                onClick={() =>
                  single ? download(single.id) : downloadZip(Array.from(selectedIds))
                }
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                {busyId === "bulk" ? "Zipping…" : "Download"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto shrink-0"
                onClick={clearSelection}
              >
                Clear
              </Button>
            </div>
          ) : (
            <div className="flex h-10 items-center gap-2">
              <div className="relative flex-1 sm:max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Autocomplete search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <FilterMenu
                date={dateFilter}
                onDateChange={(v) => {
                  setDateFilter(v);
                  setPage(1);
                }}
                extraActiveCount={supplierId ? 1 : 0}
                onClearExtra={() => {
                  setSupplierId(undefined);
                  setPage(1);
                }}
              >
                <EntityFilterSection
                  label="Supplier"
                  options={supplierOptions ?? []}
                  selectedId={supplierId}
                  onChange={(id) => {
                    setSupplierId(id);
                    setPage(1);
                  }}
                />
              </FilterMenu>
            </div>
          )}
        </div>

        <CountBanner count={totalCount} label="Total received" />

        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {debouncedSearch
              ? <>No delivery orders match &ldquo;{debouncedSearch}&rdquo;.</>
              : "No delivery orders match your filters."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table className="min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={isAllSelected} onCheckedChange={toggleSelectAll} aria-label="Select all" />
                  </TableHead>
                  <TableHead>DO #</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => {
                  const isSelected = selectedIds.has(d.id);
                  return (
                    <TableRow
                      key={d.id}
                      onClick={(e) => toggleSelect(d.id, e)}
                      className={`cursor-pointer select-none ${isSelected ? "bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30" : ""}`}
                    >
                      <TableCell>
                        <Checkbox
                          checked={isSelected}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelect(d.id, e);
                          }}
                          aria-label={`Select ${d.doNumber}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link
                          href={`/delivery-orders/${d.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-blue-600 hover:underline"
                        >
                          {d.doNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{d.senderCompany.name}</TableCell>
                      <TableCell className="max-w-[150px] truncate text-muted-foreground">{d.reference || "—"}</TableCell>
                      <TableCell className="text-sm">{d.doDate ? dayjs(d.doDate).format("D MMM YYYY") : d.sentAt ? dayjs(d.sentAt).format("D MMM YYYY") : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <TablePagination
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
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
