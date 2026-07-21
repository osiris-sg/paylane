"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { toast } from "sonner";
import {
  Send,
  Upload,
  FileText,
  ExternalLink,
  MailCheck,
  Inbox,
  Trash2,
  AlertTriangle,
  Search,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { api } from "~/trpc/react";
import { SendStatementDialog } from "~/components/statements/send-statement-dialog";
import { ExpiredBanner } from "~/components/subscription/expired-banner";
import { LockedSendingCTA } from "~/components/subscription/locked-sending-cta";
import { useSendAccess } from "~/lib/use-send-access";
import { useRowSelection } from "~/lib/use-row-selection";
import {
  ALL_DATES,
  resolveDateRange,
  type DateFilterValue,
} from "~/components/filters/date-filter";
import { FilterMenu, EntityFilterSection } from "~/components/filters/filter-menu";
import { TablePagination } from "~/components/table-pagination";

dayjs.extend(relativeTime);

const PAGE_SIZE = 10;

function StatementsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: status } = api.onboarding.getStatus.useQuery();
  const companyModule = status?.module;
  const canSend = companyModule === "SEND" || companyModule === "BOTH";
  const canReceive = companyModule === "RECEIVE" || companyModule === "BOTH";
  const access = useSendAccess();

  const defaultTab = canReceive && !canSend ? "received" : "sent";
  const requested = searchParams.get("tab") ?? defaultTab;
  const activeTab =
    (requested === "sent" && canSend) || (requested === "received" && canReceive)
      ? requested
      : defaultTab;

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.push(`/statements?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Statements
          </h1>
          <p className="text-muted-foreground">
            {canSend && canReceive
              ? "Manage statements you've sent and received"
              : canSend
                ? "Manage statements you've sent to your customers"
                : "Manage statements you've received from suppliers"}
          </p>
        </div>
        {canSend &&
          (access.canSend ? (
            <Button asChild>
              <Link href="/customers/send-statements">
                <Upload className="mr-2 h-4 w-4" />
                Bulk send
              </Link>
            </Button>
          ) : (
            <Button disabled>
              <Upload className="mr-2 h-4 w-4" />
              Bulk send
            </Button>
          ))}
      </div>

      {canSend && access.state === "expired" && (
        <ExpiredBanner message="Your free trial has ended. Upgrade to send statements again." />
      )}
      {canSend && access.state === "locked" && (
        <LockedSendingCTA
          title="Statements are locked"
          body="Start your free 14-day trial to send and manage statements of account."
        />
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          {canSend && (
            <TabsTrigger value="sent" className="font-bold">
              CUSTOMER
            </TabsTrigger>
          )}
          {canReceive && (
            <TabsTrigger value="received" className="font-bold">
              SUPPLIER
            </TabsTrigger>
          )}
        </TabsList>
        {canSend && (
          <TabsContent value="sent" className="mt-4">
            <SentStatementsTable />
          </TabsContent>
        )}
        {canReceive && (
          <TabsContent value="received" className="mt-4">
            <ReceivedStatementsTable />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

export default function StatementsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center p-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        </div>
      }
    >
      <StatementsContent />
    </Suspense>
  );
}

function SentStatementsTable() {
  const access = useSendAccess();
  const utils = api.useUtils();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilterValue>(ALL_DATES);
  const [customerId, setCustomerId] = useState<string | undefined>(undefined);
  const [replaceFor, setReplaceFor] = useState<{
    customerId: string;
    customerLabel: string;
  } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Debounce the search box so we don't hit the server on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const dateRange = resolveDateRange(dateFilter);
  const list = api.statement.listSent.useQuery(
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
  const { data: customerOptions } = api.statement.sentCustomers.useQuery();

  const rows = useMemo(() => list.data?.statements ?? [], [list.data]);
  // Row ids in display order — drives select-all and shift-click ranges.
  const rowIds = useMemo(() => rows.map((s) => s.id), [rows]);
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

  const bulkDelete = api.statement.bulkDelete.useMutation({
    onSuccess: async (data) => {
      toast.success(`${data.count} statement(s) deleted`);
      setSelectedIds(new Set());
      await utils.statement.listSent.invalidate();
      void utils.statement.getTabCounts.invalidate();
    },
    onError: () => toast.error("Failed to delete statements"),
  });

  const canDelete = access.canSend && isSomeSelected;
  // View + Replace act on one statement, so they only appear when exactly one
  // row is selected (Delete still works for any number).
  const singleSelected =
    selectedIds.size === 1
      ? rows.find((s) => selectedIds.has(s.id)) ?? null
      : null;

  if (list.isLoading) return <TableSkeleton />;
  if (totalCount === 0 && !hasFilters) {
    return (
      <EmptyState
        icon={<MailCheck className="h-10 w-10 text-muted-foreground" />}
        title="No statements sent yet"
        body="Send a statement from any customer's detail page, or use Bulk send to upload several at once."
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-3">
        {/* Fixed-height control bar — swaps between search and the selection
            actions so selecting never shifts the table down (matches invoices). */}
        <div className="mb-3 h-10">
          {isSomeSelected ? (
            <div className="flex h-10 items-center gap-2 overflow-x-auto whitespace-nowrap">
              <span className="shrink-0 text-sm font-medium">
                {selectedIds.size} selected
              </span>
          {singleSelected && (
            <>
              <Button size="sm" variant="outline" className="shrink-0" asChild>
                <a
                  href={singleSelected.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  View
                </a>
              </Button>
              <Button
                size="sm"
                className="shrink-0"
                disabled={!access.canSend}
                onClick={() =>
                  setReplaceFor({
                    customerId: singleSelected.customer.id,
                    customerLabel:
                      singleSelected.customer.company ||
                      singleSelected.customer.name,
                  })
                }
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Replace
              </Button>
            </>
          )}
          {canDelete && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmOpen(true)}
              disabled={bulkDelete.isPending}
              className="shrink-0 border-red-300 text-red-600 hover:bg-red-50"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {bulkDelete.isPending ? "Deleting..." : "Delete"}
            </Button>
          )}
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
              ? <>No statements match &ldquo;{debouncedSearch}&rdquo;.</>
              : "No statements match your filters."}
          </p>
        ) : (
          <>
      {/* Mobile: card per statement */}
      <div className="space-y-3 md:hidden">
        {rows.map((s) => {
          const isSelected = selectedIds.has(s.id);
          return (
          <div
            key={s.id}
            onClick={(e) => toggleSelect(s.id, e)}
            className={`cursor-pointer select-none rounded-lg border bg-white p-3 transition-colors ${isSelected ? "border-blue-300 bg-blue-50" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Checkbox
                  checked={isSelected}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelect(s.id, e);
                  }}
                  aria-label="Select statement"
                />
                <Link
                  href={`/customers/${s.customer.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="min-w-0 font-semibold text-blue-600 hover:underline"
                >
                  {s.customer.company || s.customer.name}
                </Link>
              </div>
              <span className="shrink-0 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950/40 dark:text-green-300">
                Sent
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-sm">
              <FileText className="h-3.5 w-3.5 shrink-0 text-blue-600" />
              <span className="truncate">{s.fileName}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Updated {dayjs(s.sentAt).fromNow()} · {dayjs(s.sentAt).format("D MMM YYYY, HH:mm")}
            </p>
          </div>
          );
        })}
      </div>

      {/* Desktop: full table */}
      <div className="hidden overflow-x-auto rounded-md border md:block">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={isAllSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Last updated</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => {
                  const isSelected = selectedIds.has(s.id);
                  return (
                  <TableRow
                    key={s.id}
                    onClick={(e) => toggleSelect(s.id, e)}
                    className={`cursor-pointer select-none ${isSelected ? "bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30" : ""}`}
                  >
                    <TableCell>
                      <Checkbox
                        checked={isSelected}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelect(s.id, e);
                        }}
                        aria-label={`Select statement for ${s.customer.company || s.customer.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/customers/${s.customer.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:underline"
                      >
                        <p className="font-medium">
                          {s.customer.company || s.customer.name}
                        </p>
                        {s.customer.company && s.customer.name &&
                          s.customer.name !== s.customer.company && (
                            <p className="text-xs text-muted-foreground">
                              {s.customer.name}
                            </p>
                          )}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                        <span className="truncate text-sm">{s.fileName}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {dayjs(s.sentAt).fromNow()}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {dayjs(s.sentAt).format("D MMM YYYY, HH:mm")}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950/40 dark:text-green-300">
                        Sent
                      </span>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
      </div>
          </>
        )}

        <TablePagination
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      </CardContent>

      {replaceFor && (
        <SendStatementDialog
          open
          onOpenChange={(o) => !o && setReplaceFor(null)}
          customerId={replaceFor.customerId}
          customerLabel={replaceFor.customerLabel}
          hasExisting
        />
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <DialogTitle>Delete selected statements?</DialogTitle>
            <DialogDescription>
              {selectedIds.size} statement(s) will be permanently deleted for
              you and the recipient.
              <span className="mt-2 block font-medium text-red-600">
                This cannot be undone.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={bulkDelete.isPending}
              onClick={() => {
                bulkDelete.mutate({ ids: Array.from(selectedIds) });
                setConfirmOpen(false);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ReceivedStatementsTable() {
  const utils = api.useUtils();
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
  const list = api.statement.listIncoming.useQuery(
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
  const { data: supplierOptions } = api.statement.incomingSuppliers.useQuery();
  const markViewed = api.statement.markViewed.useMutation({
    onSuccess: async () => {
      await utils.statement.listIncoming.invalidate();
    },
  });

  const rows = useMemo(() => list.data?.statements ?? [], [list.data]);
  const totalCount = list.data?.totalCount ?? 0;
  const totalPages = list.data?.totalPages ?? 1;
  const hasFilters =
    !!debouncedSearch || !!supplierId || dateFilter.preset !== "all";

  if (list.isLoading) return <TableSkeleton />;
  if (totalCount === 0 && !hasFilters) {
    return (
      <EmptyState
        icon={<Inbox className="h-10 w-10 text-muted-foreground" />}
        title="No statements received yet"
        body="When a supplier sends you a statement of account, it'll show up here."
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-3">
        <div className="mb-3 flex items-center gap-2">
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
        <CountBanner count={totalCount} label="Total received" />

        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {debouncedSearch
              ? <>No statements match &ldquo;{debouncedSearch}&rdquo;.</>
              : "No statements match your filters."}
          </p>
        ) : (
          <>
      {/* Mobile: card per statement */}
      <div className="space-y-3 md:hidden">
        {rows.map((s) => (
          <div key={s.id} className="rounded-lg border bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 font-semibold">{s.senderCompany.name}</p>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-sm">
              <FileText className="h-3.5 w-3.5 shrink-0 text-purple-600" />
              <span className="truncate">{s.fileName}</span>
            </div>
            {s.notes && (
              <p className="mt-0.5 text-xs italic text-muted-foreground">
                &ldquo;{s.notes}&rdquo;
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Updated {dayjs(s.sentAt).fromNow()} · {dayjs(s.sentAt).format("D MMM YYYY, HH:mm")}
            </p>
            <div className="mt-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                asChild
                onClick={() => {
                  if (!s.viewedAt) markViewed.mutate({ id: s.id });
                }}
              >
                <a href={s.fileUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  View
                </a>
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: full table */}
      <div className="hidden overflow-x-auto rounded-md border md:block">
            <Table className="min-w-[680px]">
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Last updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <p className="font-medium">{s.senderCompany.name}</p>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-purple-600" />
                      <span className="truncate text-sm">{s.fileName}</span>
                    </div>
                    {s.notes && (
                      <p className="mt-0.5 text-xs italic text-muted-foreground">
                        &ldquo;{s.notes}&rdquo;
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{dayjs(s.sentAt).fromNow()}</div>
                    <div className="text-xs text-muted-foreground">
                      {dayjs(s.sentAt).format("D MMM YYYY, HH:mm")}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                        onClick={() => {
                          if (!s.viewedAt) markViewed.mutate({ id: s.id });
                        }}
                      >
                        <a
                          href={s.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                          View
                        </a>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
      </div>
          </>
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

function CountBanner({ count, label }: { count: number; label: string }) {
  return (
    <div className="mb-3 overflow-hidden rounded-xl border-2 border-blue-300 bg-gradient-to-br from-blue-50 via-blue-100/70 to-blue-50 px-4 py-3 shadow-sm dark:border-blue-700 dark:from-blue-950/50 dark:via-blue-900/30 dark:to-blue-950/40">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
          <FileText className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-800 dark:text-blue-200">
            {label}
          </p>
          <p className="text-xl font-bold tabular-nums tracking-tight text-blue-900 dark:text-blue-100 sm:text-2xl">
            {count} statement{count === 1 ? "" : "s"}
          </p>
        </div>
      </div>
    </div>
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

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
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
