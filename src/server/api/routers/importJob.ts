import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { requireSendAccess } from "~/server/api/lib/sending-access";
import { waitUntil } from "@vercel/functions";
import { kickImportWorker, processImportJob } from "~/server/import/worker";
import type { Contact } from "~/server/import/extract-contacts";

const kindSchema = z.enum(["CUSTOMERS", "SUPPLIERS"]);

export const importJobRouter = createTRPCRouter({
  /**
   * Queue a background import for a file already uploaded to S3 (via
   * storage.createUploadUrl → presigned PUT). Returns immediately, but the
   * worker starts RIGHT NOW (fire-and-forget via waitUntil) — the user never
   * waits for a cron tick. The every-minute cron only resumes/finishes jobs
   * this kick couldn't complete within one function's budget.
   */
  create: protectedProcedure
    .input(
      z.object({
        kind: kindSchema,
        fileKey: z.string().min(1),
        fileName: z.string().min(1),
        fileType: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      // Importing customers is a SEND-side feature (gated like customer.create);
      // suppliers can be imported by anyone.
      if (input.kind === "CUSTOMERS") await requireSendAccess(ctx.db, user.companyId);

      const job = await ctx.db.importJob.create({
        data: {
          kind: input.kind,
          companyId: user.companyId,
          createdById: user.id,
          fileKey: input.fileKey,
          fileName: input.fileName,
          fileType: input.fileType,
        },
        select: { id: true },
      });

      // Kick the worker immediately, without holding up this response.
      // waitUntil keeps the serverless invocation alive until the promise
      // settles (Vercel); locally it just runs in the background like SAS's
      // in-process fallback. Errors are already recorded on the job row.
      waitUntil(
        processImportJob(job.id, {
          budgetMs: 250_000,
          continueOnProgress: kickImportWorker,
        }).catch((err) =>
          console.error(`[import ${job.id}] kick-off failed:`, err),
        ),
      );
      return { id: job.id };
    }),

  /** Progress + result for one job. Polled by the import page while RUNNING. */
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const job = await ctx.db.importJob.findUnique({ where: { id: input.id } });
      if (!job || job.companyId !== ctx.user.companyId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return {
        ...job,
        result: (job.result as Contact[] | null) ?? null,
      };
    }),

  /** Recent jobs for this company, newest first (for an "in progress" list). */
  list: protectedProcedure
    .input(z.object({ kind: kindSchema.optional(), limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ ctx, input }) => {
      return ctx.db.importJob.findMany({
        where: { companyId: ctx.user.companyId, ...(input.kind ? { kind: input.kind } : {}) },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        select: {
          id: true,
          kind: true,
          status: true,
          fileName: true,
          pageCount: true,
          chunksTotal: true,
          chunksDone: true,
          error: true,
          createdAt: true,
          finishedAt: true,
        },
      });
    }),
});
