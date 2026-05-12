import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

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

  getAgingData: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { clerkId: ctx.auth.userId },
    });

    const companyId = user.companyId;

    const receivedInvoices = await ctx.db.invoice.findMany({
      where: {
        receiverCompanyId: companyId,
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

  getMonthlyTotals: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { clerkId: ctx.auth.userId },
    });

    const companyId = user.companyId;

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const [sentInvoices, receivedInvoices] = await Promise.all([
      ctx.db.invoice.findMany({
        where: {
          senderCompanyId: companyId,
          invoicedDate: { gte: sixMonthsAgo },
        },
        select: { amount: true, invoicedDate: true },
      }),
      ctx.db.invoice.findMany({
        where: {
          receiverCompanyId: companyId,
          invoicedDate: { gte: sixMonthsAgo },
        },
        select: { amount: true, invoicedDate: true },
      }),
    ]);

    const months: { month: string; sent: number; received: number }[] = [];

    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const year = date.getFullYear();
      const month = date.getMonth();

      const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;

      const sentTotal = sentInvoices
        .filter((inv) => {
          const d = new Date(inv.invoicedDate);
          return d.getFullYear() === year && d.getMonth() === month;
        })
        .reduce((sum, inv) => sum + Number(inv.amount), 0);

      const receivedTotal = receivedInvoices
        .filter((inv) => {
          const d = new Date(inv.invoicedDate);
          return d.getFullYear() === year && d.getMonth() === month;
        })
        .reduce((sum, inv) => sum + Number(inv.amount), 0);

      months.push({ month: monthKey, sent: sentTotal, received: receivedTotal });
    }

    return months;
  }),
});
