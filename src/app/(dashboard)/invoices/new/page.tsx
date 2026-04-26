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
import { formatCurrency } from "~/lib/currency";

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
      taxRate: taxNum,
      totalAmount: totalPreview,
      subtotal: subtotalNum,
      taxAmount: taxAmountPreview,
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
