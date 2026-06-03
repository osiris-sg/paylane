import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Resend } from "resend";
import type { PrismaClient } from "@prisma/client";

import { requireSendAccess } from "~/server/api/lib/sending-access";
import { sendPushToCompany } from "~/lib/push-notifications";
import { sendWhatsAppToCompany } from "~/server/notifications/dispatch";
import { sendWhatsAppTemplate } from "~/server/notifications/whatsapp";
import {
  resolveFileUrl,
  isInlineOrExternal,
  presignDownload,
} from "~/lib/storage";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.EMAIL_FROM ?? "E-StatementNow <onboarding@resend.dev>";

/** Throw unless the caller's company has the Delivery Orders feature enabled. */
async function requireDeliveryOrders(db: PrismaClient, companyId: string) {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { deliveryOrdersEnabled: true },
  });
  if (!company?.deliveryOrdersEnabled) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Delivery Orders isn't enabled for your account.",
    });
  }
}

export const deliveryOrderRouter = createTRPCRouter({
  /**
   * Whether the caller can send DOs (flag) and/or has received any (read-only).
   * Called from the sidebar on every page, so it must never throw — if the DB
   * migration hasn't run yet (table/column missing) we degrade to "no access"
   * instead of taking the whole app's nav down.
   */
  getAccess: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user;
    try {
      const [company, receivedCount] = await Promise.all([
        ctx.db.company.findUnique({
          where: { id: user.companyId },
          select: { deliveryOrdersEnabled: true },
        }),
        ctx.db.deliveryOrder.count({
          where: { receiverCompanyId: user.companyId },
        }),
      ]);
      return {
        canSend: company?.deliveryOrdersEnabled ?? false,
        hasReceived: receivedCount > 0,
      };
    } catch (err) {
      console.error("[deliveryOrder.getAccess] failed (migration not applied?):", err);
      return { canSend: false, hasReceived: false };
    }
  }),

  /** Sender: list DOs this company has uploaded. */
  listSent: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user;
    await requireDeliveryOrders(ctx.db as unknown as PrismaClient, user.companyId);
    return ctx.db.deliveryOrder.findMany({
      where: { senderCompanyId: user.companyId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        doNumber: true,
        reference: true,
        doDate: true,
        amount: true,
        currency: true,
        fileName: true,
        sentAt: true,
        createdAt: true,
        customer: { select: { id: true, name: true, company: true } },
      },
    });
  }),

  /** Receiver: list DOs sent to this company. No feature flag required. */
  listReceived: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user;
    return ctx.db.deliveryOrder.findMany({
      where: { receiverCompanyId: user.companyId },
      orderBy: { sentAt: "desc" },
      select: {
        id: true,
        doNumber: true,
        reference: true,
        doDate: true,
        amount: true,
        currency: true,
        fileName: true,
        sentAt: true,
        senderCompany: { select: { id: true, name: true } },
      },
    });
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = ctx.user;
      const order = await ctx.db.deliveryOrder.findUnique({
        where: { id: input.id },
        include: {
          customer: true,
          senderCompany: { select: { id: true, name: true } },
        },
      });
      if (
        !order ||
        (order.senderCompanyId !== user.companyId &&
          order.receiverCompanyId !== user.companyId)
      ) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return { ...order, fileUrl: await resolveFileUrl(order.fileUrl) };
    }),

  /** Sender: create a DO draft from an uploaded + AI-extracted file. */
  createFromUpload: protectedProcedure
    .input(
      z.object({
        doNumber: z.string().min(1),
        reference: z.string().optional(),
        doDate: z.coerce.date().optional(),
        amount: z.number().min(0).optional(),
        currency: z.string().optional(),
        customerId: z.string().optional(),
        fileUrl: z.string().min(1),
        fileName: z.string().min(1),
        fileType: z.string().min(1),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      await requireDeliveryOrders(ctx.db as unknown as PrismaClient, user.companyId);
      await requireSendAccess(ctx.db, user.companyId);
      return ctx.db.deliveryOrder.create({
        data: {
          doNumber: input.doNumber,
          reference: input.reference,
          doDate: input.doDate,
          amount: input.amount,
          currency: input.currency ?? "SGD",
          customerId: input.customerId,
          fileUrl: input.fileUrl,
          fileName: input.fileName,
          fileType: input.fileType,
          notes: input.notes,
          senderCompanyId: user.companyId,
          createdById: user.id,
        },
      });
    }),

  /** Sender: send a DO to its customer (email priority, WhatsApp fallback). */
  send: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      await requireDeliveryOrders(ctx.db as unknown as PrismaClient, user.companyId);
      await requireSendAccess(ctx.db, user.companyId);

      const existing = await ctx.db.deliveryOrder.findUniqueOrThrow({
        where: { id: input.id },
        include: { customer: true },
      });
      if (existing.senderCompanyId !== user.companyId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (!existing.customerId || !existing.customer) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Assign a customer before sending this delivery order.",
        });
      }

      // Resolve the receiver company the same way invoices order: prefer an
      // explicit link, else match the customer's email to a platform company.
      let receiverCompanyId = existing.receiverCompanyId;
      if (!receiverCompanyId && existing.customer.email) {
        if (existing.customer.linkedCompanyId) {
          receiverCompanyId = existing.customer.linkedCompanyId;
        } else {
          const matched = await ctx.db.company.findFirst({
            where: { email: existing.customer.email.toLowerCase() },
            select: { id: true },
          });
          if (matched) {
            receiverCompanyId = matched.id;
            await ctx.db.customer.update({
              where: { id: existing.customer.id },
              data: { linkedCompanyId: matched.id },
            });
          }
        }
      }

      const senderCompany = await ctx.db.company.findUnique({
        where: { id: user.companyId },
        select: { name: true },
      });
      const senderName = senderCompany?.name ?? "A supplier";

      const order = await ctx.db.deliveryOrder.update({
        where: { id: existing.id },
        data: { sentAt: existing.sentAt ?? new Date(), receiverCompanyId },
      });

      // On-platform receiver → in-app + push + WhatsApp + email.
      if (receiverCompanyId) {
        const receiverUsers = await ctx.db.user.findMany({
          where: { companyId: receiverCompanyId },
          select: { id: true },
        });
        if (receiverUsers.length > 0) {
          await ctx.db.notification.createMany({
            data: receiverUsers.map((u) => ({
              message: `New delivery order received: ${order.doNumber}`,
              type: "DELIVERY_ORDER_RECEIVED" as const,
              userId: u.id,
              deliveryOrderId: order.id,
            })),
          });
        }
        void sendPushToCompany(receiverCompanyId, {
          title: "New Delivery Order",
          body: `${senderName} sent you delivery order ${order.doNumber}`,
          url: `/delivery-orders?tab=received&id=${order.id}`,
          tag: `order-${order.id}`,
        });
        await sendWhatsAppToCompany(
          receiverCompanyId,
          {
            template: "delivery_order_received",
            contentVariables: { senderName, doNumber: order.doNumber },
          },
          { buttonUrlSlug: order.id },
        );
      }

      // Email the customer (priority) when we have an address.
      if (existing.customer.email) {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
        const viewUrl = `${baseUrl}/delivery-orders/${order.id}`;
        try {
          await resend.emails.send({
            from: FROM_EMAIL,
            to: existing.customer.email,
            subject: `${senderName} sent you delivery order ${order.doNumber}`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
                <div style="text-align: center; margin-bottom: 32px;">
                  <h1 style="font-size: 24px; font-weight: 700; color: #2563eb; margin: 0;">E-StatementNow</h1>
                </div>
                <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 32px;">
                  <h2 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 8px;">You have a new delivery order</h2>
                  <p style="color: #6b7280; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
                    <strong style="color: #111827;">${senderName}</strong> sent you delivery order
                    <strong style="color: #111827;">${order.doNumber}</strong>.
                  </p>
                  <div style="text-align: center; margin: 32px 0;">
                    <a href="${viewUrl}" style="display: inline-block; background: #2563eb; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 8px;">View Delivery Order</a>
                  </div>
                </div>
              </div>
            `,
          });
        } catch (error) {
          console.error(`📧 Failed to send DO email to ${existing.customer.email}:`, error);
        }
      } else if (existing.customer.phone) {
        // No email but a phone on file → WhatsApp the customer directly.
        try {
          const result = await sendWhatsAppTemplate({
            to: existing.customer.phone,
            message: {
              template: "delivery_order_received",
              contentVariables: { senderName, doNumber: order.doNumber },
            },
            buttonUrlSlug: order.id,
          });
          if (!result.ok) {
            console.error(`📱 Failed to send DO WhatsApp to ${existing.customer.phone}:`, result.error);
          }
        } catch (error) {
          console.error(`📱 Failed to send DO WhatsApp to ${existing.customer.phone}:`, error);
        }
      }

      return order;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      await requireDeliveryOrders(ctx.db as unknown as PrismaClient, user.companyId);
      const { count } = await ctx.db.deliveryOrder.deleteMany({
        where: { id: input.id, senderCompanyId: user.companyId },
      });
      if (count === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  /** Receiver: mark a received DO as viewed (first-time only). */
  markViewed: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      const order = await ctx.db.deliveryOrder.findUnique({
        where: { id: input.id },
        select: { id: true, receiverCompanyId: true, viewedAt: true },
      });
      if (!order || order.receiverCompanyId !== user.companyId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (order.viewedAt) return order;
      return ctx.db.deliveryOrder.update({
        where: { id: input.id },
        data: { viewedAt: new Date() },
      });
    }),

  /** Presigned download URL for the uploaded DO file. */
  getDownloadUrl: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = ctx.user;
      const order = await ctx.db.deliveryOrder.findUnique({
        where: { id: input.id },
        select: { fileUrl: true, doNumber: true, senderCompanyId: true, receiverCompanyId: true },
      });
      if (
        !order ||
        (order.senderCompanyId !== user.companyId && order.receiverCompanyId !== user.companyId)
      ) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const safe = order.doNumber.replace(/[^a-zA-Z0-9._-]+/g, "-") || "delivery-order";
      if (isInlineOrExternal(order.fileUrl)) {
        const ext = order.fileUrl.startsWith("data:application/pdf")
          ? "pdf"
          : order.fileUrl.startsWith("data:image/png")
            ? "png"
            : order.fileUrl.startsWith("data:image/webp")
              ? "webp"
              : order.fileUrl.startsWith("data:image/")
                ? "jpg"
                : "pdf";
        return { url: order.fileUrl, filename: `DO-${safe}.${ext}` };
      }
      const ext = /\.([a-z0-9]+)$/i.exec(order.fileUrl)?.[1]?.toLowerCase() ?? "pdf";
      const url = await presignDownload(order.fileUrl, 300, { filename: `DO-${safe}.${ext}` });
      return { url, filename: `DO-${safe}.${ext}` };
    }),
});
