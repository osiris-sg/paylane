"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Save } from "lucide-react";

import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

export default function NewInvoicePage() {
  const router = useRouter();
  const utils = api.useUtils();

  const today = dayjs().format("YYYY-MM-DD");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoicedDate, setInvoicedDate] = useState(today);
  const [dueDate, setDueDate] = useState(dayjs().add(30, "day").format("YYYY-MM-DD"));
  const [totalAmount, setTotalAmount] = useState("");
  const [taxRate, setTaxRate] = useState("9");

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceNumber.trim()) {
      toast.error("Invoice number is required");
      return;
    }
    const total = Number(totalAmount);
    if (!Number.isFinite(total) || total <= 0) {
      toast.error("Invoice price must be greater than 0");
      return;
    }
    const tax = Number(taxRate);
    if (!Number.isFinite(tax) || tax < 0) {
      toast.error("Tax rate must be 0 or greater");
      return;
    }
    const start = dayjs(invoicedDate);
    const end = dayjs(dueDate);
    if (!start.isValid() || !end.isValid() || end.isBefore(start)) {
      toast.error("Due date must be on or after the invoice date");
      return;
    }
    const paymentTerms = end.diff(start, "day");
    // Treat the price as the gross total. Derive subtotal + taxAmount so the
    // numbers shown on the detail page reconcile.
    const subtotal = total / (1 + tax / 100);
    const taxAmount = total - subtotal;

    createInvoice.mutate({
      invoiceNumber: invoiceNumber.trim(),
      invoicedDate: new Date(invoicedDate),
      paymentTerms,
      currency: "SGD",
      taxRate: tax,
      totalAmount: total,
      subtotal,
      taxAmount,
      items: [],
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push("/invoices")}>
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
                    Invoice price (SGD) <span className="text-destructive">*</span>
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
            </CardContent>
          </Card>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => router.push("/invoices")}>
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
    </div>
  );
}
