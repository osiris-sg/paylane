"use client";

import { useMemo, useState } from "react";
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
} from "lucide-react";
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

type Row = {
  id: string;
  file: File;
  fileName: string;
  fileType: string;
  fileDataUrl: string | null;
  status:
    | "queued"
    | "extracting"
    | "matched"
    | "no_match"
    | "sending"
    | "sent"
    | "error";
  extractedName: string | null;
  confidence: "high" | "medium" | "low" | null;
  customerId: string | null; // null = unmatched / unselected
  errorMessage?: string;
};

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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

/** Best-match a customer using a fuzzy alphanumeric overlap heuristic. */
function matchCustomer(
  extracted: string | null,
  customers: Array<{ id: string; company: string | null; name: string }>,
): { id: string; confidence: "exact" | "fuzzy" } | null {
  if (!extracted) return null;
  const norm = (s: string | null | undefined) =>
    (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = norm(extracted);
  if (!target) return null;

  const exact = customers.find(
    (c) => norm(c.company) === target || norm(c.name) === target,
  );
  if (exact) return { id: exact.id, confidence: "exact" };

  // Substring containment with length floor for stability.
  const fuzzy = customers.find((c) => {
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
  const customerOptions = useMemo(
    () =>
      (customers.data?.customers ?? []).map((c) => ({
        id: c.id,
        company: c.company,
        name: c.name,
      })),
    [customers.data],
  );

  const bulkSend = api.statement.bulkSend.useMutation();

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
      fileDataUrl: null,
      status: "extracting",
      extractedName: null,
      confidence: null,
      customerId: null,
    }));
    setRows((prev) => [...prev, ...newRows]);

    // Run extractions in parallel.
    await Promise.all(
      newRows.map(async (row) => {
        try {
          const dataUrl = await fileToDataUrl(row.file);
          updateRow(row.id, { fileDataUrl: dataUrl });

          const fd = new FormData();
          fd.append("file", row.file);
          const res = await fetch("/api/extract-soa", {
            method: "POST",
            body: fd,
          });
          const body = (await res.json().catch(() => ({}))) as {
            extraction?: {
              customerName?: string | null;
              confidence?: "high" | "medium" | "low" | null;
            };
            error?: string;
          };
          if (!res.ok) throw new Error(body.error || "Extract failed");

          const extractedName = body.extraction?.customerName ?? null;
          const match = matchCustomer(extractedName, customerOptions);

          updateRow(row.id, {
            extractedName,
            confidence: body.extraction?.confidence ?? null,
            customerId: match?.id ?? null,
            status: match ? "matched" : "no_match",
          });
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
    (r) => r.fileDataUrl && r.customerId && r.status !== "sent",
  );
  const allMatched = rows.length > 0 && rows.every((r) => r.customerId);

  const handleSendAll = async () => {
    const items = readyRows.map((r) => ({
      customerId: r.customerId!,
      fileDataUrl: r.fileDataUrl!,
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
          Bulk send statements
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
    </div>
  );
}

function RowView({
  row,
  customers,
  onChangeCustomer,
  onRemove,
}: {
  row: Row;
  customers: Array<{ id: string; company: string | null; name: string }>;
  onChangeCustomer: (id: string | null) => void;
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
