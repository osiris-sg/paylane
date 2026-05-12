"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
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
  MapPin,
  FileText,
  ChevronLeft,
  ChevronRight,
  Users,
  Upload,
  MessageCircle,
  Send,
} from "lucide-react";
import Link from "next/link";
import { useSendAccess } from "~/lib/use-send-access";
import { LockedSendingCTA } from "~/components/subscription/locked-sending-cta";
import { ExpiredBanner } from "~/components/subscription/expired-banner";

interface CustomerFormData {
  name: string;
  email: string;
  phone: string;
  address: string;
  company: string;
}

const emptyForm: CustomerFormData = {
  name: "",
  email: "",
  phone: "",
  address: "",
  company: "",
};

export default function CustomersPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CustomerFormData>(emptyForm);

  const access = useSendAccess();
  const sendDisabled = !access.canSend;

  const limit = 12;

  const { data, isLoading, refetch } = api.customer.list.useQuery({
    search: debouncedSearch || undefined,
    page,
    limit,
  });

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

  const deleteMutation = api.customer.delete.useMutation({
    onSuccess: () => {
      toast.success("Customer deleted successfully");
      setDeleteDialogOpen(false);
      setDeletingId(null);
      void refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete customer");
    },
  });

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
    // Simple debounce using setTimeout
    const timeout = setTimeout(() => {
      setDebouncedSearch(value);
    }, 300);
    return () => clearTimeout(timeout);
  };

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
  }) => {
    setEditingId(customer.id);
    setFormData({
      name: customer.name,
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      address: customer.address ?? "",
      company: customer.company ?? "",
    });
    setDialogOpen(true);
  };

  const openDeleteDialog = (id: string) => {
    setDeletingId(id);
    setDeleteDialogOpen(true);
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

  const handleDelete = () => {
    if (deletingId) {
      deleteMutation.mutate({ id: deletingId });
    }
  };

  const isMutating = createMutation.isPending || updateMutation.isPending;

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
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
        <p className="text-muted-foreground">
          Manage your customers and their information.
        </p>
      </div>

      {access.state === "expired" && (
        <ExpiredBanner message="Your free trial has ended. Upgrade to add or edit customers." />
      )}

      {/* Search + Add Customer */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search customers..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {sendDisabled ? (
            <Button variant="outline" disabled>
              <Send className="mr-2 h-4 w-4" />
              Send Statements
            </Button>
          ) : (
            <Button variant="outline" asChild>
              <Link href="/customers/send-statements">
                <Send className="mr-2 h-4 w-4" />
                Send Statements
              </Link>
            </Button>
          )}
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

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-3">
                <div className="h-5 w-36 rounded bg-muted" />
                <div className="h-4 w-24 rounded bg-muted" />
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="h-4 w-48 rounded bg-muted" />
                <div className="h-4 w-32 rounded bg-muted" />
                <div className="h-4 w-40 rounded bg-muted" />
                <Separator className="my-3" />
                <div className="flex items-center justify-between">
                  <div className="h-5 w-20 rounded bg-muted" />
                  <div className="flex gap-2">
                    <div className="h-8 w-8 rounded bg-muted" />
                    <div className="h-8 w-8 rounded bg-muted" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && data?.customers.length === 0 && (
        <Card className="flex flex-col items-center justify-center py-16">
          <Users className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="text-lg font-semibold">No customers yet</h3>
          <p className="mb-4 text-sm text-muted-foreground">
            Add your first customer to get started.
          </p>
          <Button onClick={openCreateDialog} disabled={sendDisabled}>
            <Plus className="mr-2 h-4 w-4" />
            Add Customer
          </Button>
        </Card>
      )}

      {/* Customer Grid */}
      {!isLoading && data && data.customers.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {data.customers.map((customer) => (
              <Card
                key={customer.id}
                onClick={() => router.push(`/customers/${customer.id}`)}
                className="cursor-pointer transition-shadow hover:shadow-md"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="truncate text-lg">
                        {customer.company || customer.name}
                      </CardTitle>
                      {customer.company && (
                        <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                          {customer.name}
                        </p>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5 text-sm text-muted-foreground">
                    {customer.email && (
                      <p className="flex items-center gap-2 truncate">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        {customer.email}
                      </p>
                    )}
                    {customer.phone && (
                      <p className="flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        {customer.phone}
                      </p>
                    )}
                    {customer.address && (
                      <p className="flex items-center gap-2 truncate">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        {customer.address}
                      </p>
                    )}
                  </div>

                  <Separator className="my-3" />

                  <div className="flex items-center justify-between">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="gap-1">
                        <FileText className="h-3 w-3" />
                        {customer._count.invoices}{" "}
                        {customer._count.invoices === 1 ? "invoice" : "invoices"}
                      </Badge>
                      {customer.whatsappEnabled && (
                        <Badge
                          variant="outline"
                          className="gap-1 border-green-300 bg-green-50 text-green-700"
                          title="WhatsApp notifications enabled"
                        >
                          <MessageCircle className="h-3 w-3" />
                          WhatsApp
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEditDialog(customer)}
                        disabled={sendDisabled}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span className="sr-only">Edit</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => openDeleteDialog(customer.id)}
                        disabled={sendDisabled}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span className="sr-only">Delete</span>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * limit + 1} to{" "}
                {Math.min(page * limit, data.totalCount)} of {data.totalCount}{" "}
                customers
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {data.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                  disabled={page === data.totalPages}
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
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

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Customer</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this customer? This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
