import "server-only";

import { randomUUID } from "node:crypto";
import type { ImportKind } from "@prisma/client";
import { db } from "~/lib/db";
import { getObjectBuffer, putObject } from "~/lib/storage";
import { sendPushToCompany } from "~/lib/push-notifications";
import { persistAndDispatch } from "~/server/statements/send";
import {
  extractStatementPages,
  segmentStatementPages,
  slicePdf,
  type StatementPage,
  type StatementSegmentRow,
  type StatementsResult,
} from "~/server/import/extract-statements";
import {
  extractFromDocument,
  extractFromSpreadsheet,
  imageMediaType,
  isSpreadsheet,
  mergeContacts,
  pdfPageCount,
  splitPdf,
  MAX_PAGES_PER_CHUNK,
  type Contact,
} from "~/server/import/extract-contacts";

/**
 * Background import worker — the DB is the queue (same pattern as the SAS
 * pipeline: a job row with an atomically-claimed lease, resumable across
 * runs, no external queue service).
 *
 *  - `processImportJob(id)` claims one job and extracts as many chunks as
 *    fit in its time budget, persisting each chunk's result to `partial` so
 *    the next run resumes from `chunksDone` instead of restarting.
 *  - `processNextImportJob()` picks the oldest claimable job (PENDING, or
 *    RUNNING with a stale lease = a worker that died mid-job).
 *
 * Kicked off immediately on job creation (fire-and-forget) so users never
 * wait for a tick; the Vercel Cron calling `processNextImportJob` every
 * minute is the safety net that guarantees completion.
 */

/** A lease older than this is considered abandoned and can be reclaimed. */
const STALE_LEASE_MS = 10 * 60_000;
/** Give up on a job after this many failed chunk attempts. */
const MAX_ATTEMPTS = 3;

export type WorkerOutcome =
  | { status: "done"; jobId: string; contacts: number }
  | { status: "progress"; jobId: string; chunksDone: number; chunksTotal: number }
  | { status: "failed"; jobId: string; error: string }
  | { status: "skipped"; jobId: string; reason: string }
  | { status: "idle" };

const staleBefore = () => new Date(Date.now() - STALE_LEASE_MS);

/**
 * Atomically claim a specific job. Uses updateMany with the claimable
 * condition in the WHERE so two concurrent workers can't both win — only
 * one sees count === 1 (the SAS `queued → ongoing` claim).
 */
async function claim(jobId: string): Promise<boolean> {
  // Conditional UPDATE is the atomic part (two workers can't both pass the
  // WHERE). Confirmation reads our token back rather than trusting the
  // returned row count, which was observed reporting 0 for a row it had
  // just updated — a false negative would strand the job; a false positive
  // could double-send statements. The token makes both impossible.
  const token = randomUUID();
  await db.importJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["PENDING", "RUNNING", "SENDING"] },
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore() } }],
    },
    data: { lockedAt: new Date(), lockToken: token },
  });
  const mine = await db.importJob.findFirst({
    where: { id: jobId, lockToken: token },
    select: { id: true },
  });
  return !!mine;
}

/**
 * Process one job. `budgetMs` bounds how long this call may run (leave
 * headroom under the route's maxDuration); returns before starting a chunk
 * that wouldn't fit. Safe to call repeatedly — it resumes.
 */
export async function processImportJob(
  jobId: string,
  opts: {
    budgetMs?: number;
    force?: boolean;
    /** Called when the run exits with work remaining; used to self-continue. */
    continueOnProgress?: (jobId: string) => void | Promise<void>;
  } = {},
): Promise<WorkerOutcome> {
  let outcome: WorkerOutcome;
  try {
    outcome = await runImportJob(jobId, opts);
  } catch (err) {
    console.error(`[import ${jobId}] run threw outside the chunk loop:`, err);
    throw err;
  }
  // Self-continue: if this run stopped for budget with work left, kick a
  // fresh run immediately rather than waiting for the next cron tick. The
  // lease was released, so the new run claims it cleanly. Fire-and-forget;
  // the cron still catches anything this misses (e.g. cold-start failure).
  if (outcome.status === "progress" && opts.continueOnProgress) {
    void opts.continueOnProgress(jobId);
  }
  return outcome;
}

