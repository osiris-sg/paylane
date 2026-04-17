"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useReactToPrint } from "react-to-print";
import dayjs from "dayjs";
import { toast } from "sonner";
import {
  ArrowLeft,
  Save,
  Send,
  Eye,
  Printer,
  Plus,
  Trash2,
  Search,
} from "lucide-react";

import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Separator } from "~/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

interface LineItem {
  id: number;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

function formatCurrency(value: number, currency: string = "SGD") {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}

// ─── Form Row (label-value table style) ───────────────────────────────────────

function FormRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex border-b last:border-b-0 ${className ?? ""}`}>
      <div className="flex w-36 shrink-0 items-center bg-gray-50 px-3 py-2 text-sm font-medium text-gray-600">
        {label}
      </div>
      <div className="flex flex-1 items-center px-3 py-1.5">{children}</div>
    </div>
  );
}

// ─── Customer Select Dialog ───────────────────────────────────────────────────

function CustomerSelectDialog({
  open,
  onOpenChange,
  customers,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: { id: string; name: string; company: string | null; email: string | null }[];
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.company ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (c.email ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Customer</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search customers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No customers found</p>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  onSelect(c.id);
                  onOpenChange(false);
                }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm hover:bg-gray-100"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.company ?? c.email ?? ""}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Invoice Preview (print-ready) ────────────────────────────────────────────

interface PreviewProps {
  invoiceNumber: string;
  reference: string;
  invoicedDate: string;
  paymentTerms: number;
  currency: string;
  customer: { name: string; email: string; phone: string; address: string; company: string } | null;
  fromAddress: string;
  toAddress: string;
  items: LineItem[];
  taxRate: number;
  notes: string;
  senderCompanyName: string;
}

function InvoicePreview({
  invoiceNumber,
  reference,
  invoicedDate,
  paymentTerms,
  currency,
  customer,
  fromAddress,
  toAddress,
  items,
  taxRate,
  notes,
  senderCompanyName,
}: PreviewProps) {
  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;
  const dueDate = dayjs(invoicedDate).add(paymentTerms, "day");

  return (
    <div className="mx-auto max-w-[800px] bg-white p-8 shadow-lg print:shadow-none">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">INVOICE</h1>
          <p className="mt-1 text-lg font-medium text-blue-600">{invoiceNumber || "---"}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-gray-900">{senderCompanyName}</p>
          {fromAddress && <p className="mt-1 whitespace-pre-line text-sm text-gray-600">{fromAddress}</p>}
        </div>
      </div>
      <Separator className="mb-6" />
      <div className="mb-8 grid grid-cols-2 gap-8">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Bill To</p>
          {customer ? (
            <div>
              <p className="font-semibold text-gray-900">{customer.name}</p>
              {customer.company && <p className="text-sm text-gray-600">{customer.company}</p>}
              {(toAddress || customer.address) && (
                <p className="mt-1 whitespace-pre-line text-sm text-gray-600">{toAddress || customer.address}</p>
              )}
              {customer.email && <p className="text-sm text-gray-600">{customer.email}</p>}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No customer selected</p>
          )}
        </div>
        <div className="space-y-2 text-right">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Invoice Date</p>
            <p className="text-sm">{invoicedDate ? dayjs(invoicedDate).format("MMMM D, YYYY") : "---"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Due Date</p>
            <p className="text-sm">{invoicedDate ? dueDate.format("MMMM D, YYYY") : "---"}</p>
          </div>
          {reference && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Reference</p>
              <p className="text-sm">{reference}</p>
            </div>
          )}
        </div>
      </div>
      <table className="mb-6 w-full">
        <thead>
          <tr className="border-b-2 border-gray-200">
            <th className="py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Description</th>
            <th className="py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">Qty</th>
            <th className="py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Unit Price</th>
            <th className="py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={4} className="py-8 text-center text-gray-400">No items</td></tr>
          ) : (
            items.map((item, i) => (
              <tr key={item.id} className={i < items.length - 1 ? "border-b border-gray-100" : ""}>
                <td className="py-3 text-sm">{item.description || "---"}</td>
                <td className="py-3 text-center text-sm">{item.quantity}</td>
                <td className="py-3 text-right text-sm">{formatCurrency(item.unitPrice, currency)}</td>
                <td className="py-3 text-right text-sm font-medium">{formatCurrency(item.amount, currency)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="flex justify-end">
        <div className="w-64 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Subtotal</span>
            <span>{formatCurrency(subtotal, currency)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Tax ({taxRate}%)</span>
            <span>{formatCurrency(taxAmount, currency)}</span>
          </div>
          <Separator />
          <div className="flex justify-between text-lg font-bold">
            <span>Total</span>
            <span>{formatCurrency(total, currency)}</span>
          </div>
        </div>
      </div>
      {notes && (
        <div className="mt-8 border-t pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Notes</p>
          <p className="mt-1 whitespace-pre-line text-sm text-gray-600">{notes}</p>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CreateInvoicePage() {
  const router = useRouter();
  const printRef = useRef<HTMLDivElement>(null);

  const [previewMode, setPreviewMode] = useState(false);
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);

  // Form state
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [reference, setReference] = useState("");
  const [invoicedDate, setInvoicedDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [paymentTerms, setPaymentTerms] = useState(30);
  const [currency, setCurrency] = useState("SGD");
  const [customerId, setCustomerId] = useState<string>("");
  const [fromAddress, setFromAddress] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [contact, setContact] = useState("");
  const [taxRate, setTaxRate] = useState(9);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([
    { id: Date.now(), description: "", quantity: 1, unitPrice: 0, amount: 0 },
  ]);

  // Items sub-tab
  const [itemsTab, setItemsTab] = useState("details");

  // Fetch customers
  const { data: customersData } = api.customer.list.useQuery({ limit: 100 });
  const customers = customersData?.customers ?? [];
  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;

  // Mutations
  const createInvoice = api.invoice.create.useMutation({
    onSuccess: (data) => {
      toast.success("Invoice saved as draft");
      router.push(`/invoices/${data.id}`);
    },
    onError: (err) => toast.error(err.message || "Failed to create invoice"),
  });

  const createAndSend = api.invoice.create.useMutation();
  const sendInvoice = api.invoice.send.useMutation({
    onSuccess: (data) => {
      toast.success("Invoice sent to customer");
      router.push(`/invoices/${data.id}`);
    },
    onError: () => toast.error("Failed to send invoice"),
  });

  const handlePrint = useReactToPrint({ contentRef: printRef, documentTitle: invoiceNumber || "Invoice" });

  // Item management
  const addItem = () => {
    setItems([...items, { id: Date.now(), description: "", quantity: 1, unitPrice: 0, amount: 0 }]);
  };

  const removeItem = (id: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((item) => item.id !== id));
  };

  const updateItem = (id: number, field: keyof LineItem, value: string | number) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value };
        updated.amount = updated.quantity * updated.unitPrice;
        return updated;
      }),
    );
  };

  // Calculations
  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  const buildPayload = useCallback(() => {
    if (!invoiceNumber.trim()) { toast.error("Invoice number is required"); return null; }
    if (!invoicedDate) { toast.error("Invoice date is required"); return null; }
    return {
      invoiceNumber: invoiceNumber.trim(),
      reference: reference.trim() || undefined,
      invoicedDate: new Date(invoicedDate),
      paymentTerms,
      currency,
      customerId: customerId || undefined,
      fromAddress: fromAddress.trim() || undefined,
      toAddress: toAddress.trim() || undefined,
      taxRate,
      notes: notes.trim() || undefined,
      items: items.filter((item) => item.description.trim()).map((item, index) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.amount,
        sortOrder: index,
      })),
    };
  }, [invoiceNumber, reference, invoicedDate, paymentTerms, currency, customerId, fromAddress, toAddress, taxRate, notes, items]);

  const handleSave = () => { const p = buildPayload(); if (p) createInvoice.mutate(p); };

  const handleSendToCustomer = async () => {
    const p = buildPayload();
    if (!p) return;
    try {
      const created = await createAndSend.mutateAsync(p);
      sendInvoice.mutate({ id: created.id });
    } catch { toast.error("Failed to create invoice"); }
  };

  const isSaving = createInvoice.isPending || createAndSend.isPending || sendInvoice.isPending;

  const customerForPreview = selectedCustomer
    ? { name: selectedCustomer.name, email: selectedCustomer.email ?? "", phone: selectedCustomer.phone ?? "", address: selectedCustomer.address ?? "", company: selectedCustomer.company ?? "" }
    : null;

  return (
    <div className="flex h-full flex-col">
      {/* ─── Header Bar ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push("/invoices")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-base font-semibold">{invoiceNumber || "New Invoice"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setPreviewMode(!previewMode)}>
            <Eye className="mr-1.5 h-3.5 w-3.5" />
            <span className="hidden sm:inline">{previewMode ? "Edit" : "Preview"}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => handlePrint()}>
            <Printer className="mr-1.5 h-3.5 w-3.5" />
            <span className="hidden sm:inline">Print / PDF</span>
          </Button>
          <Button variant="outline" size="sm" className="border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100" onClick={handleSendToCustomer} disabled={isSaving}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            <span className="hidden sm:inline">{createAndSend.isPending || sendInvoice.isPending ? "Sending..." : "Send"}</span>
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            <Save className="mr-1.5 h-3.5 w-3.5" />
            {createInvoice.isPending ? "Saving..." : "Save As Draft"}
          </Button>
        </div>
      </div>

      {/* Hidden print target */}
      <div className="hidden print:block" ref={printRef}>
        <InvoicePreview invoiceNumber={invoiceNumber} reference={reference} invoicedDate={invoicedDate} paymentTerms={paymentTerms} currency={currency} customer={customerForPreview} fromAddress={fromAddress} toAddress={toAddress} items={items.filter((i) => i.description.trim())} taxRate={taxRate} notes={notes} senderCompanyName="My Company" />
      </div>

      {/* ─── Content ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-gray-50">
        {previewMode ? (
          <div className="p-6">
            <InvoicePreview invoiceNumber={invoiceNumber} reference={reference} invoicedDate={invoicedDate} paymentTerms={paymentTerms} currency={currency} customer={customerForPreview} fromAddress={fromAddress} toAddress={toAddress} items={items.filter((i) => i.description.trim())} taxRate={taxRate} notes={notes} senderCompanyName="My Company" />
          </div>
        ) : (
          <div className="flex h-full flex-col">
            {/* ─── Tabs: General / Details ─────────────────────────── */}
            <div className="border-b bg-white px-4">
              <Tabs defaultValue="general">
                <TabsList className="h-9 bg-transparent p-0">
                  <TabsTrigger value="general" className="rounded-none border-b-2 border-transparent px-4 data-[state=active]:border-blue-600 data-[state=active]:bg-transparent data-[state=active]:shadow-none">
                    GENERAL
                  </TabsTrigger>
                  <TabsTrigger value="details" className="rounded-none border-b-2 border-transparent px-4 data-[state=active]:border-blue-600 data-[state=active]:bg-transparent data-[state=active]:shadow-none">
                    DETAILS
                  </TabsTrigger>
                </TabsList>

                {/* ─── General Tab ──────────────────────────────────── */}
                <TabsContent value="general" className="mt-0">
                  <div className="flex flex-col gap-4 p-4 lg:flex-row">
                    {/* Left: Form fields (table style) */}
                    <div className="flex-1 overflow-hidden rounded-md border bg-white">
                      <div className="border-b bg-gray-50 px-3 py-1.5 text-sm font-semibold text-gray-700">
                        General
                      </div>
                      <FormRow label="Invoice No.">
                        <Input
                          className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0"
                          placeholder="INV-001"
                          value={invoiceNumber}
                          onChange={(e) => setInvoiceNumber(e.target.value)}
                        />
                      </FormRow>
                      <FormRow label="Date">
                        <Input
                          type="date"
                          className="h-8 w-44 border-0 bg-transparent shadow-none focus-visible:ring-0"
                          value={invoicedDate}
                          onChange={(e) => setInvoicedDate(e.target.value)}
                        />
                      </FormRow>
                      <FormRow label="Customer">
                        <button
                          onClick={() => setCustomerDialogOpen(true)}
                          className="flex items-center gap-2 text-sm"
                        >
                          <Search className="h-3.5 w-3.5 text-muted-foreground" />
                          {selectedCustomer ? (
                            <>
                              <span className="font-medium">{selectedCustomer.name}</span>
                              {selectedCustomer.company && (
                                <span className="text-muted-foreground">{selectedCustomer.company}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-foreground">Click to select customer</span>
                          )}
                        </button>
                      </FormRow>
                      <FormRow label="Reference">
                        <Input
                          className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0"
                          placeholder="PO-1234"
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                        />
                      </FormRow>
                      <FormRow label="Deliver to">
                        <Input
                          className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0"
                          placeholder="Delivery address"
                          value={toAddress}
                          onChange={(e) => setToAddress(e.target.value)}
                        />
                      </FormRow>
                      <FormRow label="Contact">
                        <Input
                          className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0"
                          placeholder="Contact number"
                          value={contact}
                          onChange={(e) => setContact(e.target.value)}
                        />
                      </FormRow>
                      <FormRow label="Terms">
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min={0}
                            className="h-8 w-20 border-0 bg-transparent shadow-none focus-visible:ring-0"
                            value={paymentTerms}
                            onChange={(e) => setPaymentTerms(parseInt(e.target.value) || 0)}
                          />
                          <span className="text-sm text-muted-foreground">DAYS</span>
                        </div>
                      </FormRow>
                      <FormRow label="Currency">
                        <Select value={currency} onValueChange={setCurrency}>
                          <SelectTrigger className="h-8 w-28 border-0 bg-transparent shadow-none focus-visible:ring-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="SGD">SGD</SelectItem>
                            <SelectItem value="USD">USD</SelectItem>
                            <SelectItem value="EUR">EUR</SelectItem>
                            <SelectItem value="GBP">GBP</SelectItem>
                            <SelectItem value="MYR">MYR</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormRow>
                    </div>

                    {/* Right: Rate / Totals panel */}
                    <div className="w-72 shrink-0 overflow-hidden rounded-md border bg-white">
                      <div className="border-b bg-gray-50 px-3 py-1.5 text-sm font-semibold text-gray-700">
                        Rate
                      </div>
                      <div className="divide-y text-sm">
                        <div className="flex items-center justify-between px-3 py-2">
                          <span className="text-gray-600">Currency</span>
                          <span className="font-medium">{currency}</span>
                        </div>
                        <div className="flex items-center justify-between px-3 py-2">
                          <span className="text-gray-600">Gross Total</span>
                          <span className="font-medium tabular-nums">{formatCurrency(subtotal, currency)}</span>
                        </div>
                        <div className="flex items-center justify-between px-3 py-2">
                          <span className="text-gray-600">Sub-total</span>
                          <span className="font-medium tabular-nums">{formatCurrency(subtotal, currency)}</span>
                        </div>
                        <div className="flex items-center justify-between px-3 py-2">
                          <span className="text-gray-600">Tax</span>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={0}
                              step={0.5}
                              className="h-7 w-14 text-center text-xs"
                              value={taxRate}
                              onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between px-3 py-2">
                          <span className="text-gray-600">GST</span>
                          <span className="font-medium tabular-nums">{formatCurrency(taxAmount, currency)}</span>
                        </div>
                        <div className="flex items-center justify-between bg-gray-50 px-3 py-2.5 font-semibold">
                          <span>Nett Total</span>
                          <span className="tabular-nums">{formatCurrency(total, currency)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* ─── Details Tab ──────────────────────────────────── */}
                <TabsContent value="details" className="mt-0">
                  <div className="p-4">
                    <div className="overflow-hidden rounded-md border bg-white">
                      <div className="border-b bg-gray-50 px-3 py-1.5 text-sm font-semibold text-gray-700">
                        Additional Details
                      </div>
                      <FormRow label="From Address">
                        <Input
                          className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0"
                          placeholder="Your company address"
                          value={fromAddress}
                          onChange={(e) => setFromAddress(e.target.value)}
                        />
                      </FormRow>
                      <FormRow label="Notes">
                        <Textarea
                          className="min-h-[60px] border-0 bg-transparent shadow-none focus-visible:ring-0"
                          placeholder="Additional notes, terms & conditions..."
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          rows={2}
                        />
                      </FormRow>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            {/* ─── Items Section (always visible) ──────────────────── */}
            <div className="flex flex-1 flex-col border-t bg-white px-4 pb-4">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm font-semibold text-gray-700">Items</span>
              </div>

              {/* Items sub-tabs */}
              <div className="mb-2 flex gap-4 border-b">
                <button
                  onClick={() => setItemsTab("details")}
                  className={`pb-2 text-sm font-medium ${itemsTab === "details" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500 hover:text-gray-700"}`}
                >
                  DETAILS
                </button>
                <button
                  onClick={() => setItemsTab("footer")}
                  className={`pb-2 text-sm font-medium ${itemsTab === "footer" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500 hover:text-gray-700"}`}
                >
                  FOOTER
                </button>
              </div>

              {itemsTab === "details" ? (
                <div className="flex flex-1 flex-col">
                  {/* Items table */}
                  <div className="flex-1 overflow-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="py-2 text-sm font-semibold text-gray-700" style={{ width: "35%" }}>Description</th>
                          <th className="py-2 text-center text-sm font-semibold text-gray-700" style={{ width: "12%" }}>Quantity</th>
                          <th className="py-2 text-center text-sm font-semibold text-gray-700" style={{ width: "15%" }}>Unit Price</th>
                          <th className="py-2 text-right text-sm font-semibold text-gray-700" style={{ width: "15%" }}>Amount</th>
                          <th className="py-2 text-center text-sm font-semibold text-gray-700" style={{ width: "8%" }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => (
                          <tr key={item.id} className="border-b last:border-b-0">
                            <td className="py-1.5">
                              <Input
                                placeholder="Item description"
                                value={item.description}
                                onChange={(e) => updateItem(item.id, "description", e.target.value)}
                                className="h-9 border-gray-200"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <Input
                                type="number"
                                min={0}
                                value={item.quantity}
                                onChange={(e) => updateItem(item.id, "quantity", parseFloat(e.target.value) || 0)}
                                className="h-9 border-gray-200 text-center"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <Input
                                type="number"
                                min={0}
                                step={0.01}
                                value={item.unitPrice}
                                onChange={(e) => updateItem(item.id, "unitPrice", parseFloat(e.target.value) || 0)}
                                className="h-9 border-gray-200 text-center"
                              />
                            </td>
                            <td className="py-1.5 text-right text-sm font-medium tabular-nums">
                              {item.amount.toFixed(2)}
                            </td>
                            <td className="py-1.5 text-center">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-red-500 hover:bg-red-50 hover:text-red-600"
                                onClick={() => removeItem(item.id)}
                                disabled={items.length <= 1}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <Button variant="outline" size="sm" onClick={addItem} className="mt-2 w-fit">
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add Item
                  </Button>

                  {/* Bottom totals */}
                  <div className="mt-auto flex justify-end pt-4">
                    <div className="w-64 space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Subtotal:</span>
                        <span className="font-semibold tabular-nums">{currency} {subtotal.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Tax ({taxRate}%):</span>
                        <span className="tabular-nums">{currency} {taxAmount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between border-t pt-1 text-base font-bold">
                        <span>Total:</span>
                        <span className="tabular-nums">{currency} {total.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* ─── Footer sub-tab ───────────────────────────────── */
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-600">Notes / Terms & Conditions</label>
                    <Textarea
                      placeholder="Payment terms, bank details, terms & conditions..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={5}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Customer select dialog */}
      <CustomerSelectDialog
        open={customerDialogOpen}
        onOpenChange={setCustomerDialogOpen}
        customers={customers}
        onSelect={setCustomerId}
      />
    </div>
  );
}
