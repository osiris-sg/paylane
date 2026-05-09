import { TRPCError } from "@trpc/server";
import type { PrismaClient, SendingPlan } from "@prisma/client";

const TRIAL_DAYS = 14;

export type SendingPlanState = {
  plan: SendingPlan;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  daysRemaining: number | null;
};

/**
 * Reads the company's sending plan and lazily flips TRIAL → EXPIRED if the
 * end date has passed. Returns the (possibly updated) state.
 */
export async function loadSendingPlan(
  db: PrismaClient,
  companyId: string,
): Promise<SendingPlanState> {
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { sendingPlan: true, trialStartedAt: true, trialEndsAt: true },
  });

  let plan = company.sendingPlan;
  if (
    plan === "TRIAL" &&
    company.trialEndsAt &&
    company.trialEndsAt.getTime() <= Date.now()
  ) {
    await db.company.update({
      where: { id: companyId },
      data: { sendingPlan: "EXPIRED" },
    });
    plan = "EXPIRED";
  }

  const daysRemaining =
    plan === "TRIAL" && company.trialEndsAt
      ? Math.max(
          0,
          Math.ceil(
            (company.trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
          ),
        )
      : null;

  return {
    plan,
    trialStartedAt: company.trialStartedAt,
    trialEndsAt: company.trialEndsAt,
    daysRemaining,
  };
}

/**
 * Throws FORBIDDEN unless the company has active SEND access (TRIAL or PAID).
 * LOCKED and EXPIRED both block writes.
 */
export async function requireSendAccess(
  db: PrismaClient,
  companyId: string,
): Promise<void> {
  const { plan } = await loadSendingPlan(db, companyId);
  if (plan !== "TRIAL" && plan !== "PAID") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        plan === "EXPIRED"
          ? "Your free trial has ended. Upgrade to keep sending invoices."
          : "Start your free trial to send invoices.",
    });
  }
}

export const TRIAL_DURATION_DAYS = TRIAL_DAYS;
