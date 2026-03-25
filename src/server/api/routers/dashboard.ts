import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const dashboardRouter = createTRPCRouter({
  getSummary: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { clerkId: ctx.auth.userId },
    });

    const companyId = user.companyId;
    const now = new Date();

    const [
      totalSent,
      totalReceived,
      pending,
      acknowledged,
      paid,
      overdue,
      sentAggregation,
      receivedAggregation,
    ] = await Promise.all([
      ctx.db.invoice.count({
        where: { senderCompanyId: companyId },
      }),
      ctx.db.invoice.count({
        where: { receiverCompanyId: companyId },
      }),
      ctx.db.invoice.count({
        where: { senderCompanyId: companyId, routingStatus: "PENDING" },
      }),
      ctx.db.invoice.count({
        where: { senderCompanyId: companyId, routingStatus: "ACKNOWLEDGED" },
      }),
      ctx.db.invoice.count({
        where: {
          OR: [
            { senderCompanyId: companyId },
            { receiverCompanyId: companyId },
          ],
          invoiceStatus: "PAID",
        },
      }),
      ctx.db.invoice.count({
        where: {
          OR: [
            { senderCompanyId: companyId },
            { receiverCompanyId: companyId },
          ],
          dueDate: { lt: now },
          invoiceStatus: { notIn: ["PAID", "CANCELLED"] },
        },
      }),
      ctx.db.invoice.aggregate({
        where: { senderCompanyId: companyId },
        _sum: { amount: true },
      }),
      ctx.db.invoice.aggregate({
        where: { receiverCompanyId: companyId },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalSent,
      totalReceived,
      pending,
      acknowledged,
      overdue,
      paid,
      totalAmountSent: sentAggregation._sum.amount ?? 0,
      totalAmountReceived: receivedAggregation._sum.amount ?? 0,
    };
  }),

  getAgingData: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { clerkId: ctx.auth.userId },
    });

    const companyId = user.companyId;

    const unpaidInvoices = await ctx.db.invoice.findMany({
      where: {
        receiverCompanyId: companyId,
        invoiceStatus: "SENT",
      },
      select: {
        id: true,
        amount: true,
        invoicedDate: true,
      },
    });

    const now = new Date();
    const buckets = [
      { label: "0-30", minDays: 0, maxDays: 30, count: 0, amount: 0 },
      { label: "31-60", minDays: 31, maxDays: 60, count: 0, amount: 0 },
      { label: "61-90", minDays: 61, maxDays: 90, count: 0, amount: 0 },
      { label: "90+", minDays: 91, maxDays: Infinity, count: 0, amount: 0 },
    ];

    for (const invoice of unpaidInvoices) {
      const daysSinceInvoiced = Math.floor(
        (now.getTime() - new Date(invoice.invoicedDate).getTime()) /
          (1000 * 60 * 60 * 24),
      );

      const bucket = buckets.find(
        (b) => daysSinceInvoiced >= b.minDays && daysSinceInvoiced <= b.maxDays,
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
