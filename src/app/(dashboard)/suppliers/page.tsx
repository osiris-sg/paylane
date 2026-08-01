"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
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
  Truck,
  Upload,
  MessageCircle,
  AlertTriangle,
} from "lucide-react";
import { useRowSelection } from "~/lib/use-row-selection";
import { TablePagination } from "~/components/table-pagination";

const PAGE_SIZE = 10;

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

function CountBanner({ count }: { count: number }) {
  return (
    <div className="mb-3 overflow-hidden rounded-xl border-2 border-blue-300 bg-gradient-to-br from-blue-50 via-blue-100/70 to-blue-50 px-4 py-3 shadow-sm dark:border-blue-700 dark:from-blue-950/50 dark:via-blue-900/30 dark:to-blue-950/40">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
          <Truck className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-800 dark:text-blue-200">
            Total suppliers
          </p>
          <p className="text-xl font-bold tabular-nums tracking-tight text-blue-900 dark:text-blue-100 sm:text-2xl">
            {count} supplier{count === 1 ? "" : "s"}
          </p>
        </div>
      </div>
    </div>
  );
}

interface SupplierFormData {
  name: string;
  email: string;
  phone: string;
  address: string;
  company: string;
}

const emptyForm: SupplierFormData = {
  name: "",
  email: "",
  phone: "",
  address: "",
  company: "",
};

