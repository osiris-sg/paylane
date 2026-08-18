import { NonRetriableError } from "inngest";
import { inngest } from "../client";
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
 * Background contact import.
 *
 * Every chunk is its own `step.run`, which Inngest memoises: if chunk 3 of 5
 * throws, only chunk 3 retries — the others' results are replayed from the
 * step log rather than re-extracted (and re-billed). Progress is written to
 * the job row after each chunk so the import page can show it live.
 *
 * Steps must be self-contained (closure state is lost on replay), so each
 * step re-fetches the file bytes from S3 rather than sharing them.
 */
export const importContacts = inngest.createFunction(
  {
    id: "import-contacts",
    retries: 3,
    concurrency: [{ key: "event.data.jobId", limit: 1 }],
    triggers: [{ event: "import/contacts.requested" }],
    onFailure: async ({ event, error }) => {
      // All retries exhausted — mark the job failed and tell the user.
      const jobId = (event.data.event.data as { jobId: string }).jobId;
      await failJob(jobId, error.message || "Extraction failed");
    },
  },
  async ({ event, step }) => {
    const { jobId } = event.data as { jobId: string };

    // 1. Load + plan --------------------------------------------------------
    const plan = await step.run("plan", async () => {
      const job = await db.importJob.findUnique({ where: { id: jobId } });
      if (!job) throw new NonRetriableError(`Import job ${jobId} not found`);
      if (job.status === "DONE" || job.status === "FAILED") {
        return { skip: true as const };
      }

      const bytes = await getObjectBuffer(job.fileKey);
      const sheet = isSpreadsheet(job.fileName, job.fileType);
      const isPdf =
        job.fileType === "application/pdf" || job.fileName.toLowerCase().endsWith(".pdf");
      const pageCount = isPdf ? await pdfPageCount(bytes) : null;
      const chunksTotal = sheet
        ? 1
        : isPdf
          ? Math.max(1, Math.ceil((pageCount ?? 1) / MAX_PAGES_PER_CHUNK))
          : 1;

      await db.importJob.update({
        where: { id: jobId },
        data: {
          status: "RUNNING",
          startedAt: new Date(),
          pageCount,
          chunksTotal,
          chunksDone: 0,
          error: null,
        },
      });

      return { skip: false as const, sheet, isPdf, chunksTotal, fileType: job.fileType };
    });

    if (plan.skip) return { skipped: true };

    // 2. Extract — one durable step per chunk ----------------------------------
    const results: Contact[][] = [];
    for (let i = 0; i < plan.chunksTotal; i++) {
      const contacts = await step.run(`extract-chunk-${i + 1}`, async () => {
        const job = await db.importJob.findUniqueOrThrow({ where: { id: jobId } });
        const bytes = await getObjectBuffer(job.fileKey);

        let out: Contact[];
        if (plan.sheet) {
          out = await extractFromSpreadsheet(Buffer.from(bytes));
        } else if (plan.isPdf) {
          const chunks = await splitPdf(bytes, MAX_PAGES_PER_CHUNK);
          const chunk = chunks[i];
          if (!chunk) throw new NonRetriableError(`Chunk ${i + 1} out of range`);
          console.log(
            `[import ${jobId}] chunk ${i + 1}/${plan.chunksTotal} pages ${chunk.from}-${chunk.to}`,
          );
          out = await extractFromDocument(chunk.bytes, "application/pdf");
        } else {
          out = await extractFromDocument(bytes, imageMediaType(plan.fileType));
        }

        await db.importJob.update({ where: { id: jobId }, data: { chunksDone: i + 1 } });
        return out;
      });
      results.push(contacts);
    }

    // 3. Merge + finish + notify -----------------------------------------------
    return step.run("finish", async () => {
      const merged = mergeContacts(results);
      const job = await db.importJob.update({
        where: { id: jobId },
        data: {
          status: "DONE",
          finishedAt: new Date(),
          result: merged as unknown as object,
          chunksDone: plan.chunksTotal,
        },
        select: { id: true, kind: true, companyId: true, createdById: true, fileName: true },
      });

      const kindLabel = job.kind === "CUSTOMERS" ? "customers" : "suppliers";
      const url = `/${kindLabel}/import?job=${job.id}`;
      const message = `Your ${kindLabel} import (${job.fileName}) is ready to review — ${merged.length} contact${merged.length === 1 ? "" : "s"} found`;

      await db.notification.create({
        data: { message, type: "IMPORT_READY", userId: job.createdById, importJobId: job.id },
      });
      void sendPushToCompany(job.companyId, {
        title: "Import ready to review",
        body: message,
        url,
        tag: `import-${job.id}`,
      });
      return { contacts: merged.length };
    });
  },
);

async function failJob(jobId: string, message: string) {
  const job = await db.importJob.update({
    where: { id: jobId },
    data: { status: "FAILED", finishedAt: new Date(), error: message },
    select: { id: true, kind: true, companyId: true, createdById: true, fileName: true },
  });
  const kindLabel = job.kind === "CUSTOMERS" ? "customers" : "suppliers";
  const text = `Your ${kindLabel} import (${job.fileName}) couldn't be processed: ${message}`;
  await db.notification.create({
    data: { message: text, type: "IMPORT_FAILED", userId: job.createdById, importJobId: job.id },
  });
  void sendPushToCompany(job.companyId, {
    title: "Import failed",
    body: text,
    url: `/${kindLabel}/import?job=${job.id}`,
    tag: `import-${job.id}`,
  });
}
