"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Upload,
  FileText,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Sparkles,
  Send,
  UserPlus,
} from "lucide-react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { COMMON_CURRENCIES } from "~/lib/currency";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { api } from "~/trpc/react";
import { SendAccessGuard } from "~/components/subscription/send-access-guard";
import { cn } from "~/lib/utils";
import { uploadViaPresignedPut } from "~/lib/upload-file";

type Row = {
  id: string;
  file: File;
  fileName: string;
  fileType: string;
  fileKey: string | null;
  status:
    | "queued"
    | "extracting"
    | "matched"
    | "no_match"
    | "sending"
    | "sent"
    | "error";
  extractedName: string | null;
  extractedEmail: string | null;
  extractedCurrency: string; // ISO code; defaults to SGD when not on the document
  confidence: "high" | "medium" | "low" | null;
  customerId: string | null; // null = unmatched / unselected
  autoCreated?: boolean; // customer was created from this statement
  errorMessage?: string;
};

type CustomerOption = { id: string; company: string | null; name: string; currency: string };

const normName = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** Customer identity is (name, currency) — see customer router. */
const customerKey = (name: string, currency: string) => `${normName(name)}|${currency}`;

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];
const MAX_BYTES = 8 * 1024 * 1024;

function newRowId() {
  return Math.random().toString(36).slice(2, 11);
}

/**
 * Best-match a customer using a fuzzy alphanumeric overlap heuristic, within
 * the statement's currency — the same business in another currency is a
 * different customer record and must not be matched.
 */
function matchCustomer(
  extracted: string | null,
  customers: CustomerOption[],
  currency: string,
): { id: string; confidence: "exact" | "fuzzy" } | null {
  if (!extracted) return null;
  const norm = normName;
  const target = norm(extracted);
  if (!target) return null;
  const pool = customers.filter((c) => c.currency === currency);

  const exact = pool.find(
    (c) => norm(c.company) === target || norm(c.name) === target,
  );
  if (exact) return { id: exact.id, confidence: "exact" };

  // Substring containment with length floor for stability.
  const fuzzy = pool.find((c) => {
    const co = norm(c.company);
    const na = norm(c.name);
    return (
      (co && (co.includes(target) || target.includes(co))) ||
      (na && (na.includes(target) || target.includes(na)))
    );
  });
  return fuzzy ? { id: fuzzy.id, confidence: "fuzzy" } : null;
}

export default function SendStatementsBulkPage() {
  return (
    <SendAccessGuard
      title="Send Statements"
      lockedTitle="Bulk sending statements is locked"
      lockedBody="Start your free 14-day trial to send statements of account to your customers."
      expiredMessage="Your free trial has ended. Upgrade to send statements again."
    >
      <BulkInner />
    </SendAccessGuard>
  );
}