export default function SuppliersPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<SupplierFormData>(emptyForm);

  // Debounce the search box so we don't hit the server on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, refetch } = api.supplier.list.useQuery({
    search: debouncedSearch || undefined,
    page,
    limit: PAGE_SIZE,
  });

  const suppliers = useMemo(() => data?.suppliers ?? [], [data]);
  const supplierIds = useMemo(() => suppliers.map((s) => s.id), [suppliers]);
  const {
    selectedIds,
    toggle: toggleSelect,
    toggleAll: toggleSelectAll,
    clear: clearSelection,
    isAllSelected,
    isSomeSelected,
  } = useRowSelection(supplierIds);

  const totalCount = data?.totalCount ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const createMutation = api.supplier.create.useMutation({
    onSuccess: () => {
      toast.success("Supplier created");
      setDialogOpen(false);
      setFormData(emptyForm);
      void refetch();
    },
    onError: (e) => toast.error(e.message || "Failed to create supplier"),
  });

  const updateMutation = api.supplier.update.useMutation({
    onSuccess: () => {
      toast.success("Supplier updated");
      setDialogOpen(false);
      setFormData(emptyForm);
      setEditingId(null);
      void refetch();
    },
    onError: (e) => toast.error(e.message || "Failed to update supplier"),
  });

  const bulkDeleteMutation = api.supplier.bulkDelete.useMutation({
    onSuccess: (res) => {
      toast.success(`${res.count} supplier${res.count === 1 ? "" : "s"} deleted`);
      setConfirmDeleteOpen(false);
      clearSelection();
      void refetch();
    },
    onError: (e) => toast.error(e.message || "Failed to delete suppliers"),
  });

  const openCreateDialog = () => {
    setEditingId(null);
    setFormData(emptyForm);
    setDialogOpen(true);
  };

  const openEditDialog = (supplier: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    company: string | null;
  }) => {
    setEditingId(supplier.id);
    setFormData({
      name: supplier.name,
      email: supplier.email ?? "",
      phone: supplier.phone ?? "",
      address: supplier.address ?? "",
      company: supplier.company ?? "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.company.trim()) {
      toast.error("Company name is required");
      return;
    }

    const payload = {
      company: formData.company.trim(),
      name: formData.name.trim() || undefined,
      email: formData.email.trim() || undefined,
      phone: formData.phone.trim() || undefined,
      address: formData.address.trim() || undefined,
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isMutating = createMutation.isPending || updateMutation.isPending;

  // Edit acts on one supplier, so it only shows with exactly one row selected
  // (Delete works for any number) — mirrors the customers/statements tables.
  const singleSelected =
    selectedIds.size === 1
      ? suppliers.find((s) => selectedIds.has(s.id)) ?? null
      : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Suppliers</h1>
          <p className="text-muted-foreground">
            Manage your suppliers and their information.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/suppliers/import">
              <Upload className="mr-2 h-4 w-4" />
              Import Suppliers
            </Link>
          </Button>
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Add Supplier
          </Button>
        </div>
      </div>

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
            <Truck className="h-12 w-12 text-muted-foreground" />
            <h3 className="text-lg font-semibold">No suppliers yet</h3>
            <p className="max-w-md text-sm text-muted-foreground">
              Add your first supplier or import from a list.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link href="/suppliers/import">
                  <Upload className="mr-2 h-4 w-4" />
                  Import
                </Link>
              </Button>
              <Button onClick={openCreateDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Add Supplier
              </Button>
            </div>
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
                      onClick={() => openEditDialog(singleSelected)}
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      Edit
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={bulkDeleteMutation.isPending}
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
                      placeholder="Search suppliers..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>
              )}
            </div>

            <CountBanner count={totalCount} />

            {suppliers.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No suppliers match &ldquo;{debouncedSearch}&rdquo;.
              </p>
            ) : (
              <>
                {/* Mobile: card per supplier */}
                <div className="space-y-3 md:hidden">
                  {suppliers.map((supplier) => {
                    const isSelected = selectedIds.has(supplier.id);
                    return (
                      <div
                        key={supplier.id}
                        onClick={() => router.push(`/suppliers/${supplier.id}`)}
                        className={`cursor-pointer select-none rounded-lg border bg-white p-3 transition-colors ${isSelected ? "border-blue-300 bg-blue-50" : ""}`}
                      >
                        <div className="flex items-start gap-2">
                          <Checkbox
                            checked={isSelected}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelect(supplier.id, e);
                            }}
                            className="mt-1"
                            aria-label={`Select ${supplier.company || supplier.name}`}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold">
                              {supplier.company || supplier.name}
                            </p>
                            {supplier.company && supplier.name && supplier.name !== supplier.company && (
                              <p className="truncate text-xs text-muted-foreground">{supplier.name}</p>
                            )}
                            <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                              {supplier.email && (
                                <p className="flex items-center gap-1.5 truncate">
                                  <Mail className="h-3.5 w-3.5 shrink-0" />
                                  {supplier.email}
                                </p>
                              )}
                              {supplier.phone && (
                                <p className="flex items-center gap-1.5">
                                  <Phone className="h-3.5 w-3.5 shrink-0" />
                                  {supplier.phone}
                                </p>
                              )}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <Badge variant="secondary" className="gap-1">
                                <FileText className="h-3 w-3" />
                                {supplier.invoiceCount}{" "}
                                {supplier.invoiceCount === 1 ? "invoice" : "invoices"}
                              </Badge>
                              {supplier.whatsappEnabled && <WhatsAppBadge />}
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
                        <TableHead>Supplier</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Invoices</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {suppliers.map((supplier) => {
                        const isSelected = selectedIds.has(supplier.id);
                        return (
                          <TableRow
                            key={supplier.id}
                            onClick={() => router.push(`/suppliers/${supplier.id}`)}
                            className={`cursor-pointer select-none ${isSelected ? "bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30" : ""}`}
                          >
                            <TableCell>
                              <Checkbox
                                checked={isSelected}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSelect(supplier.id, e);
                                }}
                                aria-label={`Select ${supplier.company || supplier.name}`}
                              />
                            </TableCell>
                            <TableCell>
                              <p className="font-medium">
                                {supplier.company || supplier.name}
                              </p>
                              {supplier.company && supplier.name && supplier.name !== supplier.company && (
                                <p className="text-xs text-muted-foreground">{supplier.name}</p>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="space-y-0.5 text-sm text-muted-foreground">
                                {supplier.email && (
                                  <p className="flex items-center gap-1.5 truncate">
                                    <Mail className="h-3.5 w-3.5 shrink-0" />
                                    {supplier.email}
                                  </p>
                                )}
                                {supplier.phone && (
                                  <p className="flex items-center gap-1.5">
                                    <Phone className="h-3.5 w-3.5 shrink-0" />
                                    {supplier.phone}
                                  </p>
                                )}
                                {!supplier.email && !supplier.phone && <span>—</span>}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="gap-1">
                                <FileText className="h-3 w-3" />
                                {supplier.invoiceCount}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {supplier.whatsappEnabled ? (
                                <WhatsAppBadge />
                              ) : (
                                <span className="text-sm text-muted-foreground">—</span>
                              )}
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
              {editingId ? "Edit Supplier" : "Add Supplier"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update the supplier's information below."
                : "Fill in the details to create a new supplier."}
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
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isMutating}>
                {isMutating
                  ? "Saving..."
                  : editingId
                    ? "Update Supplier"
                    : "Create Supplier"}
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
            <DialogTitle>Delete selected suppliers?</DialogTitle>
            <DialogDescription>
              {selectedIds.size} supplier{selectedIds.size === 1 ? "" : "s"} will be
              permanently deleted. Their invoices will not be removed.
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
