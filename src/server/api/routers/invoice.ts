import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { z } from "zod";

export const invoiceRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        type: z.enum(["sent", "received"]),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(20),
        search: z.string().optional(),
        status: z.enum(["DRAFT", "SENT", "PAID", "OVERDUE", "CANCELLED"]).optional(),
        customerId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });

      const where: Record<string, unknown> = {};

      if (input.type === "sent") {
        where.senderCompanyId = user.companyId;
      } else {
        where.receiverCompanyId = user.companyId;
      }

      if (input.status) {
        where.invoiceStatus = input.status;
      }

      if (input.customerId) {
        where.customerId = input.customerId;
      }

      if (input.search) {
        where.OR = [
          { invoiceNumber: { contains: input.search, mode: "insensitive" } },
          { reference: { contains: input.search, mode: "insensitive" } },
          { description: { contains: input.search, mode: "insensitive" } },
          { customer: { name: { contains: input.search, mode: "insensitive" } } },
        ];
      }

      const [invoices, totalCount] = await Promise.all([
        ctx.db.invoice.findMany({
          where,
          include: { customer: true, senderCompany: true, receiverCompany: true },
          orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        ctx.db.invoice.count({ where }),
      ]);

      return {
        invoices,
        totalCount,
        totalPages: Math.ceil(totalCount / input.limit),
        page: input.page,
      };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const invoice = await ctx.db.invoice.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          customer: true,
          timelineItems: { orderBy: { createdAt: "desc" } },
          senderCompany: true,
          receiverCompany: true,
        },
      });

      return invoice;
    }),

  create: protectedProcedure
    .input(
      z.object({
        invoiceNumber: z.string(),
        reference: z.string().optional(),
        invoicedDate: z.coerce.date(),
        paymentTerms: z.number().int().min(0),
        amount: z.number().min(0),
        currency: z.string().default("USD"),
        fromAddress: z.string().optional(),
        toAddress: z.string().optional(),
        description: z.string().optional(),
        customerId: z.string().optional(),
        receiverCompanyId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });

      const dueDate = new Date(input.invoicedDate);
      dueDate.setDate(dueDate.getDate() + input.paymentTerms);

      const invoice = await ctx.db.invoice.create({
        data: {
          invoiceNumber: input.invoiceNumber,
          reference: input.reference,
          invoicedDate: input.invoicedDate,
          dueDate,
          paymentTerms: input.paymentTerms,
          amount: input.amount,
          currency: input.currency,
          fromAddress: input.fromAddress,
          toAddress: input.toAddress,
          description: input.description,
          customerId: input.customerId,
          receiverCompanyId: input.receiverCompanyId,
          senderCompanyId: user.companyId,
          createdById: user.id,
          invoiceStatus: "DRAFT",
          routingStatus: "PENDING",
          timelineItems: {
            create: {
              message: "Invoice created",
            },
          },
        },
        include: { customer: true },
      });

      return invoice;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        invoiceNumber: z.string().optional(),
        reference: z.string().optional(),
        invoicedDate: z.coerce.date().optional(),
        paymentTerms: z.number().int().min(0).optional(),
        amount: z.number().min(0).optional(),
        currency: z.string().optional(),
        fromAddress: z.string().optional(),
        toAddress: z.string().optional(),
        description: z.string().optional(),
        customerId: z.string().optional(),
        receiverCompanyId: z.string().optional(),
        fileUrl: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      // Recalculate dueDate if invoicedDate or paymentTerms changed
      const updateData: Record<string, unknown> = { ...data };
      if (data.invoicedDate || data.paymentTerms) {
        const existing = await ctx.db.invoice.findUniqueOrThrow({
          where: { id },
        });
        const invoicedDate = data.invoicedDate ?? existing.invoicedDate;
        const paymentTerms = data.paymentTerms ?? existing.paymentTerms;
        const dueDate = new Date(invoicedDate);
        dueDate.setDate(dueDate.getDate() + paymentTerms);
        updateData.dueDate = dueDate;
      }

      const invoice = await ctx.db.invoice.update({
        where: { id },
        data: {
          ...updateData,
          timelineItems: {
            create: {
              message: "Invoice updated",
            },
          },
        },
        include: { customer: true },
      });

      return invoice;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.invoice.delete({ where: { id: input.id } });
      return { success: true };
    }),

  send: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invoice = await ctx.db.invoice.update({
        where: { id: input.id },
        data: {
          invoiceStatus: "SENT",
          routingStatus: "PENDING",
          timelineItems: {
            create: {
              message: "Invoice sent",
            },
          },
        },
      });

      if (invoice.receiverCompanyId) {
        const receiverUsers = await ctx.db.user.findMany({
          where: { companyId: invoice.receiverCompanyId },
        });

        await ctx.db.notification.createMany({
          data: receiverUsers.map((u) => ({
            message: `New invoice received: ${invoice.invoiceNumber}`,
            type: "INVOICE_RECEIVED" as const,
            userId: u.id,
            invoiceId: invoice.id,
          })),
        });
      }

      return invoice;
    }),

  togglePin: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.invoice.findUniqueOrThrow({
        where: { id: input.id },
      });

      const invoice = await ctx.db.invoice.update({
        where: { id: input.id },
        data: { pinned: !existing.pinned },
      });

      return invoice;
    }),

  acknowledge: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invoice = await ctx.db.invoice.update({
        where: { id: input.id },
        data: {
          routingStatus: "ACKNOWLEDGED",
          timelineItems: {
            create: {
              message: "Invoice acknowledged",
            },
          },
        },
      });

      if (invoice.senderCompanyId) {
        const senderUsers = await ctx.db.user.findMany({
          where: { companyId: invoice.senderCompanyId },
        });

        await ctx.db.notification.createMany({
          data: senderUsers.map((u) => ({
            message: `Invoice ${invoice.invoiceNumber} has been acknowledged`,
            type: "INVOICE_ACKNOWLEDGED" as const,
            userId: u.id,
            invoiceId: invoice.id,
          })),
        });
      }

      return invoice;
    }),

  markPaid: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invoice = await ctx.db.invoice.update({
        where: { id: input.id },
        data: {
          invoiceStatus: "PAID",
          timelineItems: {
            create: {
              message: "Invoice marked as paid",
            },
          },
        },
      });

      if (invoice.senderCompanyId) {
        const senderUsers = await ctx.db.user.findMany({
          where: { companyId: invoice.senderCompanyId },
        });

        await ctx.db.notification.createMany({
          data: senderUsers.map((u) => ({
            message: `Invoice ${invoice.invoiceNumber} has been paid`,
            type: "INVOICE_PAID" as const,
            userId: u.id,
            invoiceId: invoice.id,
          })),
        });
      }

      return invoice;
    }),
});
