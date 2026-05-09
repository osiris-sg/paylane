import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { z } from "zod";
import { requireSendAccess } from "~/server/api/lib/sending-access";

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

      return {
        customers,
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

      const customer = await ctx.db.customer.update({
        where: { id, companyId: user.companyId },
        data,
      });

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
