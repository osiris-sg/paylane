"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { toast } from "sonner";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import { Label } from "~/components/ui/label";
import { Checkbox } from "~/components/ui/checkbox";
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
  Plus,
  Search,
  Pencil,
  Trash2,
  Mail,
  Phone,
  FileText,
  Users,
  Upload,
  MessageCircle,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { useSendAccess } from "~/lib/use-send-access";
import { useRowSelection } from "~/lib/use-row-selection";
import { LockedSendingCTA } from "~/components/subscription/locked-sending-cta";
import { ExpiredBanner } from "~/components/subscription/expired-banner";
import { TablePagination } from "~/components/table-pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { COMMON_CURRENCIES } from "~/lib/currency";

const PAGE_SIZE = 10;

/** Shows when a customer's statement was last updated; recent ones stand out. */
function StatementBadge({ sentAt }: { sentAt: string | Date }) {
  const days = Math.floor(
    (Date.now() - new Date(sentAt).getTime()) / 86_400_000,
  );
  const recent = days <= 7;
  const label =
    days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  return (
    <Badge
      variant="outline"
      className={
        recent
          ? "gap-1 border-blue-300 bg-blue-50 font-semibold text-blue-700"
          : "gap-1 border-gray-200 bg-gray-50 text-muted-foreground"
      }
      title="Latest statement update"
    >
      <FileText className="h-3 w-3" />
      Statement {label}
    </Badge>
  );
}

function WhatsAppBadge() {
  return (
    <Badge
      variant="outline"
      className="gap-1 border-green-300 bg-green-50 text-green-700"
      title="WhatsApp notifications enabled"
    >
      <MessageCircle className="h-3 w-3" />
      WhatsApp
    </Badge>
  );
}

/** The status chips attached to a customer, shared by the table + mobile cards. */
function CustomerStatuses({
  customer,
}: {
  customer: {
    whatsappEnabled?: boolean;
    statement?: { sentAt: string | Date } | null;
  };
}) {
  if (!customer.whatsappEnabled && !customer.statement) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {customer.whatsappEnabled && <WhatsAppBadge />}
      {customer.statement && <StatementBadge sentAt={customer.statement.sentAt} />}
    </div>
  );
}

function CountBanner({ count }: { count: number }) {
  return (
    <div className="mb-3 overflow-hidden rounded-xl border-2 border-blue-300 bg-gradient-to-br from-blue-50 via-blue-100/70 to-blue-50 px-4 py-3 shadow-sm dark:border-blue-700 dark:from-blue-950/50 dark:via-blue-900/30 dark:to-blue-950/40">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
          <Users className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-800 dark:text-blue-200">
            Total customers
          </p>
          <p className="text-xl font-bold tabular-nums tracking-tight text-blue-900 dark:text-blue-100 sm:text-2xl">
            {count} customer{count === 1 ? "" : "s"}
          </p>
        </div>
      </div>
    </div>
  );
}

interface CustomerFormData {
  name: string;
  email: string;
  phone: string;
  address: string;
  company: string;
  currency: string;
}

const emptyForm: CustomerFormData = {
  name: "",
  email: "",
  phone: "",
  address: "",
  company: "",
  currency: "SGD",
};

