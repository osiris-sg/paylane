"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import dayjs from "dayjs";
import { toast } from "sonner";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  Send,
  Trash2,
  AlertTriangle,
  FileX,
  Check as CheckIcon,
  SlidersHorizontal,
  X,
  ChevronDown,
} from "lucide-react";

import { api } from "~/trpc/react";
import { formatCurrency } from "~/lib/currency";
import { useSendAccess } from "~/lib/use-send-access";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Card,
  CardContent,
} from "~/components/ui/card";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ArrowDownUp, ArrowDown, ArrowUp } from "lucide-react";
interface InvoiceTableProps {
  type: "sent" | "received";
  initialSearch?: string;
  initialCustomerId?: string;
  initialSenderCompanyId?: string;
}

type SortField =
  | "invoiceNumber"
  | "customer"
  | "reference"
  | "invoicedDate"
  | "sentAt"
  | "dueDate"
  | "amount";
type SortDir = "asc" | "desc";

const ITEMS_PER_PAGE = 10;

function SortableHead({
  field,
  sortBy,
  sortDir,
  onSort,
  align,
  children,
}: {
  field: SortField;
  sortBy: SortField | undefined;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
  align?: "right";
  children: React.ReactNode;
}) {
  const active = sortBy === field;
  const Icon = !active ? ChevronsUpDown : sortDir === "asc" ? ChevronUp : ChevronDown;
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 font-medium transition-colors hover:text-foreground ${
          active ? "text-foreground" : "text-muted-foreground"
        } ${align === "right" ? "ml-auto" : ""}`}
      >
        {children}
        <Icon className={`h-3.5 w-3.5 ${active ? "opacity-100" : "opacity-50"}`} />
      </button>
    </TableHead>
  );
}

function InvoiceStatusBadge({ sentAt }: { sentAt: Date | string | null }) {
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

function SkeletonRow({ columns }: { columns: number }) {
  return (
    <TableRow>
      {Array.from({ length: columns }).map((_, i) => (
        <TableCell key={i}>
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
        </TableCell>
      ))}
    </TableRow>
  );
}

export function InvoiceTable({ type, initialSearch, initialCustomerId, initialSenderCompanyId }: InvoiceTableProps) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(initialSearch ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch ?? "");
  const [customerId, setCustomerId] = useState<string | undefined>(initialCustomerId);
  const [senderCompanyId, setSenderCompanyId] = useState<string | undefined>(initialSenderCompanyId);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortField | undefined>(undefined);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (field: SortField) => {
    if (sortBy !== field) {
      setSortBy(field);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortBy(undefined);
      setSortDir("desc");
    }
    setPage(1);
  };

  // Keep state in sync if the URL params change (e.g. user navigates via dashboard links)
  useEffect(() => {
    setSearch(initialSearch ?? "");
    setDebouncedSearch(initialSearch ?? "");
    setPage(1);
  }, [initialSearch]);

  useEffect(() => {
    setCustomerId(initialCustomerId);
    setPage(1);
  }, [initialCustomerId]);

  useEffect(() => {
    setSenderCompanyId(initialSenderCompanyId);
    setPage(1);
  }, [initialSenderCompanyId]);

  const utils = api.useUtils();

  const { data, isLoading } = api.invoice.list.useQuery({
    type,
    page,
    limit: ITEMS_PER_PAGE,
    search: debouncedSearch || undefined,
    customerId: customerId || undefined,
    senderCompanyId: senderCompanyId || undefined,
    sortBy,
    sortDir,
  });

  // When filtering by a customer, fetch their display name for the filter pill
  const { data: filteredCustomer } = api.customer.getById.useQuery(
    { id: customerId ?? "" },
    { enabled: !!customerId },
  );

  // When filtering by a supplier (sender company), fetch their name
  const { data: filteredSupplier } = api.supplier.getByLinkedCompanyId.useQuery(
    { linkedCompanyId: senderCompanyId ?? "" },
    { enabled: !!senderCompanyId && type === "received" },
  );

  // Customer list for the filter dropdown (only for the Sent tab)
  const { data: customersData } = api.customer.list.useQuery(
    { limit: 100 },
    { enabled: type === "sent" },
  );
  const customerList = customersData?.customers ?? [];

  // Unified filter popover state
  const [customerFilterOpen, setCustomerFilterOpen] = useState(false);
  const [customerFilterSearch, setCustomerFilterSearch] = useState("");
  const [customerSectionOpen, setCustomerSectionOpen] = useState(false);
  const filteredCustomerOptions = customerList.filter((c) => {
    const q = customerFilterSearch.toLowerCase();
    if (!q) return true;
    return (
      (c.company ?? "").toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q)
    );
  });
  const activeFilterCount = customerId ? 1 : 0;

  const sendInvoice = api.invoice.send.useMutation({
    onSuccess: () => {
      toast.success("Invoice sent successfully");
      void utils.invoice.list.invalidate();
    },
    onError: () => toast.error("Failed to send invoice"),
  });

  const [confirmAction, setConfirmAction] = useState<
    | null
    | {
        title: string;
        description: string;
        confirmLabel: string;
        onConfirm: () => void;
        destructive?: boolean;
      }
  >(null);

  const askConfirm = (
    title: string,
    description: string,
    confirmLabel: string,
    onConfirm: () => void,
    destructive = false,
  ) => setConfirmAction({ title, description, confirmLabel, onConfirm, destructive });

  const bulkDelete = api.invoice.bulkDelete.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.count} invoice(s) deleted`);
      setSelectedIds(new Set());
      void utils.invoice.list.invalidate();
    },
    onError: () => toast.error("Failed to delete invoices"),
  });

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
    const timeout = setTimeout(() => {
      setDebouncedSearch(value);
    }, 300);
    return () => clearTimeout(timeout);
  };

  const invoices = data?.invoices ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const totalsByCurrency = data?.totalsByCurrency ?? [];

  // Sent tab carries an extra Status column (Draft/Sent).
  const columnCount = type === "sent" ? 9 : 8;

  // Selection helpers
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === invoices.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(invoices.map((i) => i.id)));
    }
  };

  const isAllSelected = invoices.length > 0 && selectedIds.size === invoices.length;
  const isSomeSelected = selectedIds.size > 0;

  const selectedInvoices = invoices.filter((inv) => selectedIds.has(inv.id));

  const sendAccess = useSendAccess();
  const sendingAllowed = sendAccess.canSend;

  // Determine which bulk actions apply based on the current selection.
  // For sender-side actions (send/delete), also require active send access.
  const canBulkSend = sendingAllowed && type === "sent" && selectedInvoices.length > 0 && selectedInvoices.every((i) => !i.sentAt);
  const canBulkDelete = sendingAllowed && type === "sent" && selectedInvoices.length > 0;

  const handleBulkDelete = () => {
    askConfirm(
      "Delete selected invoices?",
      `${selectedIds.size} invoice(s) will be permanently deleted. This cannot be undone.`,
      "Delete",
      () => bulkDelete.mutate({ ids: Array.from(selectedIds) }),
      true,
    );
  };

  const handleBulkSend = () => {
    const ids = Array.from(selectedIds);
    askConfirm(
      "Send selected invoices?",
      `${ids.length} invoice(s) will be marked as sent and recipients notified.`,
      "Send",
      async () => {
        for (const id of ids) {
          try { await sendInvoice.mutateAsync({ id }); } catch {}
        }
        setSelectedIds(new Set());
      },
    );
  };

  return (
    <Card>
      <CardContent className="p-3">
        {/* Top control bar — fixed height regardless of contents */}
        <div className="mb-3 h-10">
          {isSomeSelected ? (
            <div className="flex h-10 items-center gap-2 overflow-x-auto whitespace-nowrap">
              <span className="shrink-0 text-sm font-medium">
                {selectedIds.size} selected
              </span>
              {canBulkSend && (
                <Button size="sm" className="shrink-0" onClick={handleBulkSend} disabled={sendInvoice.isPending}>
                  <Send className="mr-1.5 h-3.5 w-3.5" /> Send
                </Button>
              )}
              {canBulkDelete && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBulkDelete}
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
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* Active filter chips */}
              {customerId && (
                <button
                  type="button"
                  onClick={() => { setCustomerId(undefined); setPage(1); }}
                  className="hidden shrink-0 items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 md:inline-flex"
                >
                  <span className="max-w-[140px] truncate">
                    {filteredCustomer?.company || filteredCustomer?.name || "Customer"}
                  </span>
                  <X className="h-3 w-3" />
                </button>
              )}
              {senderCompanyId && (
                <button
                  type="button"
                  onClick={() => { setSenderCompanyId(undefined); setPage(1); }}
                  className="hidden shrink-0 items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 md:inline-flex"
                >
                  <span className="max-w-[140px] truncate">
                    {filteredSupplier?.company || filteredSupplier?.name || "Supplier"}
                  </span>
                  <X className="h-3 w-3" />
                </button>
              )}
              {/* Unified Filter button */}
              <Popover open={customerFilterOpen} onOpenChange={setCustomerFilterOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="relative h-10 shrink-0 gap-2">
                    <SlidersHorizontal className="h-4 w-4" />
                    <span className="hidden sm:inline">Filter</span>
                    {activeFilterCount > 0 && (
                      <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold text-white">
                        {activeFilterCount}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0" align="end">
                  <div className="flex items-center justify-between border-b px-3 py-2">
                    <span className="text-sm font-semibold">Filters</span>
                    {activeFilterCount > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerId(undefined);
                          setCustomerFilterSearch("");
                        }}
                        className="text-xs font-medium text-blue-600 hover:underline"
                      >
                        Clear all
                      </button>
                    )}
                  </div>

                  {/* Customer — collapsible (sent tab only) */}
                  {type === "sent" && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setCustomerSectionOpen((v) => !v)}
                        className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium hover:bg-gray-50"
                      >
                        <span className="flex items-center gap-2">
                          Customer
                          {customerId && (
                            <span className="max-w-[140px] truncate rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                              {filteredCustomer?.company || filteredCustomer?.name || "Customer"}
                            </span>
                          )}
                        </span>
                        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${customerSectionOpen ? "rotate-180" : ""}`} />
                      </button>
                      {customerSectionOpen && (
                        <div className="px-2 pb-2">
                          <div className="mb-1 flex items-center gap-2 rounded-md border bg-background px-2 py-1">
                            <Search className="h-3.5 w-3.5 text-muted-foreground" />
                            <input
                              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                              placeholder="Search customers..."
                              value={customerFilterSearch}
                              onChange={(e) => setCustomerFilterSearch(e.target.value)}
                            />
                          </div>
                          <div className="max-h-48 overflow-y-auto">
                            <button
                              type="button"
                              onClick={() => {
                                setCustomerId(undefined);
                                setPage(1);
                                setCustomerFilterSearch("");
                              }}
                              className={`flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-gray-100 ${!customerId ? "bg-blue-50 font-medium" : ""}`}
                            >
                              <span>All Customers</span>
                              {!customerId && <CheckIcon className="h-3.5 w-3.5 text-blue-600" />}
                            </button>
                            {filteredCustomerOptions.length === 0 ? (
                              <p className="py-3 text-center text-xs text-muted-foreground">No customers</p>
                            ) : (
                              filteredCustomerOptions.map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => {
                                    setCustomerId(c.id);
                                    setPage(1);
                                    setCustomerFilterSearch("");
                                  }}
                                  className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-gray-100 ${c.id === customerId ? "bg-blue-50" : ""}`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate">{c.company || c.name}</p>
                                    {c.company && (
                                      <p className="truncate text-xs text-muted-foreground">{c.name}</p>
                                    )}
                                  </div>
                                  {c.id === customerId && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-blue-600" />}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>

        {(() => {
          const showingSelected = selectedInvoices.length > 0;
          const selectedTotals = showingSelected
            ? Object.entries(
                selectedInvoices.reduce<Record<string, number>>((acc, inv) => {
                  const code = inv.currency || "SGD";
                  acc[code] = (acc[code] ?? 0) + Number(inv.amount);
                  return acc;
                }, {}),
              )
                .map(([currency, amount]) => ({ currency, amount }))
                .sort((a, b) => b.amount - a.amount)
            : [];
          const displayTotals = showingSelected ? selectedTotals : totalsByCurrency;
          const displayCount = showingSelected ? selectedInvoices.length : totalCount;
          const filtersActive = customerId || debouncedSearch;
          if (displayTotals.length === 0) return null;
          return (
            <div
              className={`mb-3 overflow-hidden rounded-xl border-2 px-4 py-3 shadow-sm transition-colors ${
                showingSelected
                  ? "border-amber-300 bg-gradient-to-br from-amber-50 via-amber-100/70 to-amber-50 dark:border-amber-700 dark:from-amber-950/50 dark:via-amber-900/30 dark:to-amber-950/40"
                  : "border-blue-300 bg-gradient-to-br from-blue-50 via-blue-100/70 to-blue-50 dark:border-blue-700 dark:from-blue-950/50 dark:via-blue-900/30 dark:to-blue-950/40"
              }`}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm ${
                      showingSelected
                        ? "bg-amber-500 text-white"
                        : "bg-blue-600 text-white"
                    }`}
                  >
                    <span className="text-sm font-bold">$</span>
                  </div>
                  <div>
                    <p
                      className={`text-xs font-semibold uppercase tracking-wider ${
                        showingSelected
                          ? "text-amber-800 dark:text-amber-200"
                          : "text-blue-800 dark:text-blue-200"
                      }`}
                    >
                      {showingSelected
                        ? "Selected total"
                        : `Total ${type === "sent" ? "billed" : "received"}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {displayCount} invoice{displayCount === 1 ? "" : "s"}
                      {!showingSelected && filtersActive ? " (filtered)" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 sm:justify-end">
                  {displayTotals.map((t) => (
                    <span
                      key={t.currency}
                      className={`text-xl font-bold tabular-nums tracking-tight sm:text-2xl ${
                        showingSelected
                          ? "text-amber-900 dark:text-amber-100"
                          : "text-blue-900 dark:text-blue-100"
                      }`}
                    >
                      {formatCurrency(t.amount, t.currency)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Mobile Sort Bar */}
        <div className="mb-3 flex items-center gap-2 md:hidden">
          <ArrowDownUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Select
            value={sortBy ?? "default"}
            onValueChange={(v) => {
              if (v === "default") {
                setSortBy(undefined);
                setSortDir("desc");
              } else {
                setSortBy(v as SortField);
                if (!sortBy) setSortDir("asc");
              }
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 flex-1">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default (newest)</SelectItem>
              <SelectItem value="invoiceNumber">Invoice #</SelectItem>
              <SelectItem value="customer">{type === "sent" ? "Customer" : "Supplier"}</SelectItem>
              <SelectItem value="reference">Reference</SelectItem>
              <SelectItem value="invoicedDate">Invoice Date</SelectItem>
              <SelectItem value="sentAt">{type === "sent" ? "Date Sent" : "Date Received"}</SelectItem>
              <SelectItem value="dueDate">Due Date</SelectItem>
              <SelectItem value="amount">Amount</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0 px-2.5"
            disabled={!sortBy}
            onClick={() => {
              setSortDir((d) => (d === "asc" ? "desc" : "asc"));
              setPage(1);
            }}
            aria-label={sortDir === "asc" ? "Ascending" : "Descending"}
          >
            {sortDir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
          </Button>
        </div>

        {/* Mobile Card View */}
        <div className="space-y-3 md:hidden">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-lg border bg-white p-4">
                <div className="h-4 w-32 rounded bg-muted" />
                <div className="mt-2 h-3 w-24 rounded bg-muted" />
                <div className="mt-2 h-3 w-40 rounded bg-muted" />
              </div>
            ))
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <FileX className="h-10 w-10" />
              <p className="text-base font-medium">
                {type === "sent" && !sendingAllowed
                  ? "Feature locked"
                  : "No invoices found"}
              </p>
              <p className="text-sm">
                {type === "sent" && !sendingAllowed
                  ? "Start your free trial to send invoices"
                  : search || customerId
                    ? "Try adjusting your search or filters"
                    : `No ${type} invoices yet`}
              </p>
            </div>
          ) : (
            invoices.map((invoice) => {
              const isSelected = selectedIds.has(invoice.id);

              return (
                <div
                  key={invoice.id}
                  onClick={() => toggleSelect(invoice.id)}
                  className={`relative cursor-pointer select-none overflow-hidden rounded-lg border bg-white p-3 transition-colors ${
                    isSelected ? "border-blue-300 bg-blue-50" : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={isSelected}
                      onClick={(e) => e.stopPropagation()}
                      onCheckedChange={() => toggleSelect(invoice.id)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <Link
                          href={`/invoices/${invoice.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-semibold text-blue-600 hover:underline"
                        >
                          {invoice.invoiceNumber}
                        </Link>
                        <span className="text-sm font-medium tabular-nums">
                          {formatCurrency(invoice.amount, invoice.currency)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {type === "sent"
                          ? invoice.customer?.company || invoice.customer?.name
                          : invoice.senderCompany?.name}
                        {invoice.reference ? ` · ${invoice.reference}` : ""}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {type === "sent" && <InvoiceStatusBadge sentAt={invoice.sentAt} />}
                        <span className="text-xs text-muted-foreground">
                          {dayjs(invoice.invoicedDate).format("MMM D, YYYY")}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop Table */}
        <div className="hidden overflow-x-auto rounded-md border md:block [&_td]:py-2 [&_th]:h-9 [&_th]:py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={isAllSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <SortableHead field="invoiceNumber" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>Invoice #</SortableHead>
                <SortableHead field="customer" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>{type === "sent" ? "Customer" : "Supplier"}</SortableHead>
                <SortableHead field="reference" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>Reference</SortableHead>
                <SortableHead field="invoicedDate" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>Invoice Date</SortableHead>
                <SortableHead field="sentAt" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>{type === "sent" ? "Date Sent" : "Date Received"}</SortableHead>
                <SortableHead field="dueDate" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>Due Date</SortableHead>
                {type === "sent" && <TableHead>Status</TableHead>}
                <SortableHead field="amount" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} align="right">Amount</SortableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <SkeletonRow key={i} columns={columnCount} />
                ))
              ) : invoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="h-48 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <FileX className="h-10 w-10" />
                      <p className="text-lg font-medium">
                        {type === "sent" && !sendingAllowed
                          ? "Feature locked"
                          : "No invoices found"}
                      </p>
                      <p className="text-sm">
                        {type === "sent" && !sendingAllowed
                          ? "Start your free trial to send invoices"
                          : search || customerId
                            ? "Try adjusting your search or filters"
                            : `No ${type} invoices yet`}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                invoices.map((invoice) => {
                  const isSelected = selectedIds.has(invoice.id);

                  const rowClassName = isSelected
                    ? "bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30"
                    : "";

                  return (
                    <TableRow
                      key={invoice.id}
                      className={`cursor-pointer select-none ${rowClassName}`}
                      onClick={() => toggleSelect(invoice.id)}
                    >
                      {/* Checkbox */}
                      <TableCell>
                        <Checkbox
                          checked={isSelected}
                          onClick={(e) => e.stopPropagation()}
                          onCheckedChange={() => toggleSelect(invoice.id)}
                          aria-label={`Select invoice ${invoice.invoiceNumber}`}
                        />
                      </TableCell>

                      {/* Invoice Number (click to view) */}
                      <TableCell>
                        <Link
                          href={`/invoices/${invoice.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-blue-600 hover:text-blue-800 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          {invoice.invoiceNumber}
                        </Link>
                      </TableCell>

                      {/* Customer / Supplier */}
                      <TableCell className="max-w-[200px] truncate">
                        {type === "sent"
                          ? invoice.customer?.company || invoice.customer?.name
                          : invoice.senderCompany?.name}
                      </TableCell>

                      {/* Reference */}
                      <TableCell className="max-w-[150px] truncate text-muted-foreground">
                        {invoice.reference || "-"}
                      </TableCell>

                      {/* Invoice Date */}
                      <TableCell>
                        {dayjs(invoice.invoicedDate).format("MMM D, YYYY")}
                      </TableCell>

                      {/* Date Sent / Date Received */}
                      <TableCell>
                        {invoice.sentAt ? dayjs(invoice.sentAt).format("MMM D, YYYY") : <span className="text-muted-foreground">—</span>}
                      </TableCell>

                      {/* Due Date */}
                      <TableCell>
                        {dayjs(invoice.dueDate).format("MMM D, YYYY")}
                      </TableCell>

                      {/* Status (sent tab only) */}
                      {type === "sent" && (
                        <TableCell>
                          <InvoiceStatusBadge sentAt={invoice.sentAt} />
                        </TableCell>
                      )}

                      {/* Amount */}
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCurrency(invoice.amount, invoice.currency)}
                      </TableCell>

                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Shared confirmation dialog */}
        <Dialog open={!!confirmAction} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
          <DialogContent>
            <DialogHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <DialogTitle>{confirmAction?.title}</DialogTitle>
              <DialogDescription>
                {confirmAction?.description}
                <span className="mt-2 block font-medium text-red-600">
                  Once changed, this cannot be undone.
                </span>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => {
                  confirmAction?.onConfirm();
                  setConfirmAction(null);
                }}
              >
                {confirmAction?.confirmLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Pagination */}
        {!isLoading && invoices.length > 0 && (
          <div className="mt-3 flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
            <p className="text-xs text-muted-foreground sm:text-sm">
              {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, totalCount)} of {totalCount}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground sm:text-sm">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
