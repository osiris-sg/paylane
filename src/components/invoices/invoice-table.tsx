"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { toast } from "sonner";
import {
  Star,
  Search,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Eye,
  Send,
  CheckCircle,
  CreditCard,
  Trash2,
  AlertTriangle,
  Clock,
  FileX,
} from "lucide-react";

import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

interface InvoiceTableProps {
  type: "sent" | "received";
}

const ITEMS_PER_PAGE = 10;

const routingStatusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className: string }> = {
  PENDING: { label: "Pending", variant: "outline", className: "border-yellow-500 bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400" },
  ACKNOWLEDGED: { label: "Acknowledged", variant: "outline", className: "border-green-500 bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400" },
  FAILED: { label: "Failed", variant: "destructive", className: "bg-red-100 text-red-700 border-red-500 dark:bg-red-950 dark:text-red-400" },
};

const invoiceStatusConfig: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300" },
  SENT: { label: "Sent", className: "bg-blue-100 text-blue-700 border-blue-400 dark:bg-blue-950 dark:text-blue-400" },
  PAID: { label: "Paid", className: "bg-green-100 text-green-700 border-green-400 dark:bg-green-950 dark:text-green-400" },
  OVERDUE: { label: "Overdue", className: "bg-red-100 text-red-700 border-red-400 dark:bg-red-950 dark:text-red-400" },
  CANCELLED: { label: "Cancelled", className: "bg-gray-100 text-gray-500 border-gray-300 dark:bg-gray-800 dark:text-gray-400" },
};

function formatCurrency(amount: number | unknown, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
  }).format(Number(amount));
}

function getDueDateUrgency(dueDate: string | Date) {
  const now = dayjs();
  const due = dayjs(dueDate);
  const daysUntilDue = due.diff(now, "day");

  if (daysUntilDue < 0) return "overdue";
  if (daysUntilDue <= 10) return "urgent";
  if (daysUntilDue <= 30) return "warning";
  return "normal";
}

function getRowUrgency(dueDate: string | Date) {
  const now = dayjs();
  const due = dayjs(dueDate);
  const daysUntilDue = due.diff(now, "day");

  if (daysUntilDue < 0) return "overdue";
  if (daysUntilDue <= 20) return "due-soon";
  return "normal";
}