function BulkInner() {
  const utils = api.useUtils();
  const [rows, setRows] = useState<Row[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const customers = api.customer.list.useQuery({ page: 1, limit: 100 });
  const customerOptions = useMemo<CustomerOption[]>(
    () =>
      (customers.data?.customers ?? []).map((c) => ({
        id: c.id,
        company: c.company,
        name: c.name,
        currency: c.currency,
      })),
    [customers.data],
  );

  const bulkSend = api.statement.bulkSend.useMutation();
  const createUploadUrl = api.storage.createUploadUrl.useMutation();
  const createCustomer = api.customer.create.useMutation();

  // Create-or-reuse a customer for an unrecognised statement, without ever
  // duplicating. Three guards, innermost first:
  //   1. the server rejects a same-name+currency customer (409 CONFLICT) —
  //      on conflict we refetch and adopt the existing record;
  //   2. concurrent rows in one batch (extractions run in parallel) share ONE
  //      in-flight create per (name, currency) via `pendingCreates`;
  //   3. anything created is refetched into `customerOptions`, so later rows
  //      match it instead of creating again.
  const pendingCreates = useRef(new Map<string, Promise<string>>());
  const createOrReuseCustomer = async (input: {
    company: string;
    email?: string;
    phone?: string;
    currency: string;
  }): Promise<string> => {
    const key = customerKey(input.company, input.currency);
    const inFlight = pendingCreates.current.get(key);
    if (inFlight) return inFlight;

    const run = (async () => {
      try {
        const created = await createCustomer.mutateAsync({
          company: input.company.trim(),
          email: input.email?.trim() || undefined,
          phone: input.phone?.trim() || undefined,
          currency: input.currency,
        });
        await customers.refetch();
        return created.id;
      } catch (err) {
        // Already exists (created moments ago, or a case/spacing variant the
        // fuzzy matcher missed) → use it rather than fail.
        const isConflict =
          typeof err === "object" && err !== null &&
          (err as { data?: { code?: string } }).data?.code === "CONFLICT";
        if (!isConflict) throw err;
        const fresh = await customers.refetch();
        const existing = (fresh.data?.customers ?? []).find(
          (c) => c.currency === input.currency && customerKey(c.company ?? c.name, c.currency) === key,
        );
        if (!existing) throw err;
        return existing.id;
      } finally {
        pendingCreates.current.delete(key);
      }
    })();
    pendingCreates.current.set(key, run);
    return run;
  };

  // Manual create dialog for rows whose statement had no email/phone (the
  // customer router requires one so the customer is reachable).
  const [createFor, setCreateFor] = useState<Row | null>(null);
  const [createForm, setCreateForm] = useState({ company: "", email: "", phone: "", currency: "SGD" });
  const openCreateFor = (row: Row) => {
    setCreateForm({
      company: row.extractedName ?? "",
      email: row.extractedEmail ?? "",
      phone: "",
      currency: row.extractedCurrency,
    });
    setCreateFor(row);
  };
  const submitCreate = async () => {
    if (!createFor) return;
    if (!createForm.company.trim()) { toast.error("Company name is required"); return; }
    if (!createForm.email.trim() && !createForm.phone.trim()) {
      toast.error("Add an email or phone so the customer can be reached");
      return;
    }
    try {
      const id = await createOrReuseCustomer(createForm);
      updateRow(createFor.id, { customerId: id, status: "matched", autoCreated: true });
      toast.success(`Customer "${createForm.company.trim()}" created and assigned`);
      setCreateFor(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create customer");
    }
  };

  const updateRow = (id: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const removeRow = (id: string) =>
    setRows((prev) => prev.filter((r) => r.id !== id));

  const acceptFiles = async (files: FileList | File[]) => {
    const incoming = Array.from(files);
    const valid = incoming.filter(
      (f) => ACCEPTED_TYPES.includes(f.type) && f.size <= MAX_BYTES,
    );
    const rejected = incoming.length - valid.length;
    if (rejected) {
      toast.error(`${rejected} file(s) skipped — wrong type or over 8 MB.`);
    }

    const newRows: Row[] = valid.map((f) => ({
      id: newRowId(),
      file: f,
      fileName: f.name,
      fileType: f.type,
      fileKey: null,
      status: "extracting",
      extractedName: null,
      extractedEmail: null,
      extractedCurrency: "SGD",
      confidence: null,
      customerId: null,
    }));
    setRows((prev) => [...prev, ...newRows]);

    // Run extractions in parallel.
    await Promise.all(
      newRows.map(async (row) => {
        try {
          const fileKey = await uploadViaPresignedPut(row.file, "statements", (input) =>
            createUploadUrl.mutateAsync(input),
          );
          updateRow(row.id, { fileKey });

          const fd = new FormData();
          fd.append("file", row.file);
          const res = await fetch("/api/extract-soa", {
            method: "POST",
            body: fd,
          });
          const body = (await res.json().catch(() => ({}))) as {
            extraction?: {
              customerName?: string | null;
              customerEmail?: string | null;
              currency?: string | null;
              confidence?: "high" | "medium" | "low" | null;
            };
            error?: string;
          };
          if (!res.ok) throw new Error(body.error || "Extract failed");

          const extractedName = body.extraction?.customerName ?? null;
          const extractedEmail = body.extraction?.customerEmail ?? null;
          const rawCur = (body.extraction?.currency ?? "").trim().toUpperCase();
          const extractedCurrency = /^[A-Z]{3}$/.test(rawCur) ? rawCur : "SGD";
          const match = matchCustomer(extractedName, customerOptions, extractedCurrency);

          updateRow(row.id, {
            extractedName,
            extractedEmail,
            extractedCurrency,
            confidence: body.extraction?.confidence ?? null,
            customerId: match?.id ?? null,
            status: match ? "matched" : "no_match",
          });

          // Not one of ours yet → create it automatically when the statement
          // gives us a way to reach them (email). Without an email/phone the
          // row offers a one-click "Create customer" instead, since the
          // customer router requires a contact channel.
          if (!match && extractedName && extractedEmail) {
            try {
              const id = await createOrReuseCustomer({
                company: extractedName,
                email: extractedEmail,
                currency: extractedCurrency,
              });
              updateRow(row.id, { customerId: id, status: "matched", autoCreated: true });
              toast.success(`New customer "${extractedName}" created from ${row.fileName}`);
            } catch (err) {
              console.error("Auto-create customer failed:", err);
              // Leave the row unmatched; the user can create/pick manually.
            }
          }
        } catch (err) {
          updateRow(row.id, {
            status: "error",
            errorMessage:
              err instanceof Error ? err.message : "Extraction failed",
          });
        }
      }),
    );
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) void acceptFiles(e.dataTransfer.files);
  };

  const readyRows = rows.filter(
    (r) => r.fileKey && r.customerId && r.status !== "sent",
  );
  const allMatched = rows.length > 0 && rows.every((r) => r.customerId);

  const handleSendAll = async () => {
    const items = readyRows.map((r) => ({
      customerId: r.customerId!,
      fileDataUrl: r.fileKey!,
      fileName: r.fileName,
      fileType: r.fileType,
    }));
    if (!items.length) {
      toast.error("No rows are ready to send.");
      return;
    }

    // Optimistically mark sending.
    setRows((prev) =>
      prev.map((r) =>
        readyRows.some((rr) => rr.id === r.id) ? { ...r, status: "sending" } : r,
      ),
    );

    try {
      const res = await bulkSend.mutateAsync({ items });
      // Reconcile per-row results.
      const customerIdToResult = new Map(
        res.results.map((r) => [r.customerId, r]),
      );
      setRows((prev) =>
        prev.map((row) => {
          if (!row.customerId) return row;
          const r = customerIdToResult.get(row.customerId);
          if (!r) return row;
          if (r.status === "sent")
            return { ...row, status: "sent" as const };
          return {
            ...row,
            status: "error" as const,
            errorMessage: r.message,
          };
        }),
      );
      const sentCount = res.results.filter((r) => r.status === "sent").length;
      toast.success(`Sent ${sentCount} statement(s)`);
      void utils.statement.getForCustomer.invalidate();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Bulk send failed",
      );
      setRows((prev) =>
        prev.map((r) => (r.status === "sending" ? { ...r, status: "matched" } : r)),
      );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-3">
          <Link href="/customers">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Customers
          </Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
          <Sparkles className="h-6 w-6 text-blue-600" />
          Upload statements
        </h1>
        <p className="text-sm text-muted-foreground">
          Drop in your SOA files. We&apos;ll read each one and try to match it
          to the right customer. Review and send.
        </p>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-12 text-center transition-colors",
          dragOver
            ? "border-blue-400 bg-blue-50"
            : "border-gray-200 bg-gray-50 hover:border-blue-300 hover:bg-blue-50/40",
        )}
      >
        <input
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && void acceptFiles(e.target.files)}
        />
        <Upload className="h-7 w-7 text-gray-400" />
        <p className="text-sm font-medium">Drop files here or click to upload</p>
        <p className="text-xs text-muted-foreground">
          PDF or image, up to 8 MB each
        </p>
      </label>

      {rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {rows.map((row) => (
                <RowView
                  key={row.id}
                  row={row}
                  customers={customerOptions}
                  onChangeCustomer={(id) =>
                    updateRow(row.id, {
                      customerId: id,
                      status: id ? "matched" : "no_match",
                    })
                  }
                  onCreateCustomer={() => openCreateFor(row)}
                  onRemove={() => removeRow(row.id)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {allMatched
              ? "All files matched. Ready to send."
              : "Resolve any unmatched rows before sending."}
          </p>
          <Button
            onClick={handleSendAll}
            disabled={!readyRows.length || bulkSend.isPending}
          >
            {bulkSend.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send {readyRows.length} statement{readyRows.length === 1 ? "" : "s"}
              </>
            )}
          </Button>
        </div>
      )}

      <Dialog open={!!createFor} onOpenChange={(o) => { if (!o) setCreateFor(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create customer</DialogTitle>
            <DialogDescription>
              This statement is for a customer you don&apos;t have yet. Add an email or
              phone so they can be reached, and we&apos;ll assign the statement to them.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="bulk-cust-company">Company <span className="text-red-600">*</span></Label>
              <Input id="bulk-cust-company" value={createForm.company} onChange={(e) => setCreateForm({ ...createForm, company: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bulk-cust-currency">Currency <span className="text-red-600">*</span></Label>
              <Select value={createForm.currency} onValueChange={(v) => setCreateForm({ ...createForm, currency: v })}>
                <SelectTrigger id="bulk-cust-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMMON_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bulk-cust-email">Email</Label>
              <Input id="bulk-cust-email" type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} placeholder="accounts@acme.com" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bulk-cust-phone">Phone</Label>
              <Input id="bulk-cust-phone" value={createForm.phone} onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })} placeholder="+65 1234 5678" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateFor(null)}>Cancel</Button>
            <Button
              onClick={submitCreate}
              disabled={createCustomer.isPending || !createForm.company.trim() || (!createForm.email.trim() && !createForm.phone.trim())}
            >
              {createCustomer.isPending ? "Creating…" : "Create & assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RowView({
  row,
  customers,
  onChangeCustomer,
  onCreateCustomer,
  onRemove,
}: {
  row: Row;
  customers: CustomerOption[];
  onChangeCustomer: (id: string | null) => void;
  onCreateCustomer: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{row.fileName}</p>
          {row.status === "extracting" && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Reading…
            </p>
          )}
          {row.status !== "extracting" && row.extractedName && (
            <p className="text-xs text-muted-foreground">
              Detected: <span className="font-mono">{row.extractedName}</span>
              {row.confidence && (
                <span
                  className={cn(
                    "ml-1.5 rounded px-1 py-0.5 text-[10px] uppercase",
                    row.confidence === "high"
                      ? "bg-emerald-50 text-emerald-700"
                      : row.confidence === "medium"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-rose-50 text-rose-700",
                  )}
                >
                  {row.confidence}
                </span>
              )}
            </p>
          )}
          {row.status === "no_match" && !row.extractedName && (
            <p className="text-xs text-amber-700">
              Couldn&apos;t read a customer name — pick one manually.
            </p>
          )}
          {row.status === "no_match" && row.extractedName && (
            <p className="text-xs text-amber-700">
              Not in your customers ({row.extractedCurrency}) — pick one, or{" "}
              <button
                type="button"
                onClick={onCreateCustomer}
                className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline"
              >
                <UserPlus className="h-3 w-3" />
                create customer
              </button>
              .
            </p>
          )}
          {row.autoCreated && row.status !== "sent" && (
            <p className="text-xs text-emerald-700">New customer created from this statement.</p>
          )}
          {row.status === "error" && (
            <p className="flex items-center gap-1 text-xs text-rose-700">
              <AlertCircle className="h-3 w-3" />
              {row.errorMessage}
            </p>
          )}
          {row.status === "sent" && (
            <p className="flex items-center gap-1 text-xs text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              Sent
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Select
          value={row.customerId ?? "_none"}
          onValueChange={(v) => onChangeCustomer(v === "_none" ? null : v)}
          disabled={row.status === "extracting" || row.status === "sending" || row.status === "sent"}
        >
          <SelectTrigger className="h-8 w-[220px]">
            <SelectValue placeholder="Pick customer…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_none">
              <span className="text-muted-foreground">Unmatched</span>
            </SelectItem>
            {customers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.company || c.name}
                <span className="ml-1 text-xs text-muted-foreground">· {c.currency}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {row.status !== "sent" && row.status !== "sending" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onRemove}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
