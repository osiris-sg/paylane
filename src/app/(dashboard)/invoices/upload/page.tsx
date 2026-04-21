"use client";

import { useState, useCallback, useRef, useEffect } from "react";
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
  Copy,
  RefreshCw,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { UserPlus } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type InvoiceStatus = "extracting" | "ready" | "error" | "saving" | "saved" | "sent";
type UploadResult = "created" | "duplicate" | "updated";
type ExistingInvoiceStatus = "DRAFT" | "SENT" | "PENDING_APPROVAL" | "PAID" | "CANCELLED";

interface UploadedInvoice {
  id: string;
  dbId?: string; // Set after auto-save as draft
  fileName: string;
  fileSize: number;
  file?: File;
  status: InvoiceStatus;
  uploadResult?: UploadResult;
  existingStatus?: ExistingInvoiceStatus | null;
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

import { formatCurrency } from "~/lib/currency";

// Module-level tracker so in-flight saves persist across component unmounts
// (e.g. user navigates away mid-save). The async save closures keep running
// in the browser; we use this set to drive a beforeunload warning so the user
// doesn't accidentally hard-close the tab and abort in-flight requests.
const inFlightSaves: Set<string> = new Set();
let beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;

function updateBeforeUnload() {
  if (typeof window === "undefined") return;
  if (inFlightSaves.size > 0 && !beforeUnloadHandler) {
    beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnloadHandler);
  } else if (inFlightSaves.size === 0 && beforeUnloadHandler) {
    window.removeEventListener("beforeunload", beforeUnloadHandler);
    beforeUnloadHandler = null;
  }
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
  onAddNew,
  label,
  warnWhenEmpty = true,
}: {
  customers: { id: string; name: string; company: string | null; email: string | null }[];
  selectedId: string;
  onSelect: (id: string) => void;
  onAddNew?: () => void;
  label?: string;
  warnWhenEmpty?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = customers.find((c) => c.id === selectedId);
  const filtered = customers.filter((c) => {
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.company ?? "").toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q);
  });

  const hasSelection = !!selected;
  const showWarning = !hasSelection && warnWhenEmpty;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`flex w-full items-center gap-1 rounded border px-2 py-1 text-left text-sm transition ${
            hasSelection
              ? "border-transparent hover:bg-gray-50"
              : showWarning
                ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                : "border-gray-200 hover:bg-gray-50"
          }`}
        >
          {selected ? (
            <span className="truncate font-medium">{selected.company || selected.name}</span>
          ) : showWarning ? (
            <>
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-600" />
              <span className="truncate font-medium">{label ?? "Assign customer"}</span>
            </>
          ) : (
            <span className="truncate text-muted-foreground">{label ?? "Assign customer..."}</span>
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
            filtered.map((c) => {
              const primary = c.company || c.name;
              const secondary = c.company ? c.name : null;
              return (
                <button key={c.id} onClick={() => { onSelect(c.id); setOpen(false); setSearch(""); }} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-100 ${c.id === selectedId ? "bg-blue-50" : ""}`}>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate text-left">{primary}</p>
                    {secondary && <p className="truncate text-left text-xs text-muted-foreground">{secondary}</p>}
                  </div>
                  {c.id === selectedId && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-blue-600" />}
                </button>
              );
            })
          )}
        </div>
        {onAddNew && (
          <div className="border-t p-1">
            <button
              onClick={() => { setOpen(false); setSearch(""); onAddNew(); }}
              className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm font-medium text-blue-600 hover:bg-blue-50"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Add Customer
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function existingStatusClasses(status: ExistingInvoiceStatus): string {
  switch (status) {
    case "DRAFT":
      return "bg-gray-100 text-gray-700 border-l border-gray-300";
    case "SENT":
      return "bg-blue-100 text-blue-800 border-l border-blue-300";
    case "PENDING_APPROVAL":
      return "bg-orange-100 text-orange-800 border-l border-orange-300";
    case "PAID":
      return "bg-green-100 text-green-800 border-l border-green-300";
    case "CANCELLED":
      return "bg-red-100 text-red-800 border-l border-red-300";
  }
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({
  status,
  hasDbId,
  uploadResult,
  existingStatus,
}: {
  status: InvoiceStatus;
  hasDbId?: boolean;
  uploadResult?: UploadResult;
  existingStatus?: ExistingInvoiceStatus | null;
}) {
  // When auto-saved and the server detected a duplicate, show a compound badge
  // with the duplicate marker + the invoice's current canonical status.
  if (status === "ready" && hasDbId && uploadResult === "duplicate") {
    return (
      <div className="inline-flex items-center overflow-hidden rounded-full border border-amber-300 bg-amber-50 text-[11px] font-semibold leading-none">
        <span className="flex items-center gap-1 px-2 py-1 text-amber-800">
          <Copy className="h-3 w-3" />
          DUPLICATE
        </span>
        {existingStatus && (
          <span className={`px-2 py-1 font-semibold ${existingStatusClasses(existingStatus)}`}>
            {existingStatus.replace("_", " ")}
          </span>
        )}
      </div>
    );
  }
  if (status === "ready" && hasDbId && uploadResult === "updated") {
    return (
      <div className="inline-flex items-center overflow-hidden rounded-full border border-purple-300 bg-purple-50 text-[11px] font-semibold leading-none">
        <span className="flex items-center gap-1 px-2 py-1 text-purple-700">
          <RefreshCw className="h-3 w-3" />
          UPDATED
        </span>
        {existingStatus && (
          <span className={`px-2 py-1 font-semibold ${existingStatusClasses(existingStatus)}`}>
            {existingStatus.replace("_", " ")}
          </span>
        )}
      </div>
    );
  }
  switch (status) {
    case "extracting":
      return <Badge variant="outline" className="gap-1 border-blue-300 bg-blue-50 text-blue-700"><Loader2 className="h-3 w-3 animate-spin" />Extracting</Badge>;
    case "ready":
      return hasDbId ? (
        <Badge variant="outline" className="gap-1 border-green-300 bg-green-50 text-green-700"><Check className="h-3 w-3" />Draft Saved</Badge>
      ) : (
        <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-700"><Loader2 className="h-3 w-3 animate-spin" />Saving…</Badge>
      );
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

  const utils = api.useUtils();

  const { data: customersData, refetch: refetchCustomers } = api.customer.list.useQuery({ limit: 100 });
  const customers = customersData?.customers ?? [];

  const invalidateInvoices = () => {
    void utils.invoice.list.invalidate();
  };

  const createInvoice = api.invoice.create.useMutation({ onSuccess: invalidateInvoices });
  const upsertInvoice = api.invoice.upsertFromUpload.useMutation({ onSuccess: invalidateInvoices });
  const updateInvoiceMut = api.invoice.update.useMutation({ onSuccess: invalidateInvoices });
  const deleteInvoice = api.invoice.delete.useMutation({ onSuccess: invalidateInvoices });
  const sendInvoice = api.invoice.send.useMutation({ onSuccess: invalidateInvoices });
  const createCustomer = api.customer.create.useMutation();

  // Add-customer dialog state
  const [addCustomerFor, setAddCustomerFor] = useState<string | null>(null); // invoice id or "bulk"
  const [newCust, setNewCust] = useState({ name: "", email: "", phone: "", company: "", address: "" });

  const resetNewCust = () => setNewCust({ name: "", email: "", phone: "", company: "", address: "" });

  const openAddCustomer = (forId: string, prefill?: { name?: string; email?: string }) => {
    resetNewCust();
    if (prefill) {
      // AI usually extracts the company/bill-to name — prefill that as the company
      setNewCust((p) => ({ ...p, company: prefill.name ?? "", email: prefill.email ?? "" }));
    }
    setAddCustomerFor(forId);
  };

  const handleCreateCustomer = async () => {
    if (!newCust.company.trim()) { toast.error("Company name is required"); return; }
    try {
      const created = await createCustomer.mutateAsync({
        company: newCust.company.trim(),
        name: newCust.name.trim() || undefined,
        email: newCust.email.trim() || undefined,
        phone: newCust.phone.trim() || undefined,
        address: newCust.address.trim() || undefined,
      });
      await refetchCustomers();
      toast.success("Customer added");
      // Auto-assign to the triggering invoice (or all selected if bulk)
      if (addCustomerFor === "bulk") {
        setInvoices((prev) => prev.map((inv) => (selectedIds.has(inv.id) ? { ...inv, customerId: created.id } : inv)));
      } else if (addCustomerFor) {
        updateInvoice(addCustomerFor, { customerId: created.id });
      }
      setAddCustomerFor(null);
      resetNewCust();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to add customer";
      toast.error(msg);
    }
  };

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

      const invoiceNumber = data.invoiceNumber || `DRAFT-${id}`;
      const invoicedDate = data.invoicedDate || dayjs().format("YYYY-MM-DD");
      const paymentTerms = data.paymentTerms ?? 30;
      const currency = data.currency ?? "SGD";
      const taxRate = data.taxRate ?? 9;

      setInvoices((prev) =>
        prev.map((x) =>
          x.id === id
            ? {
                ...x,
                status: "ready" as const,
                fileDataUrl,
                invoiceNumber,
                customerName: data.customerName ?? "",
                customerEmail: data.customerEmail ?? "",
                reference: data.reference ?? "",
                invoicedDate,
                dueDate: data.dueDate ?? "",
                paymentTerms,
                currency,
                taxRate,
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

      // Auto-save as DRAFT (or detect duplicate / override existing draft).
      // If the extracted invoice number already belongs to a SENT/PAID invoice,
      // we retry with a disambiguated suffix so the draft still gets saved.
      const tryUpsert = async (numberToUse: string) => {
        return upsertInvoice.mutateAsync({
          invoiceNumber: numberToUse,
          reference: data.reference || undefined,
          invoicedDate: new Date(invoicedDate),
          paymentTerms,
          currency,
          customerId: matchedCustomerId || undefined,
          extractedCustomerName: data.customerName || undefined,
          taxRate,
          notes: data.notes || undefined,
          fileUrl: fileDataUrl,
          items: (data.items ?? []).filter((i: { description?: string }) => i.description).map((item: { description: string; quantity: number; unitPrice: number; amount: number }, idx: number) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
            sortOrder: idx,
          })),
          totalAmount: total,
          subtotal: sub,
          taxAmount: taxAmt,
        });
      };

      inFlightSaves.add(id);
      updateBeforeUnload();
      try {
        const result = await tryUpsert(invoiceNumber);
        setInvoices((prev) =>
          prev.map((x) =>
            x.id === id
              ? {
                  ...x,
                  dbId: result.invoice.id,
                  uploadResult: result.status,
                  existingStatus: result.existingStatus as ExistingInvoiceStatus | null,
                  // For duplicates/overrides, hydrate local state from the saved invoice
                  // so the read-only row reflects what's actually in the DB.
                  customerId: result.invoice.customerId ?? x.customerId,
                }
              : x,
          ),
        );
        if (result.status === "duplicate") {
          const label = result.existingStatus ? ` (${result.existingStatus})` : "";
          toast.info(`${invoiceNumber} already exists${label}`);
        } else if (result.status === "updated") {
          const raw = (result as { diffFields?: { field: string }[] }).diffFields ?? [];
          const labelMap: Record<string, string> = {
            amount: "amount",
            subtotal: "subtotal",
            taxAmount: "tax amount",
            taxRate: "tax rate",
            currency: "currency",
            customer: "customer",
            reference: "reference",
            notes: "notes",
            paymentTerms: "payment terms",
            invoicedDate: "invoice date",
            items: "line items",
          };
          const diffs = raw.map((d) => labelMap[d.field] ?? d.field).join(", ");
          console.log(`[upload] ${invoiceNumber} overrode existing invoice. Diff fields:`, raw);
          toast.success(`${invoiceNumber} updated${diffs ? ` — changed: ${diffs}` : ""}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Auto-save failed";
        console.error("Auto-save draft failed:", err);
        toast.error(`Auto-save failed: ${msg}`);
        setInvoices((prev) => prev.map((x) => (x.id === id ? { ...x, status: "error" as const, error: msg } : x)));
      } finally {
        inFlightSaves.delete(id);
        updateBeforeUnload();
      }
    } catch (error) {
      setInvoices((prev) =>
        prev.map((x) => (x.id === id ? { ...x, status: "error" as const, error: String(error), fileDataUrl } : x)),
      );
    }
  };

  // ─── Hydrate from Statement of Account import ─────────────────────────
  // When /invoices/import-statement redirects here, it stores the extracted
  // statement in sessionStorage. We read it once, match/create the customer,
  // then stage one row per invoice and auto-save each as a draft.

  const hydrateFromStatement = async (payload: {
    extraction: {
      customer: { company: string; name?: string | null; email?: string | null };
      currency: string;
      invoices: { invoiceNumber: string; invoicedDate: string; amount: number; description?: string | null; xReference?: string | null }[];
    };
    fileDataUrl: string;
    fileName: string;
  }) => {
    const { extraction, fileDataUrl, fileName } = payload;

    // Match or create the customer once so every staged invoice shares it.
    // Normalise aggressively so "PT. ASIANFAST MARINE INDUSTRIES" matches
    // "Asianfast Marine Industries Pte Ltd" etc.
    const normaliseCompany = (raw: string) =>
      raw
        .toLowerCase()
        .replace(/\b(pt\.?|pte\.?|ltd\.?|limited|corp\.?|corporation|inc\.?|llc|co\.?|company|gmbh|sdn|bhd|private)\b/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    let customerId = "";
    const needleRaw = extraction.customer.company.trim();
    const needle = normaliseCompany(needleRaw);
    const match = customers.find((c) => {
      const company = normaliseCompany(c.company ?? "");
      const name = normaliseCompany(c.name);
      if (!needle) return false;
      return (
        (company && (company === needle || company.includes(needle) || needle.includes(company))) ||
        (name && (name === needle || name.includes(needle) || needle.includes(name)))
      );
    });
    console.log("[statement] customer match attempt:", {
      needleRaw,
      normalisedNeedle: needle,
      candidates: customers.map((c) => ({ id: c.id, company: c.company, name: c.name })),
      match: match ? { id: match.id, company: match.company, name: match.name } : null,
    });

    if (match) {
      customerId = match.id;
      toast.success(`Matched existing customer: ${match.company || match.name}`);
    } else {
      try {
        const created = await createCustomer.mutateAsync({
          company: extraction.customer.company.trim(),
          name: extraction.customer.name?.trim() || undefined,
          email: extraction.customer.email?.trim() || undefined,
        });
        customerId = created.id;
        await refetchCustomers();
        toast.success(`New customer created: ${extraction.customer.company}`);
      } catch (err) {
        console.error("Failed to create statement customer:", err);
        toast.error(`Could not create customer "${extraction.customer.company}" — you can assign one manually`);
      }
    }

    // Stage each extracted invoice as a ready row (skip re-extraction)
    const paymentTerms = 30;
    const currency = extraction.currency || "SGD";
    const newEntries: UploadedInvoice[] = extraction.invoices.map((inv, idx) => {
      const id = `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`;
      const invoicedDate = inv.invoicedDate || dayjs().format("YYYY-MM-DD");
      const dueDate = dayjs(invoicedDate).add(paymentTerms, "day").format("YYYY-MM-DD");
      const amount = Number(inv.amount) || 0;
      return {
        id,
        fileName: `${fileName} — ${inv.invoiceNumber}`,
        fileSize: 0,
        status: "ready",
        invoiceNumber: inv.invoiceNumber,
        customerName: extraction.customer.company,
        customerEmail: extraction.customer.email ?? "",
        reference: inv.xReference ?? "",
        invoicedDate,
        dueDate,
        paymentTerms,
        currency,
        taxRate: 0,
        totalAmount: amount,
        subtotal: amount,
        taxAmount: 0,
        notes: inv.description ?? "",
        items: [
          {
            description: inv.description || `Invoice ${inv.invoiceNumber}`,
            quantity: 1,
            unitPrice: amount,
            amount,
          },
        ],
        customerId,
        fileDataUrl,
      };
    });

    setInvoices(newEntries);

    // Save everything in parallel via upsertFromUpload. tRPC queues requests
    // over the same HTTP/2 connection so this scales to ~50+ invoices fine.
    // Each save is independent — if the user navigates away, the in-flight
    // requests still complete against the server even though this component
    // has unmounted (JS doesn't stop an async closure just because React did).
    await Promise.allSettled(
      newEntries.map(async (entry) => {
        inFlightSaves.add(entry.id);
        updateBeforeUnload();
        try {
          const result = await upsertInvoice.mutateAsync({
            invoiceNumber: entry.invoiceNumber,
            invoicedDate: new Date(entry.invoicedDate),
            paymentTerms: entry.paymentTerms,
            currency: entry.currency,
            customerId: customerId || undefined,
            extractedCustomerName: extraction.customer.company || undefined,
            taxRate: entry.taxRate,
            notes: entry.notes || undefined,
            fileUrl: entry.fileDataUrl ?? undefined,
            items: entry.items.map((item, i) => ({
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              amount: item.amount,
              sortOrder: i,
            })),
            totalAmount: entry.totalAmount,
            subtotal: entry.subtotal,
            taxAmount: entry.taxAmount,
          });
          setInvoices((prev) =>
            prev.map((x) =>
              x.id === entry.id
                ? { ...x, dbId: result.invoice.id, uploadResult: result.status, existingStatus: result.existingStatus as ExistingInvoiceStatus | null }
                : x,
            ),
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Auto-save failed";
          setInvoices((prev) => prev.map((x) => (x.id === entry.id ? { ...x, status: "error", error: msg } : x)));
        } finally {
          inFlightSaves.delete(entry.id);
          updateBeforeUnload();
        }
      }),
    );
  };

  // Consume the pending statement payload on mount (once customers have loaded)
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    if (!customersData) return;
    const stored = typeof window !== "undefined" ? sessionStorage.getItem("paylane:pending-statement") : null;
    if (!stored) return;
    hydratedRef.current = true;
    sessionStorage.removeItem("paylane:pending-statement");
    try {
      const payload = JSON.parse(stored);
      void hydrateFromStatement(payload);
    } catch (err) {
      console.error("Failed to parse pending statement payload:", err);
      toast.error("Couldn't load the imported statement");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customersData]);

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
    const inv = invoices.find((x) => x.id === id);
    if (inv?.dbId) {
      // Also delete the auto-saved draft from the DB so it doesn't linger
      deleteInvoice.mutate({ id: inv.dbId });
    }
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
    totalAmount: inv.totalAmount,
    subtotal: inv.subtotal,
    taxAmount: inv.taxAmount,
  });

  // Persist latest local edits to the already-saved draft
  const persistEdits = async (inv: UploadedInvoice) => {
    if (!inv.dbId) {
      // Fallback: create if auto-save didn't happen
      const created = await createInvoice.mutateAsync(buildPayload(inv));
      return created.id;
    }
    await updateInvoiceMut.mutateAsync({
      id: inv.dbId,
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
    return inv.dbId;
  };

  const handleBulkSave = async () => {
    const toSave = invoices.filter((i) => selectedIds.has(i.id) && i.status === "ready");
    if (toSave.length === 0) { toast.error("Select extracted invoices to save"); return; }
    for (const inv of toSave) {
      if (!inv.invoiceNumber) { toast.error(`Missing invoice number for ${inv.fileName}`); continue; }
      updateInvoice(inv.id, { status: "saving" });
      try {
        await persistEdits(inv);
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
        const persistedId = await persistEdits(inv);
        await sendInvoice.mutateAsync({ id: persistedId });
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
    // Delete any auto-saved drafts from DB too
    invoices.forEach((inv) => {
      if (selectedIds.has(inv.id) && inv.dbId) {
        deleteInvoice.mutate({ id: inv.dbId });
      }
    });
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
                  {(() => {
                    const selectedInvoices = invoices.filter((i) => selectedIds.has(i.id));
                    const anyMissing = selectedInvoices.some((i) => !i.customerId);
                    const assignedIds = selectedInvoices.map((i) => i.customerId).filter(Boolean);
                    const distinctCustomerIds = Array.from(new Set(assignedIds));
                    const sharedCustomerId = distinctCustomerIds.length === 1 ? (distinctCustomerIds[0] ?? "") : "";
                    const label = anyMissing
                      ? "Assign customer..."
                      : distinctCustomerIds.length > 1
                        ? "Change customer (mixed)..."
                        : "Change customer...";
                    return (
                      <div className="w-[200px]">
                        <CustomerPicker
                          customers={customers}
                          selectedId={sharedCustomerId}
                          onSelect={bulkAssignCustomer}
                          onAddNew={() => openAddCustomer("bulk")}
                          label={label}
                          warnWhenEmpty={anyMissing}
                        />
                      </div>
                    );
                  })()}
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
                    <TableHead className="w-[180px]">File</TableHead>
                    <TableHead className="min-w-[160px]">Invoice #</TableHead>
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
                    const isDuplicate = inv.uploadResult === "duplicate";
                    const isActionable = inv.status === "ready" && !isDuplicate;
                    const customer = customers.find((c) => c.id === inv.customerId);
                    const customerLabel = customer ? customer.company || customer.name : null;

                    return (
                      <TableRow key={inv.id} className={isSelected ? "bg-blue-50" : isDuplicate ? "bg-amber-50/40" : ""}>
                        <TableCell>
                          <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(inv.id)} disabled={!isActionable} />
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[180px]">
                            <p className="truncate text-sm font-medium">{inv.fileName}</p>
                            <p className="text-xs text-muted-foreground">{formatFileSize(inv.fileSize)}</p>
                          </div>
                        </TableCell>
                        <TableCell className="min-w-[160px]">
                          {isActionable ? (
                            <Input className="h-7 border-gray-200 text-sm" value={inv.invoiceNumber} onChange={(e) => updateInvoice(inv.id, { invoiceNumber: e.target.value })} placeholder="Invoice #" />
                          ) : (
                            <span className="whitespace-nowrap text-sm font-medium">{inv.invoiceNumber || "—"}</span>
                          )}
                        </TableCell>
                        <TableCell className="min-w-[160px]">
                          {isActionable ? (
                            <CustomerPicker
                              customers={customers}
                              selectedId={inv.customerId}
                              onSelect={(id) => updateInvoice(inv.id, { customerId: id })}
                              onAddNew={() => openAddCustomer(inv.id, { name: inv.customerName, email: inv.customerEmail })}
                            />
                          ) : (
                            <span className="text-sm font-medium">{customerLabel ?? "—"}</span>
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
                            <Input
                              type="text"
                              inputMode="decimal"
                              className="h-7 w-28 border-gray-200 text-right text-sm"
                              value={inv.totalAmount > 0 ? inv.totalAmount.toFixed(2) : ""}
                              onChange={(e) => {
                                const raw = e.target.value.replace(/[^\d.]/g, "");
                                const num = parseFloat(raw);
                                updateInvoice(inv.id, { totalAmount: isNaN(num) ? 0 : num });
                              }}
                            />
                          ) : (
                            <span className="text-right font-medium tabular-nums">{inv.totalAmount > 0 ? formatCurrency(inv.totalAmount, inv.currency) : "—"}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={inv.status} hasDbId={!!inv.dbId} uploadResult={inv.uploadResult} existingStatus={inv.existingStatus} />
                        </TableCell>
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

      {/* Add Customer Dialog */}
      <Dialog open={!!addCustomerFor} onOpenChange={(open) => { if (!open) { setAddCustomerFor(null); resetNewCust(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a new customer</DialogTitle>
            <DialogDescription>
              This customer will be saved to your account and auto-assigned to{" "}
              {addCustomerFor === "bulk" ? "the selected invoices" : "this invoice"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cust-company">
                Company <span className="text-red-600">*</span>
              </Label>
              <Input id="cust-company" value={newCust.company} onChange={(e) => setNewCust({ ...newCust, company: e.target.value })} placeholder="Acme Pte Ltd" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cust-name">Contact Name</Label>
              <Input id="cust-name" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} placeholder="John Doe" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cust-email">Email</Label>
              <Input id="cust-email" type="email" value={newCust.email} onChange={(e) => setNewCust({ ...newCust, email: e.target.value })} placeholder="john@acme.com" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cust-phone">Phone</Label>
              <Input id="cust-phone" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} placeholder="+65 1234 5678" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cust-address">Address</Label>
              <Input id="cust-address" value={newCust.address} onChange={(e) => setNewCust({ ...newCust, address: e.target.value })} placeholder="123 Example St, Singapore" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setAddCustomerFor(null); resetNewCust(); }}>Cancel</Button>
            <Button onClick={handleCreateCustomer} disabled={createCustomer.isPending || !newCust.company.trim()}>
              {createCustomer.isPending ? "Saving..." : "Add Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
