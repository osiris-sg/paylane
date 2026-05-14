import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { z } from "zod";

const rangeInput = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .optional();

/** Default to "last 6 calendar months" if no range is supplied. */
function resolveRange(input: { from?: Date; to?: Date } | undefined): {
  from: Date;
  to: Date;
} {
  const now = new Date();
  const to = input?.to ?? now;
  const from =
    input?.from ??
    new Date(now.getFullYear(), now.getMonth() - 5, 1, 0, 0, 0, 0);
  return { from, to };
}

export const dashboardRouter = createTRPCRouter({
  getSummary: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { clerkId: ctx.auth.userId },
    });

    const companyId = user.companyId;
    const now = new Date();

    const sentBase = { senderCompanyId: companyId } as const;
    const receivedBase = { receiverCompanyId: companyId } as const;

    const countAndSum = async (where: Record<string, unknown>) => {
      const [count, agg] = await Promise.all([
        ctx.db.invoice.count({ where }),
        ctx.db.invoice.aggregate({ where, _sum: { amount: true } }),
      ]);
      return { count, amount: Number(agg._sum.amount ?? 0) };
    };

    const [
      sentTotal,
      sentDraft,
      sentPending,
      sentOverdue,
      sentPaid,
      receivedTotal,
      receivedPending,
      receivedOverdue,
      receivedPaid,
    ] = await Promise.all([
      countAndSum(sentBase),
      countAndSum({ ...sentBase, invoiceStatus: "DRAFT" }),
      countAndSum({
        ...sentBase,
        invoiceStatus: { in: ["SENT", "PENDING_APPROVAL"] },
        dueDate: { gte: now },
      }),
      countAndSum({
        ...sentBase,
        invoiceStatus: { notIn: ["PAID", "CANCELLED", "DRAFT"] },
        dueDate: { lt: now },
      }),
      countAndSum({ ...sentBase, invoiceStatus: "PAID" }),
      countAndSum(receivedBase),
      countAndSum({
        ...receivedBase,
        invoiceStatus: { in: ["SENT", "PENDING_APPROVAL"] },
        dueDate: { gte: now },
      }),
      countAndSum({
        ...receivedBase,
        invoiceStatus: { notIn: ["PAID", "CANCELLED", "DRAFT"] },
        dueDate: { lt: now },
      }),
      countAndSum({ ...receivedBase, invoiceStatus: "PAID" }),
    ]);

    return {
      sent: {
        total: sentTotal,
        draft: sentDraft,
        pending: sentPending,
        overdue: sentOverdue,
        paid: sentPaid,
      },
      received: {
        total: receivedTotal,
        pending: receivedPending,
        overdue: receivedOverdue,
        paid: receivedPaid,
      },
    };
  }),

  getAgingData: protectedProcedure
    .input(rangeInput)
    .query(async ({ ctx, input }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { clerkId: ctx.auth.userId },
    });

    const companyId = user.companyId;
    const range = resolveRange(input);

    const receivedInvoices = await ctx.db.invoice.findMany({
      where: {
        receiverCompanyId: companyId,
        invoicedDate: { gte: range.from, lte: range.to },
      },
      select: {
        id: true,
        amount: true,
        invoicedDate: true,
      },
    });

    const now = new Date();
    const buckets = [
      { label: "0-1", minMonths: 0, maxMonths: 0, count: 0, amount: 0 },
      { label: "1-2", minMonths: 1, maxMonths: 1, count: 0, amount: 0 },
      { label: "2-3", minMonths: 2, maxMonths: 2, count: 0, amount: 0 },
      { label: "3+", minMonths: 3, maxMonths: Infinity, count: 0, amount: 0 },
    ];

    for (const invoice of receivedInvoices) {
      const inv = new Date(invoice.invoicedDate);
      // Full calendar months elapsed between invoicedDate and now.
      const monthsSinceInvoiced =
        (now.getFullYear() - inv.getFullYear()) * 12 +
        (now.getMonth() - inv.getMonth()) -
        (now.getDate() < inv.getDate() ? 1 : 0);

      const bucket = buckets.find(
        (b) =>
          monthsSinceInvoiced >= b.minMonths &&
          monthsSinceInvoiced <= b.maxMonths,
      );

      if (bucket) {
        bucket.count += 1;
        bucket.amount += Number(invoice.amount);
      }
    }

    return buckets.map(({ label, count, amount }) => ({
      label,
      count,
      amount,
    }));
  }),

  getMonthlyTotals: protectedProcedure
    .input(rangeInput)
    .query(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });

      const companyId = user.companyId;
      const { from, to } = resolveRange(input);

      // Auto-pick bucket size based on range length so charts stay readable.
      const days = Math.max(
        1,
        Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)),
      );
      const granularity: "daily" | "weekly" | "monthly" =
        days <= 31 ? "daily" : days <= 120 ? "weekly" : "monthly";

      const [sentInvoices, receivedInvoices] = await Promise.all([
        ctx.db.invoice.findMany({
          where: {
            senderCompanyId: companyId,
            invoicedDate: { gte: from, lte: to },
          },
          select: { amount: true, invoicedDate: true },
        }),
        ctx.db.invoice.findMany({
          where: {
            receiverCompanyId: companyId,
            invoicedDate: { gte: from, lte: to },
          },
          select: { amount: true, invoicedDate: true },
        }),
      ]);

      const bucketKey = (d: Date): string => {
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth();
        const day = d.getUTCDate();
        const pad2 = (n: number) => String(n).padStart(2, "0");

        if (granularity === "daily") {
          return `${y}-${pad2(m + 1)}-${pad2(day)}`;
        }
        if (granularity === "monthly") {
          return `${y}-${pad2(m + 1)}-01`;
        }
        // weekly — bucket = Monday of the week
        const dow = d.getUTCDay() || 7;
        const monday = new Date(Date.UTC(y, m, day - dow + 1));
        return `${monday.getUTCFullYear()}-${pad2(monday.getUTCMonth() + 1)}-${pad2(
          monday.getUTCDate(),
        )}`;
      };

      // Build every bucket in range so the line stays continuous.
      const allKeys = new Set<string>();
      const cursor = new Date(from);
      cursor.setUTCHours(0, 0, 0, 0);
      while (cursor <= to) {
        allKeys.add(bucketKey(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }

      const sentByBucket = new Map<string, number>();
      const receivedByBucket = new Map<string, number>();
      allKeys.forEach((k) => {
        sentByBucket.set(k, 0);
        receivedByBucket.set(k, 0);
      });
      for (const inv of sentInvoices) {
        const k = bucketKey(new Date(inv.invoicedDate));
        if (sentByBucket.has(k))
          sentByBucket.set(k, (sentByBucket.get(k) ?? 0) + Number(inv.amount));
      }
      for (const inv of receivedInvoices) {
        const k = bucketKey(new Date(inv.invoicedDate));
        if (receivedByBucket.has(k))
          receivedByBucket.set(
            k,
            (receivedByBucket.get(k) ?? 0) + Number(inv.amount),
          );
      }

      const buckets = Array.from(allKeys)
        .sort()
        .map((month) => ({
          month,
          sent: sentByBucket.get(month) ?? 0,
          received: receivedByBucket.get(month) ?? 0,
        }));

      const sentTotal = buckets.reduce((s, b) => s + b.sent, 0);
      const receivedTotal = buckets.reduce((s, b) => s + b.received, 0);

      return {
        buckets,
        granularity,
        sentTotal,
        receivedTotal,
        from,
        to,
      };
    }),
});
