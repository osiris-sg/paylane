import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { clerkClient } from "@clerk/nextjs/server";
import { FEATURE_FLAGS, FEATURE_FLAG_KEYS, type FeatureFlagKey } from "~/lib/feature-flags";

export { FEATURE_FLAGS, FEATURE_FLAG_KEYS, type FeatureFlagKey };

const ADMIN_ORG_ID = "org_3BTjr0BA636FoYmKG7w1uM66zRo";

async function isAdmin(clerkUserId: string): Promise<boolean> {
  try {
    const client = await clerkClient();
    const memberships = await client.users.getOrganizationMembershipList({
      userId: clerkUserId,
    });
    return memberships.data.some((m) => m.organization.id === ADMIN_ORG_ID);
  } catch {
    return false;
  }
}

export const featureFlagRouter = createTRPCRouter({
  /** Any authenticated user can read flag values so the UI can gate actions. */
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.featureFlag.findMany();
    const stored = new Map(rows.map((r) => [r.key, r.enabled]));
    const result = {} as Record<FeatureFlagKey, boolean>;
    for (const key of FEATURE_FLAG_KEYS) {
      result[key] = stored.get(key) ?? FEATURE_FLAGS[key].defaultEnabled;
    }
    return result;
  }),

  /** Admin only: toggle a feature flag on or off. */
  set: protectedProcedure
    .input(z.object({ key: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await isAdmin(ctx.auth.userId))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      if (!FEATURE_FLAG_KEYS.includes(input.key as FeatureFlagKey)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown feature flag: ${input.key}` });
      }
      return ctx.db.featureFlag.upsert({
        where: { key: input.key },
        create: { key: input.key, enabled: input.enabled },
        update: { enabled: input.enabled },
      });
    }),
});
