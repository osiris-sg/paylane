import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { sendWhatsAppTemplate } from "~/server/notifications/whatsapp";

const E164 = /^\+[1-9]\d{6,14}$/;

export const notificationRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });

      const [notifications, totalCount] = await Promise.all([
        ctx.db.notification.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          include: { invoice: true },
        }),
        ctx.db.notification.count({ where: { userId: user.id } }),
      ]);

      return {
        notifications,
        totalCount,
        totalPages: Math.ceil(totalCount / input.limit),
        page: input.page,
      };
    }),

  getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { clerkId: ctx.auth.userId },
    });

    const count = await ctx.db.notification.count({
      where: { userId: user.id, read: false },
    });

    return { count };
  }),

  markRead: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });

      const notification = await ctx.db.notification.update({
        where: { id: input.id, userId: user.id },
        data: { read: true },
      });

      return notification;
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { clerkId: ctx.auth.userId },
    });

    await ctx.db.notification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });

    return { success: true };
  }),

  getWhatsAppPreferences: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { clerkId: ctx.auth.userId },
      select: { whatsappNumber: true, whatsappOptIn: true },
    });
    return user;
  }),

  updateWhatsAppPreferences: protectedProcedure
    .input(
      z.object({
        whatsappNumber: z
          .string()
          .trim()
          .regex(E164, "Use international format, e.g. +6591234567")
          .optional()
          .or(z.literal("")),
        whatsappOptIn: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const number = input.whatsappNumber?.trim() || null;
      if (input.whatsappOptIn && !number) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add a WhatsApp number before opting in",
        });
      }
      const user = await ctx.db.user.update({
        where: { clerkId: ctx.auth.userId },
        data: {
          whatsappNumber: number,
          whatsappOptIn: input.whatsappOptIn && !!number,
        },
        select: { whatsappNumber: true, whatsappOptIn: true },
      });
      return user;
    }),

  sendTestWhatsApp: protectedProcedure.mutation(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { clerkId: ctx.auth.userId },
      select: { whatsappNumber: true, whatsappOptIn: true },
    });
    if (!user.whatsappOptIn || !user.whatsappNumber) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Save and opt in to a WhatsApp number first",
      });
    }
    const result = await sendWhatsAppTemplate({
      to: user.whatsappNumber,
      message: {
        template: "invoice_received",
        contentVariables: {
          senderName: "PayLane",
          invoiceNumber: "TEST-0001",
          amount: "SGD 1.00",
        },
      },
      buttonUrlSlug: "test",
    });
    if (!result.ok) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error ?? "Send failed" });
    }
    return { ok: true };
  }),
});
