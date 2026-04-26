"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { toast } from "sonner";
import { ArrowLeft, Check, ChevronsUpDown, Loader2, Save, Search } from "lucide-react";

import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { formatCurrency } from "~/lib/currency";

export default function NewInvoicePage() {
  const router = useRouter();
  const utils = api.useUtils();

  const today = dayjs().format("YYYY-MM-DD");
  const defaultDueDate = dayjs().add(30, "day").format("YYYY-MM-DD");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoicedDate, setInvoicedDate] = useState(today);
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [totalAmount, setTotalAmount] = useState("");
  const [taxRate, setTaxRate] = useState("9");
  const [customerId, setCustomerId] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [leaveOpen, setLeaveOpen] = useState(false);

  // Form is "dirty" when any field has changed from its initial default.
  const isDirty =
    invoiceNumber.trim() !== "" ||
    invoicedDate !== today ||
    dueDate !== defaultDueDate ||
    totalAmount.trim() !== "" ||
    taxRate.trim() !== "9" ||
    customerId !== "";

  // Browser-level guard: warn before refresh / tab close while there are
  // unsaved changes. Same UX as most editors.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const { data: customersData } = api.customer.list.useQuery({ limit: 100 });
  const customers = customersData?.customers ?? [];
  const selectedCustomer = customers.find((c) => c.id === customerId);
  const filteredCustomers = customers.filter((c) => {
    const q = customerSearch.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.company ?? "").toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q)
    );
  });

  const createInvoice = api.invoice.create.useMutation({
    onSuccess: (invoice) => {
      void utils.invoice.list.invalidate();
      toast.success("Draft invoice created");
      router.push(`/invoices/${invoice.id}`);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create invoice");
    },
  });

  // Live preview: invoice price is the net subtotal; we add tax on top.
  const subtotalNum = Number(totalAmount);
  const taxNum = Number(taxRate);
  const hasValidNumbers =
    Number.isFinite(subtotalNum) && subtotalNum > 0 && Number.isFinite(taxNum) && taxNum >= 0;
  const taxAmountPreview = hasValidNumbers ? subtotalNum * (taxNum / 100) : 0;
  const totalPreview = hasValidNumbers ? subtotalNum + taxAmountPreview : 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceNumber.trim()) {
      toast.error("Invoice number is required");
      return;
    }
    if (!hasValidNumbers) {
      toast.error("Invoice price must be greater than 0 and tax rate ≥ 0");
      return;
    }
    const start = dayjs(invoicedDate);
    const end = dayjs(dueDate);
    if (!start.isValid() || !end.isValid() || end.isBefore(start)) {
      toast.error("Due date must be on or after the invoice date");
      return;
    }
    const paymentTerms = end.diff(start, "day");

    createInvoice.mutate({
      invoiceNumber: invoiceNumber.trim(),
      invoicedDate: new Date(invoicedDate),
      paymentTerms,
      currency: "SGD",
      customerId: customerId || undefined,
      taxRate: taxNum,
      totalAmount: totalPreview,
      subtotal: subtotalNum,
      taxAmount: taxAmountPreview,
      items: [],
    });
  };

  // Intercept back/cancel — if the form has unsaved input, ask first.
  const handleLeave = () => {
    if (isDirty) {
      setLeaveOpen(true);
    } else {
      router.push("/invoices");
    }
  };
  const confirmLeave = () => {
    setLeaveOpen(false);
    router.push("/invoices");
  };
  const saveAndLeave = () => {
    setLeaveOpen(false);
    handleSubmit({ preventDefault: () => {} } as React.FormEvent);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleLeave}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-base font-semibold">New Invoice</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50 p-4 md:p-8">
        <form onSubmit={handleSubmit} className="mx-auto max-w-xl">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Invoice details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="invoiceNumber">
                  Invoice number <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="invoiceNumber"
                  placeholder="INV-001"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label>Customer</Label>
                <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-md border bg-white px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      {selectedCustomer ? (
                        <span className="truncate font-medium">
                          {selectedCustomer.company || selectedCustomer.name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Select a customer (optional)…</span>
                      )}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                    <div className="border-b px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Search className="h-3.5 w-3.5 text-muted-foreground" />
                        <input
                          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                          placeholder="Search customers…"
                          value={customerSearch}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="max-h-56 overflow-y-auto py-1">
                      {customers.length === 0 ? (
                        <p className="px-3 py-2 text-center text-xs text-muted-foreground">
                          No customers yet — add one from the Customers page first
                        </p>
                      ) : filteredCustomers.length === 0 ? (
                        <p className="px-3 py-2 text-center text-xs text-muted-foreground">No matches</p>
                      ) : (
                        <>
                          {selectedCustomer && (
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-gray-100"
                              onClick={() => {
                                setCustomerId("");
                                setCustomerOpen(false);
                                setCustomerSearch("");
                              }}
                            >
                              Clear selection
                            </button>
                          )}
                          {filteredCustomers.map((c) => {
                            const primary = c.company || c.name;
                            const secondary = c.company ? c.name : c.email;
                            return (
                              <button
                                key={c.id}
                                type="button"
                                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-100 ${c.id === customerId ? "bg-blue-50" : ""}`}
                                onClick={() => {
                                  setCustomerId(c.id);
                                  setCustomerOpen(false);
                                  setCustomerSearch("");
                                }}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate">{primary}</p>
                                  {secondary && (
                                    <p className="truncate text-xs text-muted-foreground">{secondary}</p>
                                  )}
                                </div>
                                {c.id === customerId && (
                                  <Check className="ml-auto h-4 w-4 shrink-0 text-blue-600" />
                                )}
                              </button>
                            );
                          })}
                        </>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="invoicedDate">
                    Invoice date <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="invoicedDate"
                    type="date"
                    value={invoicedDate}
                    onChange={(e) => setInvoicedDate(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dueDate">
                    Due date <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="dueDate"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="totalAmount">
                    Invoice price (SGD, before tax) <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="totalAmount"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="taxRate">Tax rate (%)</Label>
                  <Input
                    id="taxRate"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    placeholder="9"
                    value={taxRate}
                    onChange={(e) => setTaxRate(e.target.value)}
                  />
                </div>
              </div>

              <div className="rounded-lg border bg-gray-50 px-4 py-3 text-sm">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{formatCurrency(subtotalNum || 0, "SGD")}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-muted-foreground">
                  <span>Tax ({Number.isFinite(taxNum) ? taxNum : 0}%)</span>
                  <span className="tabular-nums">{formatCurrency(taxAmountPreview, "SGD")}</span>
                </div>
                <div className="mt-2 flex items-center justify-between border-t pt-2 font-semibold">
                  <span>Total after tax</span>
                  <span className="tabular-nums text-base">{formatCurrency(totalPreview, "SGD")}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={handleLeave}>
              Cancel
            </Button>
            <Button type="submit" disabled={createInvoice.isPending}>
              {createInvoice.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {createInvoice.isPending ? "Saving..." : "Save Draft"}
            </Button>
          </div>
        </form>
      </div>

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Leave without saving?</DialogTitle>
            <DialogDescription>
              You have unsaved changes on this invoice. If you leave now, they&apos;ll be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={confirmLeave}>
              Leave without saving
            </Button>
            <Button onClick={saveAndLeave} disabled={createInvoice.isPending}>
              {createInvoice.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
