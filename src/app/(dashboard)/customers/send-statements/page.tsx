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
          // Match against a fresh list, not the one captured when the file was
          // dropped — dropping before the customer list finished loading used
          // to match against an empty list and report everything unmatched.
          const freshList = await utils.customer.list.fetch({ page: 1, limit: 100 });
          const freshOptions: CustomerOption[] = (freshList.customers ?? []).map((c) => ({
            id: c.id, company: c.company, name: c.name, currency: c.currency,
          }));
          const match = matchCustomer(extractedName, freshOptions, extractedCurrency);

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

  // ── Progress summary for the stepper / footer ──────────────────────────
  const counts = {
    reading: rows.filter((r) => r.status === "extracting" || r.status === "queued").length,
    matched: rows.filter((r) => r.customerId && r.status !== "sent" && r.status !== "sending").length,
    attention: rows.filter((r) => !r.customerId && r.status !== "extracting" && r.status !== "queued" && r.status !== "sent").length,
    sent: rows.filter((r) => r.status === "sent").length,
    sending: rows.filter((r) => r.status === "sending").length,
  };
  const step: 1 | 2 | 3 =
    rows.length === 0 ? 1 : counts.sent === rows.length ? 3 : 2;

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
          One PDF per customer. We read who each statement is for, match it to your
          customers, and you confirm before anything is sent.
        </p>
      </div>

      {/* ── Stepper ── */}
      <ol className="grid grid-cols-3 gap-2 text-sm">
        {[
          { n: 1, title: "Upload", body: "Drop one statement file per customer" },
          { n: 2, title: "Review", body: "Check each file matched the right customer" },
          { n: 3, title: "Send", body: "Each customer gets their own statement" },
        ].map((st) => {
          const done = st.n < step || (st.n === 3 && step === 3);
          const active = st.n === step;
          return (
            <li
              key={st.n}
              className={cn(
                "flex items-start gap-3 rounded-lg border px-3 py-2.5",
                active ? "border-blue-300 bg-blue-50" : done ? "border-emerald-200 bg-emerald-50/60" : "bg-white",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  done ? "bg-emerald-600 text-white" : active ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600",
                )}
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : st.n}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{st.title}</span>
                <span className="block text-xs text-muted-foreground">{st.body}</span>
              </span>
            </li>
          );
        })}
      </ol>

      {/* ── Step 1: upload zone (full size until files exist, then compact) ── */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed text-center transition-colors",
          rows.length === 0 ? "flex-col px-4 py-12" : "flex-row px-4 py-3",
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
        <Upload className={cn("text-gray-400", rows.length === 0 ? "h-7 w-7" : "h-4 w-4")} />
        {rows.length === 0 ? (
          <>
            <p className="text-sm font-medium">Drop statement files here, or click to choose</p>
            <p className="text-xs text-muted-foreground">
              PDF or image, up to 8 MB each · one customer per file
            </p>
          </>
        ) : (
          <p className="text-sm font-medium">Add more files</p>
        )}
      </label>

      {/* ── Step 2: review ── */}
      {rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-gray-50/70 px-4 py-2.5 text-sm">
              <span className="font-semibold">
                {rows.length} file{rows.length === 1 ? "" : "s"}
              </span>
              {counts.reading > 0 && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {counts.reading} reading…
                </span>
              )}
              {counts.matched > 0 && (
                <span className="flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {counts.matched} ready to send
                </span>
              )}
              {counts.attention > 0 && (
                <span className="flex items-center gap-1 font-medium text-amber-700">
                  <AlertCircle className="h-3.5 w-3.5" /> {counts.attention} need{counts.attention === 1 ? "s" : ""} a customer
                </span>
              )}
              {counts.sent > 0 && (
                <span className="flex items-center gap-1 text-emerald-700">
                  <Send className="h-3.5 w-3.5" /> {counts.sent} sent
                </span>
              )}
            </div>
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

      {/* ── Step 3: send bar ── */}
      {rows.length > 0 && (
        <div className="sticky bottom-0 -mx-3 flex flex-col gap-2 border-t bg-white/95 px-3 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:rounded-lg sm:border sm:px-4">
          <div className="text-sm">
            {counts.sent === rows.length ? (
              <span className="flex items-center gap-1.5 font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                All {counts.sent} statement{counts.sent === 1 ? "" : "s"} sent.{" "}
                <Link href="/statements" className="underline">View statements</Link>
              </span>
            ) : counts.attention > 0 ? (
              <span className="text-amber-800">
                <span className="font-medium">{counts.attention} file{counts.attention === 1 ? "" : "s"} still need{counts.attention === 1 ? "s" : ""} a customer</span>
                {" "}— pick one from the dropdown or click <span className="font-medium">Create customer</span> on that row.
                {readyRows.length > 0 && " You can send the ready ones now."}
              </span>
            ) : counts.reading > 0 ? (
              <span className="text-muted-foreground">Reading your files…</span>
            ) : (
              <span className="text-emerald-700">
                Every file is matched. Sending delivers each statement to its customer by email / WhatsApp.
              </span>
            )}
          </div>
          <Button
            size="lg"
            onClick={handleSendAll}
            disabled={!readyRows.length || bulkSend.isPending}
            className="shrink-0"
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

// ─── One file row: status on the left, the action on the right ───────────────

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
  const matched = customers.find((c) => c.id === row.customerId) ?? null;
  const busy = row.status === "extracting" || row.status === "queued" || row.status === "sending";
  const needsCustomer = !row.customerId && !busy && row.status !== "sent" && row.status !== "error";

  return (
    <div
      className={cn(
        "flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between",
        needsCustomer && "bg-amber-50/40",
      )}
    >
      {/* Left: file + what we found + status */}
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-medium">{row.fileName}</p>

          {(row.status === "extracting" || row.status === "queued") && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Reading who this statement is for…
            </p>
          )}

          {row.status === "sending" && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Sending…
            </p>
          )}

          {row.status === "sent" && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Sent to {matched ? matched.company || matched.name : "customer"}
            </p>
          )}

          {row.status === "error" && (
            <p className="flex items-center gap-1.5 text-xs text-rose-700">
              <AlertCircle className="h-3.5 w-3.5" />
              {row.errorMessage}
            </p>
          )}

          {row.status === "matched" && matched && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
                <CheckCircle2 className="h-3 w-3" />
                {row.autoCreated ? "New customer created" : "Matched"}
              </span>
              <span className="text-muted-foreground">
                {row.extractedName ? <>Statement says <span className="font-medium text-foreground">{row.extractedName}</span></> : "Assigned manually"}
                {row.confidence && !row.autoCreated && (
                  <span className={cn("ml-1.5 rounded px-1 py-0.5 text-[10px] uppercase",
                    row.confidence === "high" ? "bg-emerald-50 text-emerald-700"
                    : row.confidence === "medium" ? "bg-amber-50 text-amber-700"
                    : "bg-rose-50 text-rose-700")}>
                    {row.confidence} confidence
                  </span>
                )}
              </span>
            </p>
          )}

          {needsCustomer && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                <AlertCircle className="h-3 w-3" />
                Needs a customer
              </span>
              <span className="text-amber-900">
                {row.extractedName ? (
                  <>
                    Statement says <span className="font-medium">{row.extractedName}</span>
                    {" "}({row.extractedCurrency}) — not in your customers yet.
                  </>
                ) : (
                  <>Couldn&apos;t read a customer name from this file.</>
                )}
              </span>
            </p>
          )}
        </div>
      </div>

      {/* Right: the one action this row needs */}
      <div className="flex shrink-0 items-center gap-2 sm:pl-3">
        {needsCustomer && row.extractedName && (
          <Button size="sm" onClick={onCreateCustomer}>
            <UserPlus className="mr-1.5 h-3.5 w-3.5" />
            Create customer
          </Button>
        )}
        {row.status !== "sent" && row.status !== "sending" && (
          <Select
            value={row.customerId ?? "_none"}
            onValueChange={(v) => onChangeCustomer(v === "_none" ? null : v)}
            disabled={busy}
          >
            <SelectTrigger className={cn("h-9 w-[230px]", needsCustomer && "border-amber-300")}>
              <SelectValue placeholder="Pick a customer…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">
                <span className="text-muted-foreground">{needsCustomer ? "Pick an existing customer…" : "Unassign"}</span>
              </SelectItem>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.company || c.name}
                  <span className="ml-1 text-xs text-muted-foreground">· {c.currency}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {row.status !== "sent" && row.status !== "sending" && (
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onRemove} aria-label="Remove file">
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
