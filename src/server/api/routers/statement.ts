import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Resend } from "resend";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { requireSendAccess } from "~/server/api/lib/sending-access";
import { sendPushToCompany } from "~/lib/push-notifications";
import { sendWhatsAppToCompany } from "~/server/notifications/dispatch";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.EMAIL_FROM ?? "PayLane <onboarding@resend.dev>";

const sendInput = z.object({
  customerId: z.string(),
  fileDataUrl: z.string().min(1, "File is required"),
  fileName: z.string().min(1),
  fileType: z.string().min(1),
  notes: z.string().optional(),
});

async function persistAndDispatch({
  ctx,
  user,
  customerId,
  fileDataUrl,
  fileName,
  fileType,
  notes,
}: {
  // ctx contains the tRPC db client; typed loosely so this helper stays
  // usable from both single + bulk send mutations.
  ctx: { db: typeof import("~/lib/db").db };
  user: { companyId: string };
  customerId: string;
  fileDataUrl: string;
  fileName: string;
  fileType: string;
  notes?: string;
}) {
  const customer = await ctx.db.customer.findUniqueOrThrow({
    where: { id: customerId, companyId: user.companyId },
  });

  const senderCompany = await ctx.db.company.findUniqueOrThrow({
    where: { id: user.companyId },
    select: { id: true, name: true },
  });

  // Detect upsert vs. create so the notification can say "updated" instead
  // of "sent" when a previous statement was on file.
  const previous = await ctx.db.statement.findUnique({
    where: { customerId },
    select: { id: true },
  });
  const isUpdate = !!previous;

  const statement = await ctx.db.statement.upsert({
    where: { customerId },
    create: {
      customerId,
      senderCompanyId: user.companyId,
      receiverCompanyId: customer.linkedCompanyId,
      fileUrl: fileDataUrl,
      fileName,
      fileType,
      notes,
    },
    update: {
      fileUrl: fileDataUrl,
      fileName,
      fileType,
      notes,
      sentAt: new Date(),
      viewedAt: null,
      receiverCompanyId: customer.linkedCompanyId,
    },
  });

  // Notify receiver across every channel they've opted into.
  if (customer.linkedCompanyId) {
    const receiverUsers = await ctx.db.user.findMany({
      where: { companyId: customer.linkedCompanyId },
      select: { id: true, email: true },
    });

    const verb = isUpdate ? "updated their statement" : "sent you a statement";
    const pushTitle = isUpdate ? "Statement Updated" : "New Statement";

    if (receiverUsers.length > 0) {
      await ctx.db.notification.createMany({
        data: receiverUsers.map((u) => ({
          message: `${senderCompany.name} ${verb}`,
          type: "STATEMENT_RECEIVED" as const,
          userId: u.id,
          statementId: statement.id,
        })),
      });

      void sendPushToCompany(customer.linkedCompanyId, {
        title: pushTitle,
        body: `${senderCompany.name} ${verb} of account`,
        url: `/statements?tab=received&id=${statement.id}`,
        tag: `statement-${statement.id}`,
      });

      void sendWhatsAppToCompany(customer.linkedCompanyId, {
        template: "statement_received",
        contentVariables: {
          senderName: senderCompany.name,
        },
      });

      // Email — best-effort, ignore failures.
      void Promise.allSettled(
        receiverUsers
          .filter((u) => !!u.email)
          .map((u) =>
            resend.emails.send({
              from: FROM_EMAIL,
              to: u.email,
              subject: `${senderCompany.name} sent you a statement`,
              html: `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
                  <h1 style="font-size: 22px; color: #111827; margin: 0 0 16px;">New statement of account</h1>
                  <p style="color: #4b5563; font-size: 15px; line-height: 1.6;">
                    <strong>${senderCompany.name}</strong> just sent you a statement of account on PayLane.
                  </p>
                  <p style="color: #4b5563; font-size: 15px; line-height: 1.6;">
                    Open PayLane to view the file.
                  </p>
                </div>
              `,
            }),
          ),
      );
    }
  }

  return statement;
}

