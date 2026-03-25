import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { z } from "zod";

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
});
