import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  loadSendingPlan,
  TRIAL_DURATION_DAYS,
} from "~/server/api/lib/sending-access";

export const subscriptionRouter = createTRPCRouter({
  /** Current sending-plan state for the caller's company. */
  getStatus: protectedProcedure.query(({ ctx }) =>
    loadSendingPlan(ctx.db, ctx.user.companyId),
  ),

  /** LOCKED → TRIAL. Sets trial dates 14 days out. */
  startTrial: protectedProcedure.mutation(async ({ ctx }) => {
    const { plan } = await loadSendingPlan(ctx.db, ctx.user.companyId);

    if (plan !== "LOCKED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          plan === "TRIAL"
            ? "Trial already active."
            : plan === "PAID"
              ? "You already have full access."
              : "Trial already used. Upgrade to continue.",
      });
    }

    const now = new Date();
    const ends = new Date(
      now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000,
    );

    await ctx.db.company.update({
      where: { id: ctx.user.companyId },
      data: {
        sendingPlan: "TRIAL",
        trialStartedAt: now,
        trialEndsAt: ends,
      },
    });

    return loadSendingPlan(ctx.db, ctx.user.companyId);
  }),
});
