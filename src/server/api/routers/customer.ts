import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { z } from "zod";
import { clerkClient } from "@clerk/nextjs/server";

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

      // Snapshot the customer before delete so we can clean up Clerk too.
      const customer = await ctx.db.customer.findUniqueOrThrow({
        where: { id: input.id, companyId: user.companyId },
      });

      await ctx.db.customer.delete({
        where: { id: input.id, companyId: user.companyId },
      });

      // Best-effort Clerk cleanup. Only fires if (a) the customer had an email,
      // and (b) no other Customer record across the platform still references
      // that same email — otherwise we'd lock out someone another sender still
      // does business with. Deleting the Clerk user also deletes the local
      // User row by FK cascade (clerkId is unique), and any orphan Company
      // with no remaining Users gets deleted to keep the DB clean.
      if (customer.email) {
        const otherRefs = await ctx.db.customer.count({
          where: { email: customer.email, NOT: { id: customer.id } },
        });
        if (otherRefs === 0) {
          try {
            const dbUsers = await ctx.db.user.findMany({
              where: { email: customer.email },
              select: { id: true, clerkId: true, companyId: true },
            });
            const client = await clerkClient();
            for (const dbUser of dbUsers) {
              try {
                await client.users.deleteUser(dbUser.clerkId);
              } catch (err) {
                console.error(`[customer.delete] Failed to delete Clerk user ${dbUser.clerkId}:`, err);
              }
              await ctx.db.user.delete({ where: { id: dbUser.id } }).catch(() => {});
              const remaining = await ctx.db.user.count({ where: { companyId: dbUser.companyId } });
              if (remaining === 0) {
                await ctx.db.company.delete({ where: { id: dbUser.companyId } }).catch(() => {});
              }
            }
          } catch (err) {
            console.error("[customer.delete] Clerk cleanup failed:", err);
          }
        }
      }

      return { success: true };
    }),
});
