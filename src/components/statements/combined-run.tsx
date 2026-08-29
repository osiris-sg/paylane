"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Send,
  Bell,
  FileText,
  UserPlus,
  SkipForward,
} from "lucide-react";

import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";
import { uploadViaPresignedPut } from "~/lib/upload-file";
import type { StatementsResult, StatementSegmentRow } from "~/server/import/extract-statements";

/**
 * Combined statement run: ONE PDF where every page is a different customer's
 * statement. Upload → background extraction (one job) → review the
 * customer↔pages mapping → confirm → background split + send per customer.
 */

type Decision = { action: "send"; customerId: string | null } | { action: "skip" };

const CREATE = "__create__";
const SKIP = "__skip__";

export function CombinedRun({ jobId, onJobChange }: { jobId: string | null; onJobChange: (id: string | null) => void }) {
  const router = useRouter();
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [onlyAttention, setOnlyAttention] = useState(false);

  const createUploadUrl = api.storage.createUploadUrl.useMutation();
  const createJob = api.importJob.create.useMutation();
  const startSend = api.importJob.startStatementSend.useMutation();
  const customers = api.customer.list.useQuery({ page: 1, limit: 500 });

  const job = api.importJob.get.useQuery(
    { id: jobId ?? "" },
    {
      enabled: !!jobId,
      refetchInterval: (q) => {
        const st = q.state.data?.status;
        return st === "PENDING" || st === "RUNNING" || st === "SENDING" ? 2000 : false;
      },
    },
  );
  const data = job.data;
  const result =
    data?.result && typeof data.result === "object" && !Array.isArray(data.result) && (data.result as StatementsResult).kind === "statements"
      ? (data.result as StatementsResult)
      : null;

  // ── Per-row decisions (review step) ────────────────────────────────────
  const [decisions, setDecisions] = useState<Map<number, Decision>>(new Map());
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!result || !data || data.status !== "REVIEW" || seededFor.current === data.id) return;
    seededFor.current = data.id;
    const m = new Map<number, Decision>();
    for (const seg of result.segments) {
      if (seg.suggestedCustomerId) m.set(seg.index, { action: "send", customerId: seg.suggestedCustomerId });
      else if (seg.phone || seg.email) m.set(seg.index, { action: "send", customerId: null });
      else m.set(seg.index, { action: "skip" });
    }
    setDecisions(m);
  }, [result, data]);

  const customerOptions = useMemo(
    () => (customers.data?.customers ?? []).map((c) => ({ id: c.id, label: c.company || c.name, currency: c.currency })),
    [customers.data],
  );

  // ── Upload ─────────────────────────────────────────────────────────────
  const acceptFile = async (file: File) => {
    if (file.type !== "application/pdf") {
      toast.error("Upload the statement run as a single PDF.");
      return;
    }
    setUploading(true);
    try {
      const fileKey = await uploadViaPresignedPut(file, "imports", (input) => createUploadUrl.mutateAsync(input));
      const { id } = await createJob.mutateAsync({
        kind: "STATEMENTS",
        fileKey,
        fileName: file.name,
        fileType: "application/pdf",
      });
      seededFor.current = null;
      onJobChange(id);
      router.replace(`/customers/send-statements?mode=combined&job=${id}`);
      toast.info("Reading your statement run in the background — we'll notify you when it's ready to review.", { duration: 6000 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // ── Derived review counts ──────────────────────────────────────────────
  const segs = result?.segments ?? [];
  const decided = (seg: StatementSegmentRow): Decision => decisions.get(seg.index) ?? { action: "skip" };
  const needsAttention = (seg: StatementSegmentRow) =>
    !seg.suggestedCustomerId && !seg.phone && !seg.email && decided(seg).action === "skip";
  const counts = {
    total: segs.length,
    matched: segs.filter((s) => { const d = decided(s); return d.action === "send" && d.customerId; }).length,
    create: segs.filter((s) => { const d = decided(s); return d.action === "send" && !d.customerId; }).length,
    skip: segs.filter((s) => decided(s).action === "skip").length,
    attention: segs.filter(needsAttention).length,
  };
  const toSend = counts.matched + counts.create;

  const confirmSend = async () => {
    if (!data) return;
    try {
      const { sendTotal } = await startSend.mutateAsync({
        id: data.id,
        decisions: segs.map((s) => {
          const d = decided(s);
          return d.action === "send" ? { index: s.index, action: "send" as const, customerId: d.customerId } : { index: s.index, action: "skip" as const };
        }),
      });
      toast.success(`Sending ${sendTotal} statement${sendTotal === 1 ? "" : "s"} in the background — we'll notify you when done.`);
      void job.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start sending");
    }
  };

  const step: 1 | 2 | 3 | 4 = !data
    ? 1
    : data.status === "PENDING" || data.status === "RUNNING" || data.status === "FAILED"
      ? 2
      : data.status === "REVIEW"
        ? 3
        : 4;

  return (
    <div className="flex flex-col gap-5">
      {/* Stepper */}
      <ol className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {[
          { n: 1, title: "Upload", body: "One PDF, one customer per page" },
          { n: 2, title: "Read", body: "We find every customer & their pages" },
          { n: 3, title: "Review", body: "Confirm who each statement goes to" },
          { n: 4, title: "Send", body: "Each customer gets only their pages" },
        ].map((st) => {
          const done = st.n < step || (st.n === 4 && data?.status === "DONE");
          const active = st.n === step && !(st.n === 4 && data?.status === "DONE");
          return (
            <li key={st.n} className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5", active ? "border-blue-300 bg-blue-50" : done ? "border-emerald-200 bg-emerald-50/60" : "bg-white")}>
              <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold", done ? "bg-emerald-600 text-white" : active ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600")}>
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

      {/* Step 1: upload (only when no job) */}
      {!jobId && (
        <label
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) void acceptFile(f); }}
          className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-12 text-center transition-colors", dragOver ? "border-blue-400 bg-blue-50" : "border-gray-200 bg-gray-50 hover:border-blue-300 hover:bg-blue-50/40")}
        >
          <input type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void acceptFile(f); e.target.value = ""; }} />
          {uploading ? <Loader2 className="h-7 w-7 animate-spin text-blue-600" /> : <Upload className="h-7 w-7 text-gray-400" />}
          <p className="text-sm font-medium">{uploading ? "Uploading…" : "Drop your statement run PDF here, or click to choose"}</p>
          <p className="max-w-md text-xs text-muted-foreground">
            The whole run in one PDF — e.g. 400 pages for 300 customers. We read every page, group each customer&apos;s pages, and send each customer only their own statement.
          </p>
        </label>
      )}

      {/* Step 2: reading */}
      {data && (data.status === "PENDING" || data.status === "RUNNING") && (
        <Card className="border-2 border-blue-300 bg-blue-50">
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex items-start gap-3">
              <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-blue-600" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{data.status === "PENDING" ? "Queued — starting shortly…" : "Reading every page of your statement run"}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {data.fileName}{data.pageCount ? ` · ${data.pageCount} pages` : ""}{data.chunksTotal > 1 ? ` · part ${Math.min(data.chunksDone + 1, data.chunksTotal)} of ${data.chunksTotal}` : ""}
                </p>
              </div>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-blue-200/70">
              <div className="h-full rounded-full bg-blue-600 transition-all duration-500" style={{ width: `${data.chunksTotal ? Math.max(4, Math.round((data.chunksDone / data.chunksTotal) * 100)) : 4}%` }} />
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Bell className="h-3.5 w-3.5" /> You can leave this page — we&apos;ll notify you when it&apos;s ready to review.
            </p>
          </CardContent>
        </Card>
      )}

      {data?.status === "FAILED" && (
        <Card className="border-2 border-red-300 bg-red-50">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 text-red-600" />
            <div>
              <p className="text-sm font-semibold">Couldn&apos;t read this statement run</p>
              <p className="text-xs text-red-700">{data.error}</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => { onJobChange(null); router.replace("/customers/send-statements?mode=combined"); }}>Try another file</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: review */}
      {data?.status === "REVIEW" && result && (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-gray-50/70 px-4 py-2.5 text-sm">
                <span className="font-semibold">{counts.total} customer statement{counts.total === 1 ? "" : "s"} found in {result.pageCount} pages</span>
                {counts.matched > 0 && <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> {counts.matched} matched existing</span>}
                {counts.create > 0 && <span className="flex items-center gap-1 text-blue-700"><UserPlus className="h-3.5 w-3.5" /> {counts.create} will be created</span>}
                {counts.attention > 0 && <span className="flex items-center gap-1 font-medium text-amber-700"><AlertCircle className="h-3.5 w-3.5" /> {counts.attention} need attention</span>}
                {counts.skip - counts.attention > 0 && <span className="flex items-center gap-1 text-muted-foreground"><SkipForward className="h-3.5 w-3.5" /> {counts.skip - counts.attention} skipped</span>}
                <label className="ml-auto flex items-center gap-2 text-xs">
                  <Checkbox checked={onlyAttention} onCheckedChange={(v) => setOnlyAttention(!!v)} />
                  Show only rows needing attention
                </label>
              </div>
              <div className="max-h-[60vh] divide-y overflow-y-auto">
                {segs.filter((s) => !onlyAttention || needsAttention(s)).map((seg) => {
                  const d = decided(seg);
                  const attention = needsAttention(seg);
                  const value = d.action === "skip" ? SKIP : d.customerId ?? CREATE;
                  const sameCur = customerOptions.filter((c) => c.currency === seg.currency);
                  const otherCur = customerOptions.filter((c) => c.currency !== seg.currency);
                  return (
                    <div key={seg.index} className={cn("flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between", attention && "bg-amber-50/50")}>
                      <div className="flex min-w-0 items-start gap-3">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {seg.customerName}
                            <span className="ml-1.5 rounded border px-1.5 py-0.5 align-middle text-[10px] font-medium text-muted-foreground">{seg.currency}</span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {seg.from === seg.to ? `Page ${seg.from}` : `Pages ${seg.from}–${seg.to}`}
                            {seg.accountCode ? ` · acct ${seg.accountCode}` : ""}
                            {seg.phone ? ` · ${seg.phone}` : ""}
                            {seg.email ? ` · ${seg.email}` : ""}
                          </p>
                          {attention && <p className="text-xs text-amber-800">No phone or email on the statement, so we can&apos;t create this customer — pick an existing one or skip.</p>}
                          {seg.matchConfidence === "fuzzy" && d.action === "send" && d.customerId === seg.suggestedCustomerId && (
                            <p className="text-xs text-amber-700">Fuzzy match — double-check the customer on the right.</p>
                          )}
                        </div>
                      </div>
                      <Select
                        value={value}
                        onValueChange={(v) =>
                          setDecisions((prev) => {
                            const next = new Map(prev);
                            next.set(seg.index, v === SKIP ? { action: "skip" } : { action: "send", customerId: v === CREATE ? null : v });
                            return next;
                          })
                        }
                      >
                        <SelectTrigger className={cn("h-9 w-full sm:w-[280px]", attention && "border-amber-300")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(seg.phone || seg.email) && (
                            <SelectItem value={CREATE}>
                              <span className="flex items-center gap-1.5"><UserPlus className="h-3.5 w-3.5" /> Create new customer ({seg.currency})</span>
                            </SelectItem>
                          )}
                          <SelectItem value={SKIP}>
                            <span className="flex items-center gap-1.5 text-muted-foreground"><SkipForward className="h-3.5 w-3.5" /> Skip this one</span>
                          </SelectItem>
                          {sameCur.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.label}<span className="ml-1 text-xs text-muted-foreground">· {c.currency}</span></SelectItem>
                          ))}
                          {otherCur.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.label}<span className="ml-1 text-xs text-muted-foreground">· {c.currency}</span></SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <div className="sticky bottom-0 -mx-3 flex flex-col gap-2 border-t bg-white/95 px-3 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:rounded-lg sm:border sm:px-4">
            <p className="text-sm">
              {toSend > 0 ? (
                <>Ready to send <span className="font-semibold">{toSend}</span> statement{toSend === 1 ? "" : "s"}{counts.create > 0 ? <> — <span className="font-medium">{counts.create}</span> new customer{counts.create === 1 ? "" : "s"} will be created first</> : null}{counts.skip > 0 ? <>, {counts.skip} skipped</> : null}. Each customer receives only their own pages.</>
              ) : (
                <span className="text-amber-800">Nothing selected to send — pick a customer or &ldquo;Create new&rdquo; on at least one row.</span>
              )}
            </p>
            <Button size="lg" className="shrink-0" onClick={confirmSend} disabled={toSend === 0 || startSend.isPending}>
              {startSend.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting…</> : <><Send className="mr-2 h-4 w-4" /> Send {toSend} statement{toSend === 1 ? "" : "s"}</>}
            </Button>
          </div>
        </>
      )}

      {/* Step 4: sending / done */}
      {data && (data.status === "SENDING" || data.status === "DONE") && result && (
        <Card className={cn("border-2", data.status === "DONE" ? "border-emerald-300 bg-emerald-50" : "border-blue-300 bg-blue-50")}>
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex items-start gap-3">
              {data.status === "DONE" ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" /> : <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-blue-600" />}
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {data.status === "DONE"
                    ? `Done — ${result.segments.filter((s) => s.status === "sent").length} statement${result.segments.filter((s) => s.status === "sent").length === 1 ? "" : "s"} sent`
                    : `Splitting and sending… ${data.sendDone} of ${data.sendTotal}`}
                </p>
                <p className="truncate text-xs text-muted-foreground">{data.fileName}</p>
              </div>
            </div>
            {data.status === "SENDING" && (
              <>
                <div className="h-2 w-full overflow-hidden rounded-full bg-blue-200/70">
                  <div className="h-full rounded-full bg-blue-600 transition-all duration-500" style={{ width: `${data.sendTotal ? Math.max(4, Math.round((data.sendDone / data.sendTotal) * 100)) : 4}%` }} />
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Bell className="h-3.5 w-3.5" /> You can leave this page — we&apos;ll notify you when every statement has gone out.</p>
              </>
            )}
            {data.status === "DONE" && (
              <div className="text-sm">
                {result.segments.filter((s) => s.status === "error").length > 0 && (
                  <div className="mb-2 rounded-md border border-red-200 bg-white p-3">
                    <p className="mb-1 flex items-center gap-1.5 font-medium text-red-700"><AlertCircle className="h-4 w-4" /> {result.segments.filter((s) => s.status === "error").length} couldn&apos;t be sent</p>
                    <ul className="list-disc space-y-0.5 pl-5 text-xs text-red-800">
                      {result.segments.filter((s) => s.status === "error").map((s) => (
                        <li key={s.index}>{s.customerName} (p. {s.from}{s.to !== s.from ? `–${s.to}` : ""}): {s.error}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <Button asChild size="sm"><Link href="/statements">View statements</Link></Button>
                  <Button variant="outline" size="sm" onClick={() => { onJobChange(null); router.replace("/customers/send-statements?mode=combined"); }}>Upload another run</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