export const statementRouter = createTRPCRouter({
  /** Send (or replace) the latest statement for a single customer. */
  sendToCustomer: protectedProcedure
    .input(sendInput)
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });
      await requireSendAccess(ctx.db, user.companyId);

      return persistAndDispatch({
        ctx: { db: ctx.db as unknown as typeof import("~/lib/db").db },
        user,
        ...input,
      });
    }),

  /**
   * Bulk send. The client passes an array of items already matched to
   * customers (the matching can be AI-driven, manual, or both); the
   * server treats each row independently and returns per-row results.
   */
  bulkSend: protectedProcedure
    .input(
      z.object({
        items: z.array(sendInput).min(1).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });
      await requireSendAccess(ctx.db, user.companyId);

      const results: Array<
        | { customerId: string; status: "sent"; statementId: string }
        | { customerId: string; status: "error"; message: string }
      > = [];

      for (const item of input.items) {
        try {
          const stmt = await persistAndDispatch({
            ctx: { db: ctx.db as unknown as typeof import("~/lib/db").db },
            user,
            ...item,
          });
          results.push({
            customerId: item.customerId,
            status: "sent",
            statementId: stmt.id,
          });
        } catch (err) {
          results.push({
            customerId: item.customerId,
            status: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }
      return { results };
    }),

  /** Sender: latest statement they've sent to a specific customer (if any). */
  getForCustomer: protectedProcedure
    .input(z.object({ customerId: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });
      await ctx.db.customer.findUniqueOrThrow({
        where: { id: input.customerId, companyId: user.companyId },
        select: { id: true },
      });
      return ctx.db.statement.findUnique({
        where: { customerId: input.customerId },
      });
    }),

  /** Receiver: latest statement received from a specific supplier company. */
  getFromSupplierCompany: protectedProcedure
    .input(z.object({ senderCompanyId: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });
      return ctx.db.statement.findFirst({
        where: {
          receiverCompanyId: user.companyId,
          senderCompanyId: input.senderCompanyId,
        },
        orderBy: { sentAt: "desc" },
        include: { senderCompany: { select: { name: true } } },
      });
    }),

  /** Badge counts for the CUSTOMER + SUPPLIER tabs on /statements. */
  getTabCounts: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { clerkId: ctx.auth.userId },
    });
    const [unviewedByRecipient, unviewedByMe] = await Promise.all([
      ctx.db.statement.count({
        where: { senderCompanyId: user.companyId, viewedAt: null },
      }),
      ctx.db.statement.count({
        where: { receiverCompanyId: user.companyId, viewedAt: null },
      }),
    ]);
    return { unviewedByRecipient, unviewedByMe };
  }),

  /** Sender: list every statement they've sent (one per customer). */
  listSent: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { clerkId: ctx.auth.userId },
    });
    return ctx.db.statement.findMany({
      where: { senderCompanyId: user.companyId },
      orderBy: { sentAt: "desc" },
      include: {
        customer: {
          select: { id: true, company: true, name: true, email: true },
        },
        receiverCompany: { select: { id: true, name: true } },
      },
    });
  }),

  /** Receiver: list every incoming statement (one per supplier). */
  listIncoming: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { clerkId: ctx.auth.userId },
    });
    return ctx.db.statement.findMany({
      where: { receiverCompanyId: user.companyId },
      orderBy: { sentAt: "desc" },
      include: { senderCompany: { select: { id: true, name: true } } },
    });
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });
      const stmt = await ctx.db.statement.findUnique({
        where: { id: input.id },
        include: {
          senderCompany: { select: { id: true, name: true } },
          customer: { select: { id: true, company: true, name: true } },
        },
      });
      if (
        !stmt ||
        (stmt.senderCompanyId !== user.companyId &&
          stmt.receiverCompanyId !== user.companyId)
      ) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return stmt;
    }),

  markViewed: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });
      const stmt = await ctx.db.statement.findUnique({
        where: { id: input.id },
        select: { id: true, receiverCompanyId: true, viewedAt: true },
      });
      if (!stmt || stmt.receiverCompanyId !== user.companyId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (stmt.viewedAt) return stmt;
      return ctx.db.statement.update({
        where: { id: input.id },
        data: { viewedAt: new Date() },
      });
    }),
});
