import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

/**
 * Suppliers are stored in their own table (mirrors Customer) and ALSO
 * lazily synced from received invoices: any senderCompany on a received
 * invoice that doesn't yet have a Supplier row gets one auto-created.
 * This way the user can add suppliers manually but never has to think
 * about adding the ones that already invoice them.
 */
async function syncSuppliersFromInvoices(db: PrismaClient, ownerCompanyId: string) {
  const senders = await db.invoice.findMany({
    where: { receiverCompanyId: ownerCompanyId },
    select: { senderCompanyId: true },
    distinct: ["senderCompanyId"],
  });

  if (senders.length === 0) return;

  const senderIds = senders.map((s) => s.senderCompanyId);

  const existing = await db.supplier.findMany({
    where: { companyId: ownerCompanyId, linkedCompanyId: { in: senderIds } },
    select: { linkedCompanyId: true },
  });
  const existingIds = new Set(existing.map((s) => s.linkedCompanyId));

  const missing = senderIds.filter((id) => !existingIds.has(id));
  if (missing.length === 0) return;

  const senderCompanies = await db.company.findMany({
    where: { id: { in: missing } },
    select: { id: true, name: true, email: true, phone: true, address: true },
  });

  await db.supplier.createMany({
    data: senderCompanies.map((c) => ({
      companyId: ownerCompanyId,
      linkedCompanyId: c.id,
      name: c.name,
      company: c.name,
      email: c.email,
      phone: c.phone,
      address: c.address,
    })),
    skipDuplicates: true,
  });
}

export const supplierRouter = createTRPCRouter({
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

      await syncSuppliersFromInvoices(ctx.db as unknown as PrismaClient, user.companyId);

      const where: Record<string, unknown> = { companyId: user.companyId };
      if (input.search) {
        where.OR = [
          { name: { contains: input.search, mode: "insensitive" } },
          { email: { contains: input.search, mode: "insensitive" } },
          { company: { contains: input.search, mode: "insensitive" } },
        ];
      }

      const [suppliers, totalCount] = await Promise.all([
        ctx.db.supplier.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        ctx.db.supplier.count({ where }),
      ]);

      // Compute received-invoice counts per linkedCompanyId in one query
      const linkedIds = suppliers.map((s) => s.linkedCompanyId).filter(Boolean) as string[];
      const counts = linkedIds.length
        ? await ctx.db.invoice.groupBy({
            by: ["senderCompanyId"],
            where: {
              receiverCompanyId: user.companyId,
              senderCompanyId: { in: linkedIds },
            },
            _count: { _all: true },
          })
        : [];
      const countById = new Map(counts.map((c) => [c.senderCompanyId, c._count._all]));

      return {
        suppliers: suppliers.map((s) => ({
          ...s,
          invoiceCount: s.linkedCompanyId ? countById.get(s.linkedCompanyId) ?? 0 : 0,
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

      const supplier = await ctx.db.supplier.findUniqueOrThrow({
        where: { id: input.id, companyId: user.companyId },
      });

      const invoiceCount = supplier.linkedCompanyId
        ? await ctx.db.invoice.count({
            where: {
              receiverCompanyId: user.companyId,
              senderCompanyId: supplier.linkedCompanyId,
            },
          })
        : 0;

      return { ...supplier, invoiceCount };
    }),

  getByLinkedCompanyId: protectedProcedure
    .input(z.object({ linkedCompanyId: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });

      return ctx.db.supplier.findFirst({
        where: {
          companyId: user.companyId,
          linkedCompanyId: input.linkedCompanyId,
        },
        select: { id: true, name: true, company: true, linkedCompanyId: true },
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        company: z.string().min(1),
        name: z.string().optional(),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().optional(),
        address: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });

      return ctx.db.supplier.create({
        data: {
          company: input.company,
          name: input.name?.trim() || input.company,
          email: input.email?.trim() || null,
          phone: input.phone || null,
          address: input.address || null,
          companyId: user.companyId,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        email: z.string().email().optional().or(z.literal("")),
        phone: z.string().optional(),
        address: z.string().optional(),
        company: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });

      const { id, ...data } = input;

      return ctx.db.supplier.update({
        where: { id, companyId: user.companyId },
        data,
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });

      await ctx.db.supplier.delete({
        where: { id: input.id, companyId: user.companyId },
      });

      return { success: true };
    }),

  bulkCreate: protectedProcedure
    .input(
      z.object({
        suppliers: z
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

      const result = await ctx.db.supplier.createMany({
        data: input.suppliers.map((s) => ({
          company: s.company,
          name: s.name?.trim() || s.company,
          email: s.email?.trim() || null,
          phone: s.phone || null,
          address: s.address || null,
          companyId: user.companyId,
        })),
        skipDuplicates: true,
      });

      return { count: result.count };
    }),
});
