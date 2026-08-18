import "server-only";

import { db } from "~/lib/db";
import { getObjectBuffer } from "~/lib/storage";
import { sendPushToCompany } from "~/lib/push-notifications";
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
  const { count } = await db.importJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["PENDING", "RUNNING"] },
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore() } }],
    },
    data: { lockedAt: new Date(), status: "RUNNING" },
  });
  return count === 1;
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
  const outcome = await runImportJob(jobId, opts);
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

  if (!opts.force && !(await claim(jobId))) {
    return { status: "skipped", jobId, reason: "not claimable (done, failed, or leased by another worker)" };
  }

  const job = await db.importJob.findUnique({ where: { id: jobId } });
  if (!job) return { status: "skipped", jobId, reason: "not found" };
  if (job.status === "DONE" || job.status === "FAILED") {
    return { status: "skipped", jobId, reason: `already ${job.status}` };
  }

  try {
    // ── Plan (first run only) ────────────────────────────────────────────
    const bytes = await getObjectBuffer(job.fileKey);
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
      let out: Contact[];
      if (sheet) {
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

      partial[i] = out;
      chunksDone = i + 1;
      // Persist progress + refresh the lease (heartbeat) after every chunk.
      await db.importJob.update({
        where: { id: jobId },
        data: { partial: partial as unknown as object, chunksDone, lockedAt: new Date() },
      });
    }

    // ── Finish + notify ──────────────────────────────────────────────────
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
      status: { in: ["PENDING", "RUNNING"] },
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore() } }],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!next) return { status: "idle" };
  return processImportJob(next.id, { budgetMs });
}

async function notify(
  job: { id: string; kind: "CUSTOMERS" | "SUPPLIERS"; companyId: string; createdById: string; fileName: string },
  outcome: "ready" | "failed",
  count: number,
  error?: string,
) {
  const kindLabel = job.kind === "CUSTOMERS" ? "customers" : "suppliers";
  const url = `/${kindLabel}/import?job=${job.id}`;
  const message =
    outcome === "ready"
      ? `Your ${kindLabel} import (${job.fileName}) is ready to review — ${count} contact${count === 1 ? "" : "s"} found`
      : `Your ${kindLabel} import (${job.fileName}) couldn't be processed: ${error ?? "extraction failed"}`;

  await db.notification.create({
    data: {
      message,
      type: outcome === "ready" ? "IMPORT_READY" : "IMPORT_FAILED",
      userId: job.createdById,
      importJobId: job.id,
    },
  });
  void sendPushToCompany(job.companyId, {
    title: outcome === "ready" ? "Import ready to review" : "Import failed",
    body: message,
    url,
    tag: `import-${job.id}`,
  });
}

/**
 * Kick a fresh worker invocation for a job by calling our own cron route.
 * Each HTTP call is a new serverless invocation with a full time budget, so
 * chaining these lets a job of any size finish without waiting on cron ticks.
 * Best-effort: if it fails, the every-minute cron resumes the job anyway.
 */
export function kickImportWorker(jobId: string): void {
  // Target THIS deployment, not the canonical public domain: on Vercel,
  // VERCEL_URL is the current deployment (so previews chain to themselves,
  // never to production); locally there's no VERCEL_URL so we hit localhost.
  // NEXT_PUBLIC_APP_URL is deliberately NOT used here — it points at prod.
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : `http://localhost:${process.env.PORT ?? 3000}`;
  const secret = process.env.CRON_SECRET;
  const url = `${base}/api/cron/process-imports?job=${encodeURIComponent(jobId)}`;
  console.log(`[import ${jobId}] chaining next run → ${url}`);
  fetch(url, {
    method: "GET",
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
    // Don't hold this invocation open on the whole next run — we only need
    // the request to be *sent*. Abort our side after a short grace period.
    signal: AbortSignal.timeout(5_000),
  }).catch((err: unknown) => {
    // A timeout abort is EXPECTED (the next run is long-lived); anything
    // else means the chain didn't fire and the cron will resume the job.
    const name = err instanceof Error ? err.name : "";
    if (name !== "TimeoutError" && name !== "AbortError") {
      console.warn(`[import ${jobId}] chain request failed (cron will resume):`, err);
    }
  });
}
