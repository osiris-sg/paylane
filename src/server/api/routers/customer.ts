import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { z } from "zod";
import { requireSendAccess } from "~/server/api/lib/sending-access";
import { aggregateByBucket } from "~/server/api/lib/time-series";
import { syncCustomerReceivers } from "~/server/api/lib/customer-routing";
import type { PrismaClient } from "@prisma/client";

export const customerRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });

      const where: Record<string, unknown> = {
        companyId: user.companyId,
      };

      if (input.search) {
        where.OR = [
          { name: { contains: input.search, mode: "insensitive" } },
          { email: { contains: input.search, mode: "insensitive" } },
          { company: { contains: input.search, mode: "insensitive" } },
        ];
      }

      const [customers, totalCount] = await Promise.all([
        ctx.db.customer.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          include: {
            _count: {
              select: { invoices: true },
            },
          },
        }),
        ctx.db.customer.count({ where }),
      ]);

      // Customers linked to a PayLane company can receive WhatsApp alerts
      // if at least one user there has opted in with a number on file.
      const linkedIds = customers
        .map((c) => c.linkedCompanyId)
        .filter((id): id is string => !!id);
      const whatsappEnabledIds = linkedIds.length
        ? new Set(
            (
              await ctx.db.user.findMany({
                where: {
                  companyId: { in: linkedIds },
                  whatsappOptIn: true,
                  whatsappNumber: { not: null },
                },
                select: { companyId: true },
              })
            ).map((u) => u.companyId),
          )
        : new Set<string>();

      return {
        customers: customers.map((c) => ({
          ...c,
          whatsappEnabled: c.linkedCompanyId
            ? whatsappEnabledIds.has(c.linkedCompanyId)
            : false,
        })),
        totalCount,
        totalPages: Math.ceil(totalCount / input.limit),
        page: input.page,
      };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });

      const customer = await ctx.db.customer.findUniqueOrThrow({
        where: { id: input.id, companyId: user.companyId },
        include: {
          _count: {
            select: { invoices: true },
          },
        },
      });

      return customer;
    }),

  /** Aging buckets for invoices sent to a specific customer (months outstanding). */
  getAgingData: protectedProcedure
    .input(z.object({ customerId: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });

      // Confirm ownership of the customer record.
      await ctx.db.customer.findUniqueOrThrow({
        where: { id: input.customerId, companyId: user.companyId },
        select: { id: true },
      });

      const invoices = await ctx.db.invoice.findMany({
        where: {
          senderCompanyId: user.companyId,
          customerId: input.customerId,
          invoiceStatus: { notIn: ["DRAFT", "CANCELLED"] },
        },
        select: { amount: true, invoicedDate: true },
      });

      const now = new Date();
      const buckets = [
        { label: "0-1", minMonths: 0, maxMonths: 0, count: 0, amount: 0 },
        { label: "1-2", minMonths: 1, maxMonths: 1, count: 0, amount: 0 },
        { label: "2-3", minMonths: 2, maxMonths: 2, count: 0, amount: 0 },
        { label: "3+", minMonths: 3, maxMonths: Infinity, count: 0, amount: 0 },
      ];

      for (const invoice of invoices) {
        const inv = new Date(invoice.invoicedDate);
        const monthsSinceInvoiced =
          (now.getFullYear() - inv.getFullYear()) * 12 +
          (now.getMonth() - inv.getMonth()) -
          (now.getDate() < inv.getDate() ? 1 : 0);
        const bucket = buckets.find(
          (b) => monthsSinceInvoiced >= b.minMonths && monthsSinceInvoiced <= b.maxMonths,
        );
        if (bucket) {
          bucket.count += 1;
          bucket.amount += Number(invoice.amount);
        }
      }

      return buckets.map(({ label, count, amount }) => ({ label, count, amount }));
    }),

  getTimeSeries: protectedProcedure
    .input(
      z.object({
        customerId: z.string(),
        granularity: z.enum(["daily", "weekly", "monthly"]).default("monthly"),
        from: z.coerce.date(),
        to: z.coerce.date(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });

      // Confirm the customer belongs to the caller's company.
      await ctx.db.customer.findUniqueOrThrow({
        where: { id: input.customerId, companyId: user.companyId },
        select: { id: true },
      });

      const invoices = await ctx.db.invoice.findMany({
        where: {
          senderCompanyId: user.companyId,
          customerId: input.customerId,
          invoicedDate: { gte: input.from, lte: input.to },
        },
        select: { invoicedDate: true, amount: true },
      });

      const series = aggregateByBucket(
        invoices,
        input.from,
        input.to,
        input.granularity,
      );
      const total = series.reduce((sum, s) => sum + s.amount, 0);

      return {
        granularity: input.granularity,
        from: input.from,
        to: input.to,
        series,
        total,
        invoiceCount: invoices.length,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        company: z.string().min(1), // Company name is now required
        name: z.string().optional(), // Contact name is optional
        email: z.string().email().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });
      await requireSendAccess(ctx.db, user.companyId);

      // The DB still requires `name` (legacy column). Fall back to company name when
      // the user didn't provide a contact name.
      const customer = await ctx.db.customer.create({
        data: {
          ...input,
          name: input.name?.trim() || input.company,
          companyId: user.companyId,
        },
      });

      return customer;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        company: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });
      await requireSendAccess(ctx.db, user.companyId);

      const { id, ...data } = input;

      // If the email is being changed, find the new linked company (if any)
      // and rewrite linkedCompanyId so future sends + historical rows match.
      let nextLinkedCompanyId: string | null | undefined = undefined;
      if (typeof data.email === "string") {
        const normalised = data.email.trim().toLowerCase();
        const matched = normalised
          ? await ctx.db.company.findFirst({
              where: { email: normalised },
              select: { id: true },
            })
          : null;
        nextLinkedCompanyId = matched?.id ?? null;
      }

      const customer = await ctx.db.customer.update({
        where: { id, companyId: user.companyId },
        data: {
          ...data,
          ...(nextLinkedCompanyId !== undefined
            ? { linkedCompanyId: nextLinkedCompanyId }
            : {}),
        },
      });

      // Whether the link changed or just stayed the same, ensure all the
      // customer's invoices + statements point at the current company.
      if (nextLinkedCompanyId !== undefined) {
        await syncCustomerReceivers(ctx.db as unknown as PrismaClient, id);
      }

      return customer;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });
      await requireSendAccess(ctx.db, user.companyId);

      await ctx.db.customer.delete({
        where: { id: input.id, companyId: user.companyId },
      });

      return { success: true };
    }),

  bulkCreate: protectedProcedure
    .input(
      z.object({
        customers: z
          .array(
            z.object({
              company: z.string().min(1),
              name: z.string().optional(),
              email: z.string().optional(),
              phone: z.string().optional(),
              address: z.string().optional(),
            }),
          )
          .min(1)
          .max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });
      await requireSendAccess(ctx.db, user.companyId);

      const result = await ctx.db.customer.createMany({
        data: input.customers.map((c) => ({
          company: c.company,
          name: c.name?.trim() || c.company,
          email: c.email?.trim() || null,
          phone: c.phone || null,
          address: c.address || null,
          companyId: user.companyId,
        })),
        skipDuplicates: true,
      });

      return { count: result.count };
    }),
});
