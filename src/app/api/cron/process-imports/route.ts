import { NextRequest, NextResponse } from "next/server";
import {
  kickImportWorker,
  processImportJob,
  processNextImportJob,
} from "~/server/import/worker";

// Safety-net worker for background contact imports. Jobs are normally
// kicked off the instant they're created (see importJob.create), so this
// cron exists to (a) resume jobs whose worker died mid-run or ran out of
// budget, and (b) drain anything that never got kicked. Runs every minute
// (vercel.json). Each tick processes ONE job for up to ~4 minutes; long jobs
// carry on across ticks via the persisted per-chunk progress.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Vercel sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is
  // set in the project env; reject anything else so this can't be triggered
  // by outsiders. (Left open only if CRON_SECRET isn't configured — dev.)
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ?job=<id> targets a specific job — that's how a run continues itself
  // (see kickImportWorker). Without it, take the oldest claimable job.
  const jobId = req.nextUrl.searchParams.get("job");
  const outcome = jobId
    ? await processImportJob(jobId, { budgetMs: 240_000, continueOnProgress: kickImportWorker })
    : await processNextImportJob(240_000);
  // A cron tick that finished one job with work left should also chain it.
  if (!jobId && outcome.status === "progress") kickImportWorker(outcome.jobId);
  return NextResponse.json(outcome);
}