function DueDateCell({ dueDate, type }: { dueDate: string | Date; type: "sent" | "received" }) {
  const formatted = dayjs(dueDate).format("MMM D, YYYY");

  if (type !== "received") {
    return <span>{formatted}</span>;
  }

  const urgency = getDueDateUrgency(dueDate);

  if (urgency === "overdue") {
    return (
      <span className="font-medium text-red-600 dark:text-red-400">
        {formatted}
      </span>
    );
  }
  if (urgency === "urgent") {
    return (
      <span className="font-medium text-red-500 dark:text-red-400">
        {formatted}
      </span>
    );
  }
  if (urgency === "warning") {
    return (
      <span className="font-medium text-yellow-600 dark:text-yellow-400">
        {formatted}
      </span>
    );
  }
  return (
    <span className="text-green-600 dark:text-green-400">{formatted}</span>
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

export function InvoiceTable({ type }: InvoiceTableProps) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "DRAFT" | "SENT" | "PAID" | "OVERDUE" | "CANCELLED">("all");

  const utils = api.useUtils();

  const { data, isLoading } = api.invoice.list.useQuery({
    type,
    page,
    limit: ITEMS_PER_PAGE,
    search: debouncedSearch || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  const togglePin = api.invoice.togglePin.useMutation({
    onSuccess: () => {
      void utils.invoice.list.invalidate();
    },
    onError: () => {
      toast.error("Failed to update pin status");
    },
  });

  const sendInvoice = api.invoice.send.useMutation({
    onSuccess: () => {
      toast.success("Invoice sent successfully");
      void utils.invoice.list.invalidate();
    },
    onError: () => {
      toast.error("Failed to send invoice");
    },
  });

  const deleteInvoice = api.invoice.delete.useMutation({
    onSuccess: () => {
      toast.success("Invoice deleted");
      void utils.invoice.list.invalidate();
    },
    onError: () => {
      toast.error("Failed to delete invoice");
    },
  });

  const acknowledgeInvoice = api.invoice.acknowledge.useMutation({
    onSuccess: () => {
      toast.success("Invoice acknowledged");
      void utils.invoice.list.invalidate();
    },
    onError: () => {
      toast.error("Failed to acknowledge invoice");
    },
  });

  const markPaid = api.invoice.markPaid.useMutation({
    onSuccess: () => {
      toast.success("Invoice marked as paid");
      void utils.invoice.list.invalidate();
    },
    onError: () => {
      toast.error("Failed to mark invoice as paid");
    },
  });

  // Debounce search input
  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
    const timeout = setTimeout(() => {
      setDebouncedSearch(value);
    }, 300);
    return () => clearTimeout(timeout);
  };

  const handleStatusChange = (value: "all" | "DRAFT" | "SENT" | "PAID" | "OVERDUE" | "CANCELLED") => {
    setStatusFilter(value);
    setPage(1);
  };

  const invoices = data?.invoices ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const columnCount = 11;

  return (
    <Card>
      <CardContent className="p-4">
        {/* Filters */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search invoices..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="SENT">Sent</SelectItem>
              <SelectItem value="PAID">Paid</SelectItem>
              <SelectItem value="OVERDUE">Overdue</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Invoice #</TableHead>
                <TableHead>{type === "sent" ? "Customer" : "Supplier"}</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Invoice Date</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Routing</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
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
                      <p className="text-lg font-medium">No invoices found</p>
                      <p className="text-sm">
                        {search || statusFilter !== "all"
                          ? "Try adjusting your search or filters"
                          : `No ${type} invoices yet`}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                invoices.map((invoice) => {
                  const rowUrgency =
                    type === "received"
                      ? getRowUrgency(invoice.dueDate)
                      : "normal";

                  const rowClassName =
                    rowUrgency === "overdue"
                      ? "bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/50"
                      : rowUrgency === "due-soon"
                        ? "bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/20 dark:hover:bg-amber-950/40"
                        : "";

                  return (
                    <TableRow key={invoice.id} className={rowClassName}>
                      {/* Pin */}
                      <TableCell>
                        <button
                          onClick={() => togglePin.mutate({ id: invoice.id })}
                          className="flex items-center justify-center"
                          aria-label={invoice.pinned ? "Unpin invoice" : "Pin invoice"}
                        >
                          <Star
                            className={`h-4 w-4 transition-colors ${
                              invoice.pinned
                                ? "fill-yellow-400 text-yellow-400"
                                : "text-muted-foreground hover:text-yellow-400"
                            }`}
                          />
                        </button>
                      </TableCell>

                      {/* Invoice Number */}
                      <TableCell>
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="font-medium text-blue-600 hover:text-blue-800 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          {invoice.invoiceNumber}
                        </Link>
                      </TableCell>

                      {/* Customer / Supplier */}
                      <TableCell className="max-w-[200px] truncate">
                        {type === "sent"
                          ? invoice.customer?.name
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

                      {/* Due Date */}
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <DueDateCell dueDate={invoice.dueDate} type={type} />
                          {type === "received" && rowUrgency === "overdue" && (
                            <AlertTriangle className="h-4 w-4 text-red-500" />
                          )}
                          {type === "received" && rowUrgency === "due-soon" && (
                            <Clock className="h-4 w-4 text-amber-500" />
                          )}
                        </div>
                        {type === "received" && rowUrgency === "overdue" && (
                          <span className="text-xs font-medium text-red-600 dark:text-red-400">
                            OVERDUE
                          </span>
                        )}
                        {type === "received" && rowUrgency === "due-soon" && (
                          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                            Due Soon
                          </span>
                        )}
                      </TableCell>

                      {/* Amount */}
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCurrency(invoice.amount, invoice.currency)}
                      </TableCell>

                      {/* Routing Status */}
                      <TableCell>
                        {(() => {
                          const config = routingStatusConfig[invoice.routingStatus];
                          return (
                            <Badge variant="outline" className={config?.className}>
                              {config?.label ?? invoice.routingStatus}
                            </Badge>
                          );
                        })()}
                      </TableCell>

                      {/* Invoice Status */}
                      <TableCell>
                        {(() => {
                          const config = invoiceStatusConfig[invoice.invoiceStatus];
                          return (
                            <Badge variant="outline" className={config?.className}>
                              {config?.label ?? invoice.invoiceStatus}
                            </Badge>
                          );
                        })()}
                      </TableCell>

                      {/* Actions */}
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Open menu</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => router.push(`/invoices/${invoice.id}`)}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              View
                            </DropdownMenuItem>

                            {type === "sent" && invoice.invoiceStatus === "DRAFT" && (
                              <DropdownMenuItem
                                onClick={() => sendInvoice.mutate({ id: invoice.id })}
                              >
                                <Send className="mr-2 h-4 w-4" />
                                Send
                              </DropdownMenuItem>
                            )}

                            {type === "received" && invoice.invoiceStatus === "SENT" && (
                              <DropdownMenuItem
                                onClick={() =>
                                  acknowledgeInvoice.mutate({ id: invoice.id })
                                }
                              >
                                <CheckCircle className="mr-2 h-4 w-4" />
                                Acknowledge
                              </DropdownMenuItem>
                            )}

                            {type === "received" &&
                              (invoice.invoiceStatus === "SENT" ||
                                invoice.invoiceStatus === "OVERDUE") && (
                                <DropdownMenuItem
                                  onClick={() => markPaid.mutate({ id: invoice.id })}
                                >
                                  <CreditCard className="mr-2 h-4 w-4" />
                                  Mark Paid
                                </DropdownMenuItem>
                              )}

                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600 dark:text-red-400"
                              onClick={() => deleteInvoice.mutate({ id: invoice.id })}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {!isLoading && invoices.length > 0 && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {(page - 1) * ITEMS_PER_PAGE + 1} to{" "}
              {Math.min(page * ITEMS_PER_PAGE, totalCount)} of {totalCount}{" "}
              invoices
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
