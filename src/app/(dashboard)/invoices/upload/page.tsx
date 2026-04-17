"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { toast } from "sonner";
import {
  ArrowLeft,
  Upload,
  Save,
  Send,
  Trash2,
  FileText,
  Loader2,
  Check,
  AlertCircle,
  ChevronsUpDown,
  Search,
  X,
  Plus,
} from "lucide-react";

import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Input } from "~/components/ui/input";

// ─── Types ────────────────────────────────────────────────────────────────────

type InvoiceStatus = "extracting" | "ready" | "error" | "saving" | "saved" | "sent";

interface UploadedInvoice {
  id: string;
  fileName: string;
  fileSize: number;
  file: File;
  status: InvoiceStatus;
  error?: string;
  invoiceNumber: string;
  customerName: string;
  customerEmail: string;
  reference: string;
  invoicedDate: string;
  dueDate: string;
  paymentTerms: number;
  currency: string;
  taxRate: number;
  totalAmount: number;
  subtotal: number;
  taxAmount: number;
  notes: string;
  items: { description: string; quantity: number; unitPrice: number; amount: number }[];
  customerId: string;
  fileDataUrl: string | null;
}

function formatCurrency(value: number, currency: string = "SGD") {
  return new Intl.NumberFormat("en-SG", { style: "currency", currency, minimumFractionDigits: 2 }).format(value);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Customer Picker ──────────────────────────────────────────────────────────

function CustomerPicker({
  customers,
  selectedId,
  onSelect,
  label,
}: {
  customers: { id: string; name: string; company: string | null; email: string | null }[];
  selectedId: string;
  onSelect: (id: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = customers.find((c) => c.id === selectedId);
  const filtered = customers.filter((c) => {
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.company ?? "").toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q);
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm hover:bg-gray-50">
          {selected ? (
            <span className="truncate font-medium">{selected.name}</span>
          ) : (
            <span className="text-muted-foreground">{label ?? "Select..."}</span>
          )}
          <ChevronsUpDown className="ml-auto h-3 w-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <div className="border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="max-h-48 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">No customers</p>
          ) : (
            filtered.map((c) => (
              <button key={c.id} onClick={() => { onSelect(c.id); setOpen(false); setSearch(""); }} className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 ${c.id === selectedId ? "bg-blue-50" : ""}`}>
                <span className="truncate">{c.name}</span>
                {c.id === selectedId && <Check className="ml-auto h-3.5 w-3.5 text-blue-600" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: InvoiceStatus }) {
  switch (status) {
    case "extracting":
      return <Badge variant="outline" className="gap-1 border-blue-300 bg-blue-50 text-blue-700"><Loader2 className="h-3 w-3 animate-spin" />Extracting</Badge>;
    case "ready":
      return <Badge variant="outline" className="gap-1 border-green-300 bg-green-50 text-green-700"><Check className="h-3 w-3" />Ready</Badge>;
    case "error":
      return <Badge variant="outline" className="gap-1 border-red-300 bg-red-50 text-red-700"><AlertCircle className="h-3 w-3" />Error</Badge>;
    case "saving":
      return <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-700"><Loader2 className="h-3 w-3 animate-spin" />Saving</Badge>;
    case "saved":
      return <Badge variant="outline" className="gap-1 border-green-300 bg-green-50 text-green-700"><Check className="h-3 w-3" />Saved</Badge>;
    case "sent":
      return <Badge variant="outline" className="gap-1 border-blue-300 bg-blue-50 text-blue-700"><Send className="h-3 w-3" />Sent</Badge>;
  }
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function UploadInvoicePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [invoices, setInvoices] = useState<UploadedInvoice[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);

  const { data: customersData } = api.customer.list.useQuery({ limit: 100 });
  const customers = customersData?.customers ?? [];

  const createInvoice = api.invoice.create.useMutation();
  const sendInvoice = api.invoice.send.useMutation();

  // ─── Add Files & Extract Immediately ─────────────────────────────────

  const processFile = async (id: string, file: File) => {
    const fileDataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/extract-invoice", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Extraction failed");
      }
      const { data } = await res.json();

      let matchedCustomerId = "";
      if (data.customerName || data.customerEmail) {
        const match = customers.find(
          (c) =>
            (data.customerName && c.name.toLowerCase().includes(data.customerName.toLowerCase())) ||
            (data.customerEmail && c.email?.toLowerCase() === data.customerEmail.toLowerCase()),
        );
        if (match) matchedCustomerId = match.id;
      }

      const sub = (data.items ?? []).reduce((s: number, i: { amount: number }) => s + (i.amount || 0), 0);
      const taxAmt = data.taxAmount ?? sub * ((data.taxRate ?? 9) / 100);
      const total = data.totalAmount ?? sub + taxAmt;

      setInvoices((prev) =>
        prev.map((x) =>
          x.id === id
            ? {
                ...x,
                status: "ready" as const,
                fileDataUrl,
                invoiceNumber: data.invoiceNumber ?? "",
                customerName: data.customerName ?? "",
                customerEmail: data.customerEmail ?? "",
                reference: data.reference ?? "",
                invoicedDate: data.invoicedDate ?? dayjs().format("YYYY-MM-DD"),
                dueDate: data.dueDate ?? "",
                paymentTerms: data.paymentTerms ?? 30,
                currency: data.currency ?? "SGD",
                taxRate: data.taxRate ?? 9,
                totalAmount: total,
                subtotal: sub,
                taxAmount: taxAmt,
                notes: data.notes ?? "",
                items: data.items ?? [],
                customerId: matchedCustomerId,
              }
            : x,
        ),
      );
    } catch (error) {
      setInvoices((prev) =>
        prev.map((x) => (x.id === id ? { ...x, status: "error" as const, error: String(error), fileDataUrl } : x)),
      );
    }
  };

  const addFiles = (files: FileList | File[]) => {
    const validTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

    for (const file of Array.from(files)) {
      if (!validTypes.includes(file.type)) { toast.error(`${file.name}: unsupported format`); continue; }
      if (file.size > 20 * 1024 * 1024) { toast.error(`${file.name}: too large (max 20MB)`); continue; }
      if (invoices.some((inv) => inv.fileName === file.name && inv.fileSize === file.size)) continue;

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const entry: UploadedInvoice = {
        id,
        fileName: file.name,
        fileSize: file.size,
        file,
        status: "extracting",
        invoiceNumber: "",
        customerName: "",
        customerEmail: "",
        reference: "",
        invoicedDate: "",
        dueDate: "",
        paymentTerms: 30,
        currency: "SGD",
        taxRate: 9,
        totalAmount: 0,
        subtotal: 0,
        taxAmount: 0,
        notes: "",
        items: [],
        customerId: "",
        fileDataUrl: null,
      };

      setInvoices((prev) => [...prev, entry]);
      // Start extraction immediately in background
      void processFile(id, file);
    }
  };

  // ─── Drop Handler ───────────────────────────────────────────────────

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices]);

  // ─── Selection ──────────────────────────────────────────────────────

  const actionableInvoices = invoices.filter((i) => i.status === "ready");

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === actionableInvoices.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(actionableInvoices.map((i) => i.id)));
  };
  const isAllSelected = actionableInvoices.length > 0 && selectedIds.size === actionableInvoices.length;
  const isSomeSelected = selectedIds.size > 0;

  // ─── Actions ────────────────────────────────────────────────────────

  const updateInvoice = (id: string, updates: Partial<UploadedInvoice>) => {
    setInvoices((prev) => prev.map((inv) => (inv.id === id ? { ...inv, ...updates } : inv)));
  };

  const removeInvoice = (id: string) => {
    setInvoices((prev) => prev.filter((inv) => inv.id !== id));
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
  };

  const bulkAssignCustomer = (customerId: string) => {
    setInvoices((prev) => prev.map((inv) => (selectedIds.has(inv.id) ? { ...inv, customerId } : inv)));
  };

  const buildPayload = (inv: UploadedInvoice) => ({
    invoiceNumber: inv.invoiceNumber,
    reference: inv.reference || undefined,
    invoicedDate: new Date(inv.invoicedDate || new Date()),
    paymentTerms: inv.paymentTerms,
    currency: inv.currency,
    customerId: inv.customerId || undefined,
    taxRate: inv.taxRate,
    notes: inv.notes || undefined,
    fileUrl: inv.fileDataUrl ?? undefined,
    items: inv.items.filter((i) => i.description).map((item, idx) => ({
      description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, amount: item.amount, sortOrder: idx,
    })),
  });

  const handleBulkSave = async () => {
    const toSave = invoices.filter((i) => selectedIds.has(i.id) && i.status === "ready");
    if (toSave.length === 0) { toast.error("Select extracted invoices to save"); return; }
    for (const inv of toSave) {
      if (!inv.invoiceNumber) { toast.error(`Missing invoice number for ${inv.fileName}`); continue; }
      updateInvoice(inv.id, { status: "saving" });
      try {
        await createInvoice.mutateAsync(buildPayload(inv));
        updateInvoice(inv.id, { status: "saved" });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Save failed";
        updateInvoice(inv.id, { status: "error", error: msg });
        toast.error(`${inv.invoiceNumber}: ${msg}`);
      }
    }
    setSelectedIds(new Set());
    toast.success(`${toSave.length} invoice(s) saved as draft`);
  };

  const handleBulkSend = async () => {
    const toSend = invoices.filter((i) => selectedIds.has(i.id) && i.status === "ready");
    if (toSend.length === 0) { toast.error("Select extracted invoices to send"); return; }
    for (const inv of toSend) {
      if (!inv.invoiceNumber) { toast.error(`Missing invoice number for ${inv.fileName}`); continue; }
      if (!inv.customerId) { toast.error(`No customer selected for ${inv.invoiceNumber}`); continue; }
      updateInvoice(inv.id, { status: "saving" });
      try {
        const created = await createInvoice.mutateAsync(buildPayload(inv));
        await sendInvoice.mutateAsync({ id: created.id });
        updateInvoice(inv.id, { status: "sent" });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Send failed";
        updateInvoice(inv.id, { status: "error", error: msg });
        toast.error(`${inv.invoiceNumber}: ${msg}`);
      }
    }
    setSelectedIds(new Set());
    toast.success(`${toSend.length} invoice(s) sent`);
  };

  const handleBulkRemove = () => {
    setInvoices((prev) => prev.filter((inv) => !selectedIds.has(inv.id)));
    setSelectedIds(new Set());
  };

  const hasInvoices = invoices.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* ─── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push("/invoices")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-base font-semibold">Upload Invoices</span>
          {invoices.length > 0 && (
            <Badge variant="secondary">{invoices.length} file{invoices.length !== 1 ? "s" : ""}</Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {hasInvoices && (
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add More Files
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            multiple
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
            className="hidden"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
        {/* ─── Upload Zone ─────────────────────────────────────────── */}
        {!hasInvoices && (
          <div className="mx-auto max-w-xl">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-colors ${
                dragOver ? "border-blue-400 bg-blue-50" : "border-gray-300 bg-white hover:border-gray-400"
              }`}
            >
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                <Upload className="h-8 w-8 text-gray-400" />
              </div>
              <p className="text-lg font-medium">Drop your invoices here</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Select multiple files — JPG, PNG, WebP, or PDF (max 20MB each)
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Files will be staged first. You can add more before extracting.
              </p>
              <label className="mt-4 cursor-pointer">
                <Button variant="outline" asChild>
                  <span>
                    <FileText className="mr-2 h-4 w-4" />
                    Select Files
                  </span>
                </Button>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  multiple
                  onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        )}

        {/* ─── Invoice Table ───────────────────────────────────────── */}
        {hasInvoices && (
          <div className="space-y-4">
            {/* Action bar / drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`flex items-center justify-between rounded-lg border px-4 py-2 transition-colors ${
                dragOver ? "border-blue-400 bg-blue-50" : "bg-white"
              }`}
            >
              {isSomeSelected ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{selectedIds.size} selected</span>
                  <div className="w-[180px]">
                    <CustomerPicker customers={customers} selectedId="" onSelect={bulkAssignCustomer} label="Assign customer..." />
                  </div>
                  <Button size="sm" variant="outline" onClick={handleBulkSave} disabled={false} className="border-green-300 text-green-700 hover:bg-green-50">
                    <Save className="mr-1.5 h-3.5 w-3.5" />Save Drafts
                  </Button>
                  <Button size="sm" onClick={handleBulkSend} disabled={false} className="bg-blue-600 hover:bg-blue-700">
                    <Send className="mr-1.5 h-3.5 w-3.5" />Send to Customer
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleBulkRemove} className="border-red-300 text-red-600 hover:bg-red-50">
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />Remove
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear</Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {dragOver ? "Drop files to add more..." : "Drop more files here, or select invoices for bulk actions"}
                </p>
              )}
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-lg border bg-white">
              <Table className="min-w-[800px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={isAllSelected} onCheckedChange={toggleSelectAll} />
                    </TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Invoice Date</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => {
                    const isSelected = selectedIds.has(inv.id);
                    const isActionable = inv.status === "ready";

                    return (
                      <TableRow key={inv.id} className={isSelected ? "bg-blue-50" : ""}>
                        <TableCell>
                          <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(inv.id)} disabled={!isActionable} />
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[180px]">
                            <p className="truncate text-sm font-medium">{inv.fileName}</p>
                            <p className="text-xs text-muted-foreground">{formatFileSize(inv.fileSize)}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          {isActionable ? (
                            <Input className="h-7 border-gray-200 text-sm" value={inv.invoiceNumber} onChange={(e) => updateInvoice(inv.id, { invoiceNumber: e.target.value })} placeholder="Invoice #" />
                          ) : (
                            <span className="text-sm font-medium">{inv.invoiceNumber || "—"}</span>
                          )}
                        </TableCell>
                        <TableCell className="min-w-[160px]">
                          {isActionable ? (
                            <CustomerPicker
                              customers={customers}
                              selectedId={inv.customerId}
                              onSelect={(id) => updateInvoice(inv.id, { customerId: id })}
                            />
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {isActionable ? (
                            <Input className="h-7 border-gray-200 text-sm" value={inv.reference} onChange={(e) => updateInvoice(inv.id, { reference: e.target.value })} placeholder="Ref" />
                          ) : (
                            <span className="text-sm text-muted-foreground">{inv.reference || "—"}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {isActionable ? (
                            <Input type="date" className="h-7 border-gray-200 text-sm" value={inv.invoicedDate} onChange={(e) => updateInvoice(inv.id, { invoicedDate: e.target.value })} />
                          ) : (
                            <span className="text-sm">{inv.invoicedDate ? dayjs(inv.invoicedDate).format("MMM D, YYYY") : "—"}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {isActionable ? (
                            <Input type="date" className="h-7 border-gray-200 text-sm" value={inv.dueDate} onChange={(e) => updateInvoice(inv.id, { dueDate: e.target.value })} />
                          ) : (
                            <span className="text-sm">{inv.dueDate ? dayjs(inv.dueDate).format("MMM D, YYYY") : "—"}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {isActionable ? (
                            <Input type="number" min={0} step={0.01} className="h-7 w-28 border-gray-200 text-right text-sm" value={inv.totalAmount} onChange={(e) => updateInvoice(inv.id, { totalAmount: parseFloat(e.target.value) || 0 })} />
                          ) : (
                            <span className="text-right font-medium tabular-nums">{inv.totalAmount > 0 ? formatCurrency(inv.totalAmount, inv.currency) : "—"}</span>
                          )}
                        </TableCell>
                        <TableCell><StatusBadge status={inv.status} /></TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-500" onClick={() => removeInvoice(inv.id)}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
