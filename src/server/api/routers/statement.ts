import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { persistAndDispatch } from "~/server/statements/send";
import { requireSendAccess } from "~/server/api/lib/sending-access";
import { resolveFileUrl, isInlineOrExternal, presignDownload } from "~/lib/storage";


const sendInput = z.object({
  customerId: z.string(),
  fileDataUrl: z.string().min(1, "File is required"),
  fileName: z.string().min(1),
  fileType: z.string().min(1),
  notes: z.string().optional(),
});


export const statementRouter = createTRPCRouter({
  /** Send (or replace) the latest statement for a single customer. */
  sendToCustomer: protectedProcedure
    .input(sendInput)
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      await requireSendAccess(ctx.db, user.companyId);

      return persistAndDispatch({
        ctx: { db: ctx.db as unknown as typeof import("~/lib/db").db },
        user,
        ...input,
      });
    }),

  /**
   * Bulk send. The client passes an array of items already matched to
   * customers (the matching can be AI-driven, manual, or both); the
   * server treats each row independently and returns per-row results.
   */
  bulkSend: protectedProcedure
    .input(
      z.object({
        items: z.array(sendInput).min(1).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      await requireSendAccess(ctx.db, user.companyId);

      const results: Array<
        | { customerId: string; status: "sent"; statementId: string }
        | { customerId: string; status: "error"; message: string }
      > = [];

      for (const item of input.items) {
        try {
          const stmt = await persistAndDispatch({
            ctx: { db: ctx.db as unknown as typeof import("~/lib/db").db },
            user,
            ...item,
          });
          results.push({
            customerId: item.customerId,
            status: "sent",
            statementId: stmt.id,
          });
        } catch (err) {
          results.push({
            customerId: item.customerId,
            status: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }
      return { results };
    }),

  /** Sender: latest statement they've sent to a specific customer (if any). */
  getForCustomer: protectedProcedure
    .input(z.object({ customerId: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = ctx.user;
      await ctx.db.customer.findUniqueOrThrow({
        where: { id: input.customerId, companyId: user.companyId },
        select: { id: true },
      });
      const stmt = await ctx.db.statement.findUnique({
        where: { customerId: input.customerId },
      });
      return stmt
        ? { ...stmt, fileUrl: await resolveFileUrl(stmt.fileUrl) }
        : null;
    }),

  /** Receiver: latest statement received from a specific supplier company. */
  getFromSupplierCompany: protectedProcedure
    .input(z.object({ senderCompanyId: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = ctx.user;
      const stmt = await ctx.db.statement.findFirst({
        where: {
          receiverCompanyId: user.companyId,
          senderCompanyId: input.senderCompanyId,
        },
        orderBy: { sentAt: "desc" },
        include: { senderCompany: { select: { name: true } } },
      });
      return stmt
        ? { ...stmt, fileUrl: await resolveFileUrl(stmt.fileUrl) }
        : null;
    }),

  /** Badge counts for the CUSTOMER + SUPPLIER tabs on /statements. */
  getTabCounts: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user;
    const [unviewedByRecipient, unviewedByMe] = await Promise.all([
      ctx.db.statement.count({
        where: { senderCompanyId: user.companyId, viewedAt: null },
      }),
      ctx.db.statement.count({
        where: { receiverCompanyId: user.companyId, viewedAt: null },
      }),
    ]);
    return { unviewedByRecipient, unviewedByMe };
  }),

  /** Sender: list every statement they've sent (one per customer). */
  listSent: protectedProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(10),
        search: z.string().optional(),
        customerId: z.string().optional(),
        dateFrom: z.coerce.date().optional(),
        dateTo: z.coerce.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const user = ctx.user;

      const where: Record<string, unknown> = { senderCompanyId: user.companyId };
      if (input.customerId) where.customerId = input.customerId;
      if (input.dateFrom || input.dateTo) {
        where.sentAt = {
          ...(input.dateFrom ? { gte: input.dateFrom } : {}),
          ...(input.dateTo ? { lte: input.dateTo } : {}),
        };
      }
      if (input.search) {
        where.OR = [
          { fileName: { contains: input.search, mode: "insensitive" } },
          { notes: { contains: input.search, mode: "insensitive" } },
          { customer: { name: { contains: input.search, mode: "insensitive" } } },
          { customer: { company: { contains: input.search, mode: "insensitive" } } },
          { customer: { email: { contains: input.search, mode: "insensitive" } } },
        ];
      }

      const [rows, totalCount] = await Promise.all([
        ctx.db.statement.findMany({
          where,
          orderBy: { sentAt: "desc" },
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          include: {
            customer: {
              select: { id: true, company: true, name: true, email: true },
            },
            receiverCompany: { select: { id: true, name: true } },
          },
        }),
        ctx.db.statement.count({ where }),
      ]);

      const statements = await Promise.all(
        rows.map(async (s) => ({ ...s, fileUrl: await resolveFileUrl(s.fileUrl) })),
      );
      return {
        statements,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / input.limit)),
        page: input.page,
      };
    }),

  /** Receiver: paginated incoming statements (one per supplier). */
  listIncoming: protectedProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(10),
        search: z.string().optional(),
        supplierId: z.string().optional(),
        dateFrom: z.coerce.date().optional(),
        dateTo: z.coerce.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const user = ctx.user;

      const where: Record<string, unknown> = { receiverCompanyId: user.companyId };
      if (input.supplierId) where.senderCompanyId = input.supplierId;
      if (input.dateFrom || input.dateTo) {
        where.sentAt = {
          ...(input.dateFrom ? { gte: input.dateFrom } : {}),
          ...(input.dateTo ? { lte: input.dateTo } : {}),
        };
      }
      if (input.search) {
        where.OR = [
          { fileName: { contains: input.search, mode: "insensitive" } },
          { notes: { contains: input.search, mode: "insensitive" } },
          { senderCompany: { name: { contains: input.search, mode: "insensitive" } } },
        ];
      }

      const [rows, totalCount] = await Promise.all([
        ctx.db.statement.findMany({
          where,
          orderBy: { sentAt: "desc" },
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          include: { senderCompany: { select: { id: true, name: true } } },
        }),
        ctx.db.statement.count({ where }),
      ]);

      const statements = await Promise.all(
        rows.map(async (s) => ({ ...s, fileUrl: await resolveFileUrl(s.fileUrl) })),
      );
      return {
        statements,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / input.limit)),
        page: input.page,
      };
    }),

  /** Distinct customers that have a sent statement — for the filter dropdown. */
  sentCustomers: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user;
    const rows = await ctx.db.statement.findMany({
      where: { senderCompanyId: user.companyId },
      select: { customer: { select: { id: true, name: true, company: true } } },
      orderBy: { customer: { name: "asc" } },
    });
    return rows.map((r) => r.customer);
  }),

  /** Distinct suppliers that have sent a statement — for the filter dropdown. */
  incomingSuppliers: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user;
    const rows = await ctx.db.statement.findMany({
      where: { receiverCompanyId: user.companyId },
      select: { senderCompany: { select: { id: true, name: true } } },
      distinct: ["senderCompanyId"],
      orderBy: { senderCompanyId: "asc" },
    });
    return rows.map((r) => r.senderCompany);
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = ctx.user;
      const stmt = await ctx.db.statement.findUnique({
        where: { id: input.id },
        include: {
          senderCompany: { select: { id: true, name: true } },
          customer: { select: { id: true, company: true, name: true } },
          timelineItems: true,
        },
      });
      if (
        !stmt ||
        (stmt.senderCompanyId !== user.companyId &&
          stmt.receiverCompanyId !== user.companyId)
      ) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return { ...stmt, fileUrl: await resolveFileUrl(stmt.fileUrl) };
    }),

  /** Download the statement file — presigned with attachment disposition for S3
   *  keys, passthrough for legacy inline/data URLs. Sender or receiver only. */
  getDownloadUrl: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = ctx.user;
      const stmt = await ctx.db.statement.findUnique({
        where: { id: input.id },
        select: {
          fileUrl: true,
          fileName: true,
          senderCompanyId: true,
          receiverCompanyId: true,
        },
      });
      if (
        !stmt ||
        (stmt.senderCompanyId !== user.companyId &&
          stmt.receiverCompanyId !== user.companyId)
      ) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const filename =
        stmt.fileName.replace(/[^a-zA-Z0-9._ -]+/g, "-") || "statement.pdf";

      if (isInlineOrExternal(stmt.fileUrl)) {
        return { url: stmt.fileUrl, filename };
      }
      const url = await presignDownload(stmt.fileUrl, 300, { filename });
      return { url, filename };
    }),

  markViewed: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      const stmt = await ctx.db.statement.findUnique({
        where: { id: input.id },
        select: { id: true, receiverCompanyId: true, viewedAt: true },
      });
      if (!stmt || stmt.receiverCompanyId !== user.companyId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (stmt.viewedAt) return stmt;
      const updated = await ctx.db.statement.update({
        where: { id: input.id },
        data: { viewedAt: new Date() },
      });
      await ctx.db.timelineItem.create({
        data: { statementId: input.id, message: "Statement viewed by receiver" },
      });
      return updated;
    }),

  /**
   * Sender: bulk-delete statements they've sent. Scoped to the caller's own
   * sent rows (senderCompanyId), so a caller can never delete a statement they
   * only received. Gated by send access like the other sender-side mutations.
   */
  bulkDelete: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      await requireSendAccess(ctx.db, user.companyId);
      const { count } = await ctx.db.statement.deleteMany({
        where: { id: { in: input.ids }, senderCompanyId: user.companyId },
      });
      return { success: true, count };
    }),
});
