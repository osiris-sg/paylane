import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { requireSendAccess } from "~/server/api/lib/sending-access";
import { waitUntil } from "@vercel/functions";
import { kickImportWorker } from "~/server/import/worker";
import type { Contact } from "~/server/import/extract-contacts";
import type { StatementsResult } from "~/server/import/extract-statements";

const kindSchema = z.enum(["CUSTOMERS", "SUPPLIERS", "STATEMENTS"]);

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
      // Importing customers / sending statements are SEND-side features
      // (gated like customer.create); suppliers can be imported by anyone.
      if (input.kind !== "SUPPLIERS") await requireSendAccess(ctx.db, user.companyId);

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

      // Kick the worker immediately, without holding up this response. The
      // run itself happens in the worker route (maxDuration 300) — NOT in
      // this tRPC invocation, whose default timeout would kill a chunk
      // mid-way. waitUntil keeps this invocation alive just long enough for
      // the kick request to be dispatched.
      waitUntil(kickImportWorker(job.id));
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
        result: (job.result as Contact[] | StatementsResult | null) ?? null,
      };
    }),

  /**
   * STATEMENTS: the user confirmed the review screen. Record per-segment
   * decisions, flip to SENDING, and kick the worker so sending starts now.
   */
  startStatementSend: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        decisions: z
          .array(
            z.object({
              index: z.number().int().min(0),
              action: z.enum(["send", "skip"]),
              /** Existing customer to send to; null = create from the statement. */
              customerId: z.string().nullable().optional(),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      await requireSendAccess(ctx.db, user.companyId);
      const job = await ctx.db.importJob.findUnique({ where: { id: input.id } });
      if (!job || job.companyId !== user.companyId || job.kind !== "STATEMENTS") {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (job.status !== "REVIEW") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `This run is ${job.status.toLowerCase()}, not awaiting review.` });
      }
      const result = job.result as StatementsResult | null;
      if (!result?.segments?.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to send." });
      }

      // Chosen customers must belong to this company.
      const chosen = input.decisions
        .map((d) => d.customerId)
        .filter((id): id is string => !!id);
      if (chosen.length) {
        const owned = await ctx.db.customer.count({
          where: { id: { in: chosen }, companyId: user.companyId },
        });
        if (owned !== new Set(chosen).size) {
          throw new TRPCError({ code: "FORBIDDEN", message: "One of the chosen customers isn't yours." });
        }
      }

      const byIndex = new Map(input.decisions.map((d) => [d.index, d]));
      for (const seg of result.segments) {
        const d = byIndex.get(seg.index);
        seg.decision =
          !d || d.action === "skip"
            ? { action: "skip" }
            : { action: "send", customerId: d.customerId ?? null };
        seg.status = "pending";
      }
      const sendTotal = result.segments.filter((s) => s.decision?.action === "send").length;
      if (sendTotal === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Every statement is marked skip — nothing to send." });
      }

      await ctx.db.importJob.update({
        where: { id: job.id },
        data: {
          status: "SENDING",
          result: result as unknown as object,
          sendTotal,
          sendDone: 0,
          lockedAt: null,
          error: null,
        },
      });
      // Same as create: run in the worker route, not here.
      waitUntil(kickImportWorker(job.id));
      return { sendTotal };
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
