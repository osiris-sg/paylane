import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { clerkClient } from "@clerk/nextjs/server";

const ADMIN_ORG_ID = "org_3BTjr0BA636FoYmKG7w1uM66zRo";

/**
 * Check if the current Clerk user belongs to the admins organization.
 */
async function isAdmin(clerkUserId: string): Promise<boolean> {
  try {
    const client = await clerkClient();
    const memberships = await client.users.getOrganizationMembershipList({
      userId: clerkUserId,
    });

    return memberships.data.some(
      (m) => m.organization.id === ADMIN_ORG_ID,
    );
  } catch {
    return false;
  }
}

export const adminRouter = createTRPCRouter({
  /** Check if current user is admin */
  isAdmin: protectedProcedure.query(async ({ ctx }) => {
    return { isAdmin: await isAdmin(ctx.auth.userId) };
  }),

  /** List all companies with their users and module */
  listCompanies: protectedProcedure.query(async ({ ctx }) => {
    if (!(await isAdmin(ctx.auth.userId))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
    }

    return ctx.db.company.findMany({
      include: {
        users: { select: { id: true, email: true, name: true } },
        _count: {
          select: {
            customers: true,
            sentInvoices: true,
            receivedInvoices: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }),

  /** Set module for a company */
  setModule: protectedProcedure
    .input(
      z.object({
        companyId: z.string(),
        module: z.enum(["RECEIVE", "SEND", "BOTH"]).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await isAdmin(ctx.auth.userId))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }

      return ctx.db.company.update({
        where: { id: input.companyId },
        data: { module: input.module },
      });
    }),

  /** Override sending plan (LOCKED / TRIAL / PAID / EXPIRED) for a company */
  setSendingPlan: protectedProcedure
    .input(
      z.object({
        companyId: z.string(),
        plan: z.enum(["LOCKED", "TRIAL", "PAID", "EXPIRED"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await isAdmin(ctx.auth.userId))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }

      // When manually starting a TRIAL, set the 14-day window. Other plans clear it.
      const now = new Date();
      const trialDates =
        input.plan === "TRIAL"
          ? {
              trialStartedAt: now,
              trialEndsAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
            }
          : input.plan === "PAID" || input.plan === "LOCKED"
            ? { trialStartedAt: null, trialEndsAt: null }
            : {}; // EXPIRED: keep dates as-is

      return ctx.db.company.update({
        where: { id: input.companyId },
        data: { sendingPlan: input.plan, ...trialDates },
      });
    }),
});