export default function CustomersPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CustomerFormData>(emptyForm);

  const access = useSendAccess();
  const sendDisabled = !access.canSend;

  // Debounce the search box so we don't hit the server on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, refetch } = api.customer.list.useQuery({
    search: debouncedSearch || undefined,
    page,
    limit: PAGE_SIZE,
  });

  const customers = useMemo(() => data?.customers ?? [], [data]);
  const customerIds = useMemo(() => customers.map((c) => c.id), [customers]);
  const {
    selectedIds,
    toggle: toggleSelect,
    toggleAll: toggleSelectAll,
    clear: clearSelection,
    isAllSelected,
    isSomeSelected,
  } = useRowSelection(customerIds);

  const totalCount = data?.totalCount ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const createMutation = api.customer.create.useMutation({
    onSuccess: () => {
      toast.success("Customer created successfully");
      setDialogOpen(false);
      setFormData(emptyForm);
      void refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create customer");
    },
  });

  const updateMutation = api.customer.update.useMutation({
    onSuccess: () => {
      toast.success("Customer updated successfully");
      setDialogOpen(false);
      setFormData(emptyForm);
      setEditingId(null);
      void refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update customer");
    },
  });

  const bulkDeleteMutation = api.customer.bulkDelete.useMutation({
    onSuccess: (res) => {
      toast.success(`${res.count} customer${res.count === 1 ? "" : "s"} deleted`);
      setConfirmDeleteOpen(false);
      clearSelection();
      void refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete customers");
    },
  });

  const openCreateDialog = () => {
    setEditingId(null);
    setFormData(emptyForm);
    setDialogOpen(true);
  };

  const openEditDialog = (customer: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    company: string | null;
    currency: string;
  }) => {
    setEditingId(customer.id);
    setFormData({
      name: customer.name,
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      address: customer.address ?? "",
      company: customer.company ?? "",
      currency: customer.currency,
    });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.company.trim()) {
      toast.error("Company name is required");
      return;
    }
    if (!editingId && !formData.email.trim() && !formData.phone.trim()) {
      toast.error("Add an email or phone so the customer can be reached");
      return;
    }

    const payload = {
      company: formData.company.trim(),
      name: formData.name.trim() || undefined,
      email: formData.email.trim() || undefined,
      phone: formData.phone.trim() || undefined,
      address: formData.address.trim() || undefined,
      currency: formData.currency,
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isMutating = createMutation.isPending || updateMutation.isPending;

  // View + Edit act on one customer, so Edit only shows with exactly one row
  // selected (Delete works for any number) — mirrors the statements table.
  const singleSelected =
    selectedIds.size === 1
      ? customers.find((c) => selectedIds.has(c.id)) ?? null
      : null;

  if (access.state === "locked") {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
          <p className="text-muted-foreground">
            Manage your customers and their information.
          </p>
        </div>
        <LockedSendingCTA
          title="Customers are locked"
          body="Start your free 14-day trial to add and manage your customers. No credit card required."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
          <p className="text-muted-foreground">
            Manage your customers and their information.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {sendDisabled ? (
            <Button variant="outline" disabled>
              <Upload className="mr-2 h-4 w-4" />
              Import Customers
            </Button>
          ) : (
            <Button variant="outline" asChild>
              <Link href="/customers/import">
                <Upload className="mr-2 h-4 w-4" />
                Import Customers
              </Link>
            </Button>
          )}
          <Button onClick={openCreateDialog} disabled={sendDisabled}>
            <Plus className="mr-2 h-4 w-4" />
            Add Customer
          </Button>
        </div>
      </div>

      {access.state === "expired" && (
        <ExpiredBanner message="Your free trial has ended. Upgrade to add or edit customers." />
      )}

      {isLoading ? (
        <Card>
          <CardContent className="p-4">
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted/50" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : totalCount === 0 && !debouncedSearch ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Users className="h-12 w-12 text-muted-foreground" />
            <h3 className="text-lg font-semibold">No customers yet</h3>
            <p className="max-w-md text-sm text-muted-foreground">
              Add your first customer to get started.
            </p>
            <Button onClick={openCreateDialog} disabled={sendDisabled}>
              <Plus className="mr-2 h-4 w-4" />
              Add Customer
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-3">
            {/* Fixed-height control bar — swaps between search and the selection
                actions so selecting never shifts the table down. */}
            <div className="mb-3 h-10">
              {isSomeSelected ? (
                <div className="flex h-10 items-center gap-2 overflow-x-auto whitespace-nowrap">
                  <span className="shrink-0 text-sm font-medium">
                    {selectedIds.size} selected
                  </span>
                  {singleSelected && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      disabled={sendDisabled}
                      onClick={() => openEditDialog(singleSelected)}
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      Edit
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={sendDisabled || bulkDeleteMutation.isPending}
                    onClick={() => setConfirmDeleteOpen(true)}
                    className="shrink-0 border-red-300 text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    {bulkDeleteMutation.isPending ? "Deleting..." : "Delete"}
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
                      placeholder="Search customers..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>
              )}
            </div>

            <CountBanner count={totalCount} />

            {customers.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No customers match &ldquo;{debouncedSearch}&rdquo;.
              </p>
            ) : (
              <>
                {/* Mobile: card per customer */}
                <div className="space-y-3 md:hidden">
                  {customers.map((customer) => {
                    const isSelected = selectedIds.has(customer.id);
                    return (
                      <div
                        key={customer.id}
                        onClick={() => router.push(`/customers/${customer.id}`)}
                        className={`cursor-pointer select-none rounded-lg border bg-white p-3 transition-colors ${isSelected ? "border-blue-300 bg-blue-50" : ""}`}
                      >
                        <div className="flex items-start gap-2">
                          <Checkbox
                            checked={isSelected}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelect(customer.id, e);
                            }}
                            className="mt-1"
                            aria-label={`Select ${customer.company || customer.name}`}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold">
                              {customer.company || customer.name}
                              <span className="ml-1.5 rounded border px-1.5 py-0.5 align-middle text-[10px] font-medium text-muted-foreground">
                                {customer.currency}
                              </span>
                            </p>
                            {customer.company && customer.name && customer.name !== customer.company && (
                              <p className="truncate text-xs text-muted-foreground">{customer.name}</p>
                            )}
                            <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                              {customer.email && (
                                <p className="flex items-center gap-1.5 truncate">
                                  <Mail className="h-3.5 w-3.5 shrink-0" />
                                  {customer.email}
                                </p>
                              )}
                              {customer.phone && (
                                <p className="flex items-center gap-1.5">
                                  <Phone className="h-3.5 w-3.5 shrink-0" />
                                  {customer.phone}
                                </p>
                              )}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <Badge variant="secondary" className="gap-1">
                                <FileText className="h-3 w-3" />
                                {customer._count.invoices}{" "}
                                {customer._count.invoices === 1 ? "invoice" : "invoices"}
                              </Badge>
                              {customer.whatsappEnabled && <WhatsAppBadge />}
                              {customer.statement && (
                                <StatementBadge sentAt={customer.statement.sentAt} />
                              )}
                            </div>
                          </div>
                        </div>
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
                        <TableHead>Contact</TableHead>
                        <TableHead>Invoices</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customers.map((customer) => {
                        const isSelected = selectedIds.has(customer.id);
                        return (
                          <TableRow
                            key={customer.id}
                            onClick={() => router.push(`/customers/${customer.id}`)}
                            className={`cursor-pointer select-none ${isSelected ? "bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30" : ""}`}
                          >
                            <TableCell>
                              <Checkbox
                                checked={isSelected}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSelect(customer.id, e);
                                }}
                                aria-label={`Select ${customer.company || customer.name}`}
                              />
                            </TableCell>
                            <TableCell>
                              <p className="font-medium">
                                {customer.company || customer.name}
                                <span className="ml-1.5 rounded border px-1.5 py-0.5 align-middle text-[10px] font-medium text-muted-foreground">
                                  {customer.currency}
                                </span>
                              </p>
                              {customer.company && customer.name && customer.name !== customer.company && (
                                <p className="text-xs text-muted-foreground">{customer.name}</p>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="space-y-0.5 text-sm text-muted-foreground">
                                {customer.email && (
                                  <p className="flex items-center gap-1.5 truncate">
                                    <Mail className="h-3.5 w-3.5 shrink-0" />
                                    {customer.email}
                                  </p>
                                )}
                                {customer.phone && (
                                  <p className="flex items-center gap-1.5">
                                    <Phone className="h-3.5 w-3.5 shrink-0" />
                                    {customer.phone}
                                  </p>
                                )}
                                {!customer.email && !customer.phone && <span>—</span>}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="gap-1">
                                <FileText className="h-3 w-3" />
                                {customer._count.invoices}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <CustomerStatuses customer={customer} />
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
        </Card>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Customer" : "Add Customer"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update the customer's information below."
                : "Fill in the details to create a new customer."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="company">
                  Company <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="company"
                  placeholder="Acme Inc."
                  value={formData.company}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, company: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="currency">
                  Currency <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={formData.currency}
                  onValueChange={(v) => setFormData((prev) => ({ ...prev, currency: v }))}
                >
                  <SelectTrigger id="currency">
                    <SelectValue placeholder="Select currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMON_CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The same business billed in another currency is a separate customer.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="name">Contact Name</Label>
                <Input
                  id="name"
                  placeholder="John Doe"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, name: e.target.value }))
                  }
                />
              </div>
              {!editingId && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Add an <strong>email or phone</strong> — at least one is required
                  so we can reach this customer (e.g. via WhatsApp) when they&apos;re
                  not on E-StatementNow.
                </p>
              )}
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="accounts@acme.com"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, email: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  value={formData.phone}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, phone: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  placeholder="123 Main St, City, State"
                  value={formData.address}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, address: e.target.value }))
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isMutating}>
                {isMutating
                  ? "Saving..."
                  : editingId
                    ? "Update Customer"
                    : "Create Customer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <DialogTitle>Delete selected customers?</DialogTitle>
            <DialogDescription>
              {selectedIds.size} customer{selectedIds.size === 1 ? "" : "s"} will be
              permanently deleted.
              <span className="mt-2 block font-medium text-red-600">
                This cannot be undone.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={bulkDeleteMutation.isPending}
              onClick={() =>
                bulkDeleteMutation.mutate({ ids: Array.from(selectedIds) })
              }
            >
              {bulkDeleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
