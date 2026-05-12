import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { env } from "~/env";
import { TRPCError } from "@trpc/server";

function generateInboundToken(): string {
  // Short, URL-safe, hard to guess. ~62^10 keyspace is plenty for our user base.
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "co_";
  for (let i = 0; i < 10; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function buildForwardingAddress(token: string): string | null {
  const base = env.CLOUDMAILIN_INBOUND_ADDRESS;
  if (!base) return null;
  const [local, domain] = base.split("@");
  if (!local || !domain) return null;
  return `${local}+${token}@${domain}`;
}

export const emailIntegrationRouter = createTRPCRouter({
  get: protectedProcedure.query(async ({ ctx }) => {
    const companyId = ctx.user.companyId;

    let integration = await ctx.db.emailIntegration.findUnique({
      where: { companyId },
    });

    if (!integration) {
      // Race-safe create — if two concurrent calls happen, the second falls back to the existing row.
      try {
        integration = await ctx.db.emailIntegration.create({
          data: { companyId, inboundToken: generateInboundToken() },
        });
      } catch {
        integration = await ctx.db.emailIntegration.findUnique({ where: { companyId } });
      }
    }

    if (!integration) {
      // Should be impossible at this point; keeps TS happy.
      throw new Error("Failed to provision EmailIntegration");
    }

    return {
      id: integration.id,
      status: integration.status,
      provider: integration.provider,
      providerEmail: integration.providerEmail,
      inboundToken: integration.inboundToken,
      forwardingAddress: buildForwardingAddress(integration.inboundToken),
      configured: env.CLOUDMAILIN_INBOUND_ADDRESS != null,
    };
  }),

  recentIngested: protectedProcedure.query(async ({ ctx }) => {
    const companyId = ctx.user.companyId;
    const integration = await ctx.db.emailIntegration.findUnique({
      where: { companyId },
      include: {
        ingestedEmails: {
          orderBy: { receivedAt: "desc" },
          take: 20,
          include: {
            invoice: { select: { id: true, invoiceNumber: true } },
          },
        },
      },
    });
    return integration?.ingestedEmails ?? [];
  }),

  // Latest unresolved Gmail/Outlook forwarding-confirmation email, if any —
  // used to render a prominent "Click to verify" banner at the top of the page.
  // Prefer the most recent row that has either a link or code already extracted;
  // fall back to the most recent CONFIRMATION row so we can at least show the body.
  pendingConfirmation: protectedProcedure.query(async ({ ctx }) => {
    const companyId = ctx.user.companyId;
    const integration = await ctx.db.emailIntegration.findUnique({
      where: { companyId },
    });
    if (!integration) return null;

    const extracted = await ctx.db.ingestedEmail.findFirst({
      where: {
        emailIntegrationId: integration.id,
        status: "CONFIRMATION",
        OR: [{ confirmationLink: { not: null } }, { confirmationCode: { not: null } }],
      },
      orderBy: { receivedAt: "desc" },
    });
    if (extracted) return extracted;

    return ctx.db.ingestedEmail.findFirst({
      where: { emailIntegrationId: integration.id, status: "CONFIRMATION" },
      orderBy: { receivedAt: "desc" },
    });
  }),

  // Dismiss every outstanding CONFIRMATION email for the company. Called after
  // the user has clicked through the Gmail verify link — Google doesn't call
  // us back when forwarding is approved, so we rely on a manual "done" click.
  dismissConfirmations: protectedProcedure.mutation(async ({ ctx }) => {
    const companyId = ctx.user.companyId;
    const integration = await ctx.db.emailIntegration.findUnique({
      where: { companyId },
    });
    if (!integration) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    const res = await ctx.db.ingestedEmail.updateMany({
      where: { emailIntegrationId: integration.id, status: "CONFIRMATION" },
      data: { status: "IGNORED", failureReason: "Dismissed after manual verification" },
    });
    return { dismissed: res.count };
  }),
});
