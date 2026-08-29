import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { requireSendAccess } from "~/server/api/lib/sending-access";
import { aggregateByBucket } from "~/server/api/lib/time-series";
import { syncCustomerReceivers } from "~/server/api/lib/customer-routing";
import type { PrismaClient } from "@prisma/client";

/** ISO 4217 code, normalised. Defaults to SGD when omitted. */
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code")
  .default("SGD");

/**
 * Customer identity is (owner company, business name, currency). The same
 * business billed in two currencies is two records; the same name in the
 * same currency is a duplicate. Matched case-insensitively on `company`
 * (falling back to `name` for legacy rows that only set `name`).
 */
async function findDuplicateCustomer(
  db: PrismaClient,
  companyId: string,
  business: string,
  currency: string,
  excludeId?: string,
) {
  return db.customer.findFirst({
    where: {
      companyId,
      currency,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [
        { company: { equals: business, mode: "insensitive" } },
        { company: null, name: { equals: business, mode: "insensitive" } },
      ],
    },
    select: { id: true, company: true, name: true },
  });
}

function duplicateError(business: string, currency: string) {
  return new TRPCError({
    code: "CONFLICT",
    message: `"${business}" already exists as a ${currency} customer. Pick a different currency or edit the existing one.`,
  });
}

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
      const user = ctx.user;

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
            statement: { select: { sentAt: true } },
          },
        }),
        ctx.db.customer.count({ where }),
      ]);

      // Customers linked to a E-StatementNow company can receive WhatsApp alerts
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
      const user = ctx.user;

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
      const user = ctx.user;

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
      z
        .object({
          company: z.string().min(1), // Company name is now required
          name: z.string().optional(), // Contact name is optional
          email: z.string().email().optional(),
          phone: z.string().optional(),
          address: z.string().optional(),
          currency: currencySchema,
        })
        // At least one contact channel is required: an off-platform customer
        // can only be reached by email or by WhatsApp (phone).
        .refine((d) => !!(d.email?.trim() || d.phone?.trim()), {
          message: "Add an email or phone so the customer can be reached",
          path: ["email"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      await requireSendAccess(ctx.db, user.companyId);

      const business = input.company.trim();
      if (await findDuplicateCustomer(ctx.db as unknown as PrismaClient, user.companyId, business, input.currency)) {
        throw duplicateError(business, input.currency);
      }

      // The DB still requires `name` (legacy column). Fall back to company name when
      // the user didn't provide a contact name.
      const customer = await ctx.db.customer.create({
        data: {
          ...input,
          company: business,
          name: input.name?.trim() || business,
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
        currency: currencySchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      await requireSendAccess(ctx.db, user.companyId);

      const { id, ...data } = input;

      // Renaming or re-currencying must not collide with another customer.
      if (data.company !== undefined || data.currency !== undefined) {
        const current = await ctx.db.customer.findUniqueOrThrow({
          where: { id, companyId: user.companyId },
          select: { company: true, name: true, currency: true },
        });
        const business = (data.company ?? current.company ?? current.name).trim();
        const currency = data.currency ?? current.currency;
        if (await findDuplicateCustomer(ctx.db as unknown as PrismaClient, user.companyId, business, currency, id)) {
          throw duplicateError(business, currency);
        }
      }

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
      const user = ctx.user;
      await requireSendAccess(ctx.db, user.companyId);

      await ctx.db.customer.delete({
        where: { id: input.id, companyId: user.companyId },
      });

      return { success: true };
    }),

  bulkDelete: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      await requireSendAccess(ctx.db, user.companyId);

      // Tenant-scoped: only rows this company owns are ever touched.
      const { count } = await ctx.db.customer.deleteMany({
        where: { id: { in: input.ids }, companyId: user.companyId },
      });

      return { count };
    }),

  bulkCreate: protectedProcedure
    .input(
      z.object({
        customers: z
          .array(
            z
              .object({
                company: z.string().min(1),
                name: z.string().optional(),
                email: z.string().optional(),
                phone: z.string().optional(),
                address: z.string().optional(),
                currency: currencySchema,
              })
              // Same reachability rule as single create — every imported
              // customer needs an email or phone.
              .refine((c) => !!(c.email?.trim() || c.phone?.trim()), {
                message: "Each customer needs an email or phone",
                path: ["email"],
              }),
          )
          .min(1)
          .max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      await requireSendAccess(ctx.db, user.companyId);

      // Skip rows that already exist as (name, currency) for this company —
      // and de-dupe within the batch itself — so a re-import never doubles up.
      const existing = await ctx.db.customer.findMany({
        where: { companyId: user.companyId },
        select: { company: true, name: true, currency: true },
      });
      const key = (business: string, currency: string) =>
        `${business.trim().toLowerCase()}|${currency}`;
      const seen = new Set(existing.map((c) => key(c.company ?? c.name, c.currency)));

      const fresh = input.customers.filter((c) => {
        const k = key(c.company, c.currency);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      const result = await ctx.db.customer.createMany({
        data: fresh.map((c) => ({
          company: c.company.trim(),
          name: c.name?.trim() || c.company.trim(),
          email: c.email?.trim() || null,
          phone: c.phone || null,
          address: c.address || null,
          currency: c.currency,
          companyId: user.companyId,
        })),
        skipDuplicates: true,
      });

      return { count: result.count, skipped: input.customers.length - fresh.length };
    }),
});