async function runImportJob(
  jobId: string,
  opts: { budgetMs?: number; force?: boolean } = {},
): Promise<WorkerOutcome> {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 250_000;
  const timeLeft = () => budgetMs - (Date.now() - started);

  const runId = Math.random().toString(36).slice(2, 8);
  if (!opts.force && !(await claim(jobId))) {
    console.log(`[import ${jobId}] run ${runId}: not claimable`);
    return { status: "skipped", jobId, reason: "not claimable (done, failed, or leased by another worker)" };
  }
  console.log(`[import ${jobId}] run ${runId}: claimed`);

  const job = await db.importJob.findUnique({ where: { id: jobId } });
  if (!job) return { status: "skipped", jobId, reason: "not found" };
  console.log(`[import ${jobId}] run ${runId}: kind=${job.kind} status=${job.status} chunks=${job.chunksDone}/${job.chunksTotal}`);
  if (job.status === "DONE" || job.status === "FAILED" || job.status === "REVIEW") {
    return { status: "skipped", jobId, reason: `already ${job.status}` };
  }
  if (job.status === "PENDING") {
    await db.importJob.update({ where: { id: jobId }, data: { status: "RUNNING" } });
  }
  if (job.kind === "STATEMENTS" && job.status === "SENDING") {
    return sendStatementSegments(job, { budgetMs, timeLeft });
  }

  try {
    // ── Plan (first run only) ────────────────────────────────────────────
    console.log(`[import ${jobId}] run ${runId}: fetching ${job.fileKey}`);
    const bytes = await getObjectBuffer(job.fileKey);
    console.log(`[import ${jobId}] run ${runId}: fetched ${bytes.length} bytes`);
    const sheet = isSpreadsheet(job.fileName, job.fileType);
    const isPdf =
      job.fileType === "application/pdf" || job.fileName.toLowerCase().endsWith(".pdf");

    let chunksTotal = job.chunksTotal;
    let pageCount = job.pageCount;
    if (chunksTotal === 0) {
      pageCount = isPdf ? await pdfPageCount(bytes) : null;
      chunksTotal = sheet || !isPdf ? 1 : Math.max(1, Math.ceil((pageCount ?? 1) / MAX_PAGES_PER_CHUNK));
      await db.importJob.update({
        where: { id: jobId },
        data: { chunksTotal, pageCount, startedAt: job.startedAt ?? new Date(), error: null },
      });
    }

    // Resume point: everything before chunksDone is already in `partial`.
    const partial: Contact[][] = Array.isArray(job.partial)
      ? (job.partial as unknown as Contact[][])
      : [];
    let chunksDone = Math.min(job.chunksDone, partial.length);
    const pdfChunks = isPdf && chunksTotal > 1 ? await splitPdf(bytes, MAX_PAGES_PER_CHUNK) : null;

    // ── Extract chunks while budget allows ───────────────────────────────
    // Chunk cost varies with density (measured 60–180s for 50 pages). Start
    // with a conservative guess, then use this run's measured average so we
    // don't leave usable budget on the table.
    let estimateMs = 120_000;
    let measuredTotal = 0;
    let measuredCount = 0;
    while (chunksDone < chunksTotal) {
      if (timeLeft() < estimateMs && chunksDone > 0) {
        // Out of budget for another chunk — release the lease so the next
        // run (cron tick / follow-up kick) can pick up right here.
        await db.importJob.update({ where: { id: jobId }, data: { lockedAt: null } });
        return { status: "progress", jobId, chunksDone, chunksTotal };
      }

      const i = chunksDone;
      const chunkStart = Date.now();
      let out: Contact[] | StatementPage[];
      if (job.kind === "STATEMENTS") {
        // Statement run: read every page's customer. Chunks are page ranges,
        // so pass the offset to keep page numbers document-global.
        if (pdfChunks) {
          const chunk = pdfChunks[i];
          if (!chunk) throw new Error(`Chunk ${i + 1} out of range`);
          console.log(`[import ${jobId}] statements chunk ${i + 1}/${chunksTotal} pages ${chunk.from}-${chunk.to}`);
          out = await extractStatementPages(chunk.bytes, chunk.from - 1);
        } else {
          out = await extractStatementPages(bytes, 0);
        }
      } else if (sheet) {
        out = await extractFromSpreadsheet(Buffer.from(bytes));
      } else if (pdfChunks) {
        const chunk = pdfChunks[i];
        if (!chunk) throw new Error(`Chunk ${i + 1} out of range`);
        console.log(`[import ${jobId}] chunk ${i + 1}/${chunksTotal} pages ${chunk.from}-${chunk.to}`);
        out = await extractFromDocument(chunk.bytes, "application/pdf");
      } else if (isPdf) {
        out = await extractFromDocument(bytes, "application/pdf");
      } else {
        out = await extractFromDocument(bytes, imageMediaType(job.fileType));
      }

      // Feed the measured duration back into the budget estimate (with 25%
      // headroom so a slightly denser chunk still fits).
      measuredTotal += Date.now() - chunkStart;
      measuredCount += 1;
      estimateMs = Math.round((measuredTotal / measuredCount) * 1.25);

      partial[i] = out as Contact[];
      chunksDone = i + 1;
      // Persist progress + refresh the lease (heartbeat) after every chunk.
      await db.importJob.update({
        where: { id: jobId },
        data: { partial: partial as unknown as object, chunksDone, lockedAt: new Date() },
      });
    }

    // ── Finish + notify ──────────────────────────────────────────────────
    if (job.kind === "STATEMENTS") {
      const pages = (partial as unknown as StatementPage[][]).flat();
      const segments = segmentStatementPages(pages);
      const existing = await db.customer.findMany({
        where: { companyId: job.companyId },
        select: { id: true, company: true, name: true, currency: true },
      });
      const norm = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const rows: StatementSegmentRow[] = segments.map((seg, index) => {
        const target = norm(seg.customerName);
        const pool = existing.filter((c) => c.currency === seg.currency);
        const exact = pool.find((c) => norm(c.company) === target || norm(c.name) === target);
        const fuzzy = exact
          ? null
          : pool.find((c) => {
              const co = norm(c.company);
              const na = norm(c.name);
              return (
                (co && (co.includes(target) || target.includes(co))) ||
                (na && (na.includes(target) || target.includes(na)))
              );
            });
        const hit = exact ?? fuzzy ?? null;
        return {
          ...seg,
          index,
          suggestedCustomerId: hit?.id ?? null,
          matchConfidence: exact ? "exact" : fuzzy ? "fuzzy" : null,
          decision: null,
          status: "pending",
        };
      });
      const result: StatementsResult = { kind: "statements", pageCount: pageCount ?? pages.length, segments: rows };
      const review = await db.importJob.update({
        where: { id: jobId },
        data: {
          status: "REVIEW",
          result: result as unknown as object,
          chunksDone: chunksTotal,
          sendTotal: rows.length,
          lockedAt: null,
        },
        select: { id: true, kind: true, companyId: true, createdById: true, fileName: true },
      });
      await notify(review, "ready", rows.length);
      return { status: "done", jobId, contacts: rows.length };
    }

    const merged = mergeContacts(partial);
    const done = await db.importJob.update({
      where: { id: jobId },
      data: {
        status: "DONE",
        finishedAt: new Date(),
        result: merged as unknown as object,
        chunksDone: chunksTotal,
        lockedAt: null,
      },
      select: { id: true, kind: true, companyId: true, createdById: true, fileName: true },
    });
    await notify(done, "ready", merged.length);
    return { status: "done", jobId, contacts: merged.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[import ${jobId}] chunk failed:`, message);
    const attempts = job.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      const failed = await db.importJob.update({
        where: { id: jobId },
        data: { status: "FAILED", finishedAt: new Date(), error: message, attempts, lockedAt: null },
        select: { id: true, kind: true, companyId: true, createdById: true, fileName: true },
      });
      await notify(failed, "failed", 0, message);
      return { status: "failed", jobId, error: message };
    }
    // Release the lease so a later run retries from the same chunk.
    await db.importJob.update({
      where: { id: jobId },
      data: { attempts, error: message, lockedAt: null },
    });
    return { status: "progress", jobId, chunksDone: job.chunksDone, chunksTotal: job.chunksTotal };
  }
}

/** Claim + process the oldest claimable job. Called by the cron. */
export async function processNextImportJob(budgetMs?: number): Promise<WorkerOutcome> {
  const next = await db.importJob.findFirst({
    where: {
      status: { in: ["PENDING", "RUNNING", "SENDING"] },
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore() } }],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!next) return { status: "idle" };
  return processImportJob(next.id, { budgetMs });
}

async function notify(
  job: { id: string; kind: ImportKind; companyId: string; createdById: string; fileName: string },
  outcome: "ready" | "failed" | "sent",
  count: number,
  error?: string,
) {
  const isStatements = job.kind === "STATEMENTS";
  const kindLabel = job.kind === "CUSTOMERS" ? "customers" : job.kind === "SUPPLIERS" ? "suppliers" : "statements";
  const url = isStatements
    ? `/customers/send-statements?job=${job.id}`
    : `/${kindLabel}/import?job=${job.id}`;
  const message =
    outcome === "sent"
      ? `Statement run ${job.fileName}: ${count} statement${count === 1 ? "" : "s"} sent to your customers`
      : outcome === "ready"
        ? isStatements
          ? `Statement run ${job.fileName} is ready to review — ${count} customer statement${count === 1 ? "" : "s"} found`
          : `Your ${kindLabel} import (${job.fileName}) is ready to review — ${count} contact${count === 1 ? "" : "s"} found`
        : `Your ${kindLabel} import (${job.fileName}) couldn't be processed: ${error ?? "extraction failed"}`;

  await db.notification.create({
    data: {
      message,
      type: outcome === "failed" ? "IMPORT_FAILED" : "IMPORT_READY",
      userId: job.createdById,
      importJobId: job.id,
    },
  });
  void sendPushToCompany(job.companyId, {
    title: outcome === "sent" ? "Statements sent" : outcome === "ready" ? (isStatements ? "Statement run ready to review" : "Import ready to review") : "Import failed",
    body: message,
    url,
    tag: `import-${job.id}`,
  });
}

/**
 * Start (or continue) a worker run for a job by calling our own cron route.
 * Each HTTP call is a new serverless invocation with the route's full
 * maxDuration budget — which is why EVERY run goes through here, including
 * the very first one after upload: the tRPC mutation that created the job
 * has a much shorter default timeout and must not run chunks itself.
 * Best-effort: if it fails, the every-minute cron resumes the job anyway.
 */
export function kickImportWorker(jobId: string): Promise<void> {
  // Target THIS deployment, not the canonical public domain: on Vercel,
  // VERCEL_URL is the current deployment (so previews chain to themselves,
  // never to production); locally there's no VERCEL_URL so we hit localhost.
  // NEXT_PUBLIC_APP_URL is deliberately NOT used here — it points at prod.
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : `http://localhost:${process.env.PORT ?? 3000}`;
  const secret = process.env.CRON_SECRET;
  const url = `${base}/api/cron/process-imports?job=${encodeURIComponent(jobId)}`;
  console.log(`[import ${jobId}] kicking worker run → ${url}`);
  return fetch(url, {
    method: "GET",
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
    // Don't hold this invocation open on the whole next run — we only need
    // the request to be *sent*. Abort our side after a short grace period.
    signal: AbortSignal.timeout(5_000),
  })
    .then(() => undefined)
    .catch((err: unknown) => {
      // A timeout abort is EXPECTED (the next run is long-lived); anything
      // else means the kick didn't fire and the cron will resume the job.
      const name = err instanceof Error ? err.name : "";
      if (name !== "TimeoutError" && name !== "AbortError") {
        console.warn(`[import ${jobId}] worker kick failed (cron will resume):`, err);
      }
    });
}


// ─── STATEMENTS: send phase ──────────────────────────────────────────────────

/**
 * After the user confirms on the review screen (status → SENDING), split
 * each confirmed segment out of the source PDF, upload it, resolve its
 * customer (existing, or create — never duplicating on name + currency), and
 * send it through the same path as a manual statement send. Resumable:
 * every segment's outcome is written to `result` as it completes.
 */
async function sendStatementSegments(
  job: { id: string; companyId: string; fileKey: string; result: unknown; sendDone: number; sendTotal: number },
  budget: { budgetMs: number; timeLeft: () => number },
): Promise<WorkerOutcome> {
  const jobId = job.id;
  const result = job.result as StatementsResult | null;
  if (!result || result.kind !== "statements") {
    await db.importJob.update({
      where: { id: jobId },
      data: { status: "FAILED", error: "No review result to send", lockedAt: null, finishedAt: new Date() },
    });
    return { status: "failed", jobId, error: "No review result to send" };
  }

  const source = await getObjectBuffer(job.fileKey);
  const segments = result.segments;
  let estimateMs = 8_000;
  let measured = 0;
  let measuredCount = 0;

  const persist = async (extra: Partial<{ status: "SENDING" | "DONE" }> = {}) => {
    const sendDone = segments.filter((s) => s.status === "sent" || s.status === "skipped" || s.status === "error").length;
    await db.importJob.update({
      where: { id: jobId },
      data: { result: result as unknown as object, sendDone, lockedAt: new Date(), ...extra },
    });
    return sendDone;
  };

  for (const seg of segments) {
    if (seg.status !== "pending") continue;
    if (!seg.decision || seg.decision.action === "skip") {
      seg.status = "skipped";
      continue;
    }
    if (budget.timeLeft() < estimateMs) {
      await persist();
      await db.importJob.update({ where: { id: jobId }, data: { lockedAt: null } });
      const done = segments.filter((s) => s.status !== "pending").length;
      return { status: "progress", jobId, chunksDone: done, chunksTotal: segments.length };
    }

    const t0 = Date.now();
    try {
      // 1. Resolve the customer.
      let customerId = seg.decision.customerId;
      if (!customerId) {
        const dup = await db.customer.findFirst({
          where: {
            companyId: job.companyId,
            currency: seg.currency,
            OR: [
              { company: { equals: seg.customerName, mode: "insensitive" } },
              { company: null, name: { equals: seg.customerName, mode: "insensitive" } },
            ],
          },
          select: { id: true },
        });
        if (dup) {
          customerId = dup.id;
        } else {
          if (!seg.email) {
            throw new Error("No email for this customer — add one on the review screen");
          }
          const created = await db.customer.create({
            data: {
              company: seg.customerName,
              name: seg.customerName,
              phone: seg.phone,
              email: seg.email,
              address: seg.address,
              currency: seg.currency,
              companyId: job.companyId,
            },
            select: { id: true },
          });
          customerId = created.id;
        }
      }

      // 2. Split this customer's pages out and store them as their statement.
      const bytes = await slicePdf(source, seg.from, seg.to);
      const key = `statements/${job.companyId}/${randomUUID()}.pdf`;
      await putObject(key, Buffer.from(bytes), "application/pdf");
      const safeName = seg.customerName.replace(/[^a-zA-Z0-9._() -]+/g, "-").trim() || "customer";

      // 3. Send exactly like a manual statement send (upsert + notify).
      const stmt = await persistAndDispatch({
        ctx: { db },
        user: { companyId: job.companyId },
        customerId,
        fileDataUrl: key,
        fileName: `SOA ${safeName}.pdf`,
        fileType: "application/pdf",
      });
      seg.status = "sent";
      seg.customerId = customerId;
      seg.statementId = stmt.id;
    } catch (err) {
      seg.status = "error";
      seg.error = err instanceof Error ? err.message : String(err);
      console.error(`[import ${jobId}] segment ${seg.index + 1} (${seg.customerName}) failed:`, seg.error);
    }
    measured += Date.now() - t0;
    measuredCount += 1;
    estimateMs = Math.round((measured / measuredCount) * 1.5);
    await persist();
  }

  const sentCount = segments.filter((s) => s.status === "sent").length;
  await persist({ status: "DONE" });
  const done = await db.importJob.update({
    where: { id: jobId },
    data: { finishedAt: new Date(), lockedAt: null },
    select: { id: true, kind: true, companyId: true, createdById: true, fileName: true },
  });
  await notify(done, "sent", sentCount);
  return { status: "done", jobId, contacts: sentCount };
}
