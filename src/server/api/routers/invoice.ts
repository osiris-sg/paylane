import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { Resend } from "resend";
import { sendPushToCompany } from "~/lib/push-notifications";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.EMAIL_FROM ?? "PayLane <onboarding@resend.dev>";

const itemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().min(0),
  unitPrice: z.number().min(0),
  amount: z.number().min(0),
  sortOrder: z.number().int().default(0),
});

export const invoiceRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        type: z.enum(["sent", "received"]),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(20),
        search: z.string().optional(),
        status: z.enum(["DRAFT", "SENT", "PENDING_APPROVAL", "PAID", "OVERDUE", "CANCELLED"]).optional(),
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

      if (input.status === "OVERDUE") {
        // Overdue = due date passed and not yet paid or cancelled.
        // Invoices don't get a literal "OVERDUE" status in the DB; derive it.
        where.dueDate = { lt: new Date() };
        where.invoiceStatus = { notIn: ["PAID", "CANCELLED", "DRAFT"] };
      } else if (input.status) {
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
          items: { orderBy: { sortOrder: "asc" } },
          timelineItems: { orderBy: { createdAt: "desc" } },
          senderCompany: true,
          receiverCompany: true,
        },
      });

      return invoice;
    }),

  checkNumber: protectedProcedure
    .input(z.object({ invoiceNumber: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });
      const existing = await ctx.db.invoice.findUnique({
        where: {
          invoiceNumber_senderCompanyId: {
            invoiceNumber: input.invoiceNumber,
            senderCompanyId: user.companyId,
          },
        },
        select: { id: true, invoiceNumber: true },
      });
      return { exists: !!existing, invoiceId: existing?.id ?? null };
    }),

  create: protectedProcedure
    .input(
      z.object({
        invoiceNumber: z.string(),
        reference: z.string().optional(),
        invoicedDate: z.coerce.date(),
        paymentTerms: z.number().int().min(0),
        currency: z.string().default("SGD"),
        fromAddress: z.string().optional(),
        toAddress: z.string().optional(),
        description: z.string().optional(),
        customerId: z.string().optional(),
        receiverCompanyId: z.string().optional(),
        items: z.array(itemSchema).default([]),
        taxRate: z.number().min(0).default(9),
        notes: z.string().optional(),
        fileUrl: z.string().optional(),
        totalAmount: z.number().min(0).optional(),
        subtotal: z.number().min(0).optional(),
        taxAmount: z.number().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });

      const dueDate = new Date(input.invoicedDate);
      dueDate.setDate(dueDate.getDate() + input.paymentTerms);

      const itemsSubtotal = input.items.reduce((sum, item) => sum + item.amount, 0);
      const subtotal = input.subtotal ?? itemsSubtotal;
      const taxAmount = input.taxAmount ?? subtotal * (input.taxRate / 100);
      const totalAmount = input.totalAmount ?? subtotal + taxAmount;

      try {
        const invoice = await ctx.db.invoice.create({
          data: {
            invoiceNumber: input.invoiceNumber,
            reference: input.reference,
            invoicedDate: input.invoicedDate,
            dueDate,
            paymentTerms: input.paymentTerms,
            amount: totalAmount,
            currency: input.currency,
            fromAddress: input.fromAddress,
            toAddress: input.toAddress,
            description: input.description,
            fileUrl: input.fileUrl,
            customerId: input.customerId,
            receiverCompanyId: input.receiverCompanyId,
            senderCompanyId: user.companyId,
            createdById: user.id,
            invoiceStatus: "DRAFT",
            routingStatus: "PENDING",
            subtotal,
            taxRate: input.taxRate,
            taxAmount,
            notes: input.notes,
            items: {
              create: input.items.map((item, index) => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                amount: item.amount,
                sortOrder: index,
              })),
            },
            timelineItems: {
              create: { message: "Invoice created" },
            },
          },
          include: { customer: true, items: true },
        });

        return invoice;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Invoice number "${input.invoiceNumber}" already exists. Please use a different number.`,
          });
        }
        throw error;
      }
    }),

  /**
   * Upload-oriented create:
   * - If (invoiceNumber + senderCompany) already exists and key details match → returns status "duplicate"
   * - If exists but details differ and the existing invoice is still DRAFT → overrides it, returns "updated"
   * - If exists and is already SENT/PAID/etc → throws CONFLICT (can't override a sent invoice)
   * - If it doesn't exist → creates a new DRAFT, returns "created"
   */
  upsertFromUpload: protectedProcedure
    .input(
      z.object({
        invoiceNumber: z.string(),
        reference: z.string().optional(),
        invoicedDate: z.coerce.date(),
        paymentTerms: z.number().int().min(0),
        currency: z.string().default("SGD"),
        customerId: z.string().optional(),
        items: z.array(itemSchema).default([]),
        taxRate: z.number().min(0).default(9),
        notes: z.string().optional(),
        fileUrl: z.string().optional(),
        totalAmount: z.number().min(0).optional(),
        subtotal: z.number().min(0).optional(),
        taxAmount: z.number().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });

      const dueDate = new Date(input.invoicedDate);
      dueDate.setDate(dueDate.getDate() + input.paymentTerms);

      const itemsSubtotal = input.items.reduce((sum, item) => sum + item.amount, 0);
      const subtotal = input.subtotal ?? itemsSubtotal;
      const taxAmount = input.taxAmount ?? subtotal * (input.taxRate / 100);
      const totalAmount = input.totalAmount ?? subtotal + taxAmount;

      const existing = await ctx.db.invoice.findUnique({
        where: {
          invoiceNumber_senderCompanyId: {
            invoiceNumber: input.invoiceNumber,
            senderCompanyId: user.companyId,
          },
        },
        include: { items: true, customer: true },
      });

      if (existing) {
        // Re-upload of an existing invoice number is always a "duplicate".
        // We don't silently override on AI-extracted differences because the
        // extraction may be missing fields the user set manually (e.g.
        // customerId, reference). If the user wants to change the invoice,
        // they can edit it from the invoice detail page.
        return {
          status: "duplicate" as const,
          invoice: existing,
          existingStatus: existing.invoiceStatus,
        };
      }

      const created = await ctx.db.invoice.create({
        data: {
          invoiceNumber: input.invoiceNumber,
          reference: input.reference,
          invoicedDate: input.invoicedDate,
          dueDate,
          paymentTerms: input.paymentTerms,
          amount: totalAmount,
          currency: input.currency,
          fileUrl: input.fileUrl,
          customerId: input.customerId,
          senderCompanyId: user.companyId,
          createdById: user.id,
          invoiceStatus: "DRAFT",
          routingStatus: "PENDING",
          subtotal,
          taxRate: input.taxRate,
          taxAmount,
          notes: input.notes,
          items: {
            create: input.items.map((item, index) => ({
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              amount: item.amount,
              sortOrder: index,
            })),
          },
          timelineItems: {
            create: { message: "Invoice created" },
          },
        },
        include: { customer: true, items: true },
      });

      return {
        status: "created" as const,
        invoice: created,
        existingStatus: null,
      };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        invoiceNumber: z.string().optional(),
        reference: z.string().optional(),
        invoicedDate: z.coerce.date().optional(),
        paymentTerms: z.number().int().min(0).optional(),
        currency: z.string().optional(),
        fromAddress: z.string().optional(),
        toAddress: z.string().optional(),
        description: z.string().optional(),
        customerId: z.string().optional(),
        receiverCompanyId: z.string().optional(),
        fileUrl: z.string().optional(),
        items: z.array(itemSchema).optional(),
        taxRate: z.number().min(0).optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, items: newItems, ...data } = input;
      const existing = await ctx.db.invoice.findUniqueOrThrow({ where: { id } });

      const updateData: Record<string, unknown> = { ...data };

      // Recalculate dueDate if invoicedDate or paymentTerms changed
      if (data.invoicedDate || data.paymentTerms) {
        const invoicedDate = data.invoicedDate ?? existing.invoicedDate;
        const paymentTerms = data.paymentTerms ?? existing.paymentTerms;
        const dueDate = new Date(invoicedDate);
        dueDate.setDate(dueDate.getDate() + paymentTerms);
        updateData.dueDate = dueDate;
      }

      // Recalculate totals if items changed
      if (newItems !== undefined) {
        const subtotal = newItems.reduce((sum, item) => sum + item.amount, 0);
        const taxRate = data.taxRate ?? Number(existing.taxRate);
        const taxAmount = subtotal * (taxRate / 100);
        updateData.subtotal = subtotal;
        updateData.taxAmount = taxAmount;
        updateData.amount = subtotal + taxAmount;

        // Replace items: delete all existing, create new
        await ctx.db.$transaction([
          ctx.db.$executeRaw`DELETE FROM "InvoiceItem" WHERE "invoiceId" = ${id}`,
        ]);
      }

      const invoice = await ctx.db.invoice.update({
        where: { id },
        data: {
          ...updateData,
          ...(newItems !== undefined
            ? {
                items: {
                  create: newItems.map((item, index) => ({
                    description: item.description,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    amount: item.amount,
                    sortOrder: index,
                  })),
                },
              }
            : {}),
          timelineItems: {
            create: { message: "Invoice updated" },
          },
        },
        include: { customer: true, items: true },
      });

      return invoice;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.invoice.delete({ where: { id: input.id } });
      return { success: true };
    }),

  bulkDelete: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.invoice.deleteMany({ where: { id: { in: input.ids } } });
      return { success: true, count: input.ids.length };
    }),

  bulkMarkPaid: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Move to PENDING_APPROVAL (receiver claiming payment)
      await ctx.db.invoice.updateMany({
        where: { id: { in: input.ids } },
        data: { invoiceStatus: "PENDING_APPROVAL" },
      });

      // Add timeline entries for each
      const invoices = await ctx.db.invoice.findMany({
        where: { id: { in: input.ids } },
        select: { id: true, invoiceNumber: true, senderCompanyId: true },
      });

      for (const inv of invoices) {
        await ctx.db.timelineItem.create({
          data: { invoiceId: inv.id, message: "Payment submitted — pending sender approval" },
        });

        // Notify sender
        const senderUsers = await ctx.db.user.findMany({
          where: { companyId: inv.senderCompanyId },
        });
        if (senderUsers.length > 0) {
          await ctx.db.notification.createMany({
            data: senderUsers.map((u) => ({
              message: `Invoice ${inv.invoiceNumber}: payment submitted, awaiting your approval`,
              type: "INVOICE_PAID" as const,
              userId: u.id,
              invoiceId: inv.id,
            })),
          });
        }
      }

      return { success: true, count: input.ids.length };
    }),

  send: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Fetch invoice with customer to check for email-based linking
      const existing = await ctx.db.invoice.findUniqueOrThrow({
        where: { id: input.id },
        include: { customer: true },
      });

      let receiverCompanyId = existing.receiverCompanyId;

      // If no receiverCompany yet, try to link via customer email
      if (!receiverCompanyId && existing.customer?.email) {
        const customerEmail = existing.customer.email.toLowerCase();

        // Check if customer is already linked to a company
        if (existing.customer.linkedCompanyId) {
          receiverCompanyId = existing.customer.linkedCompanyId;
        } else {
          // Try to find a company with this email on the platform
          const matchedCompany = await ctx.db.company.findFirst({
            where: { email: customerEmail },
          });

          if (matchedCompany) {
            receiverCompanyId = matchedCompany.id;
            // Link the customer for future sends
            await ctx.db.customer.update({
              where: { id: existing.customer.id },
              data: { linkedCompanyId: matchedCompany.id },
            });
          }
        }
      }

      const invoice = await ctx.db.invoice.update({
        where: { id: input.id },
        data: {
          invoiceStatus: "SENT",
          routingStatus: receiverCompanyId ? "PENDING" : "PENDING",
          receiverCompanyId,
          timelineItems: {
            create: {
              message: receiverCompanyId
                ? "Invoice sent to customer"
                : "Invoice sent (customer not yet on PayLane)",
            },
          },
        },
      });

      // Notify receiver company users if linked
      if (receiverCompanyId) {
        const receiverUsers = await ctx.db.user.findMany({
          where: { companyId: receiverCompanyId },
        });

        await ctx.db.notification.createMany({
          data: receiverUsers.map((u) => ({
            message: `New invoice received: ${invoice.invoiceNumber}`,
            type: "INVOICE_RECEIVED" as const,
            userId: u.id,
            invoiceId: invoice.id,
          })),
        });

        // Push notification
        void sendPushToCompany(receiverCompanyId, {
          title: "New Invoice Received",
          body: `Invoice ${invoice.invoiceNumber} — ${invoice.currency} ${Number(invoice.amount).toFixed(2)}`,
          url: `/invoices/${invoice.id}`,
          tag: `invoice-${invoice.id}`,
        });
      }

      // If customer is NOT on PayLane, send them an invite email
      if (!receiverCompanyId && existing.customer?.email) {
        const senderCompany = await ctx.db.company.findUniqueOrThrow({
          where: { id: invoice.senderCompanyId },
        });

        const signupUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/sign-up?email=${encodeURIComponent(existing.customer.email)}`;

        try {
          const result = await resend.emails.send({
            from: FROM_EMAIL,
            to: existing.customer.email,
            subject: `${senderCompany.name} sent you an invoice on PayLane`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
                <div style="text-align: center; margin-bottom: 32px;">
                  <h1 style="font-size: 24px; font-weight: 700; color: #2563eb; margin: 0;">PayLane</h1>
                </div>
                <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 32px;">
                  <h2 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 8px;">
                    You have a new invoice
                  </h2>
                  <p style="color: #6b7280; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
                    <strong style="color: #111827;">${senderCompany.name}</strong> sent you invoice
                    <strong style="color: #111827;">${invoice.invoiceNumber}</strong> for
                    <strong style="color: #111827;">${invoice.currency} ${Number(invoice.amount).toFixed(2)}</strong>.
                  </p>
                  <p style="color: #6b7280; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
                    Sign up on PayLane to view, manage, and pay your invoices faster.
                  </p>
                  <div style="text-align: center; margin: 32px 0;">
                    <a href="${signupUrl}" style="display: inline-block; background: #2563eb; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 8px;">
                      View Invoice & Sign Up
                    </a>
                  </div>
                </div>
                <div style="text-align: center; margin-top: 24px;">
                  <p style="color: #9ca3af; font-size: 12px; margin: 0;">PayLane — Get paid faster.</p>
                </div>
              </div>
            `,
          });
          console.log(`📧 Invoice email sent to ${existing.customer.email}:`, result);
        } catch (error) {
          console.error(`📧 Failed to send invoice email to ${existing.customer.email}:`, error);
        }
      }

      return invoice;
    }),

  togglePin: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.invoice.findUniqueOrThrow({
        where: { id: input.id },
      });

      return ctx.db.invoice.update({
        where: { id: input.id },
        data: { pinned: !existing.pinned },
      });
    }),

  /** Receiver schedules payment — "payment will come in X days" */
  schedulePayment: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        expectedPaymentDate: z.coerce.date(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const invoice = await ctx.db.invoice.update({
        where: { id: input.id },
        data: {
          expectedPaymentDate: input.expectedPaymentDate,
          timelineItems: {
            create: {
              message: `Payment scheduled for ${input.expectedPaymentDate.toLocaleDateString("en-SG", { year: "numeric", month: "short", day: "numeric" })}`,
            },
          },
        },
      });

      // Notify sender
      if (invoice.senderCompanyId) {
        const senderUsers = await ctx.db.user.findMany({
          where: { companyId: invoice.senderCompanyId },
        });

        await ctx.db.notification.createMany({
          data: senderUsers.map((u) => ({
            message: `Invoice ${invoice.invoiceNumber}: payment expected on ${input.expectedPaymentDate.toLocaleDateString("en-SG", { year: "numeric", month: "short", day: "numeric" })}`,
            type: "GENERAL" as const,
            userId: u.id,
            invoiceId: invoice.id,
          })),
        });
      }

      return invoice;
    }),

  /** Receiver claims payment — moves to PENDING_APPROVAL */
  markPaid: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invoice = await ctx.db.invoice.update({
        where: { id: input.id },
        data: {
          invoiceStatus: "PENDING_APPROVAL",
          timelineItems: {
            create: { message: "Payment submitted — pending sender approval" },
          },
        },
      });

      // Notify sender that receiver claims payment
      if (invoice.senderCompanyId) {
        const senderUsers = await ctx.db.user.findMany({
          where: { companyId: invoice.senderCompanyId },
        });

        await ctx.db.notification.createMany({
          data: senderUsers.map((u) => ({
            message: `Invoice ${invoice.invoiceNumber}: payment submitted, awaiting your approval`,
            type: "INVOICE_PAID" as const,
            userId: u.id,
            invoiceId: invoice.id,
          })),
        });

        void sendPushToCompany(invoice.senderCompanyId, {
          title: "Payment Submitted",
          body: `Invoice ${invoice.invoiceNumber} — awaiting your approval`,
          url: `/invoices/${invoice.id}`,
          tag: `payment-${invoice.id}`,
        });
      }

      return invoice;
    }),

  /** Sender approves the payment — moves to PAID */
  approvePayment: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invoice = await ctx.db.invoice.update({
        where: { id: input.id },
        data: {
          invoiceStatus: "PAID",
          timelineItems: {
            create: { message: "Payment approved" },
          },
        },
      });

      // Notify receiver that payment was approved
      if (invoice.receiverCompanyId) {
        const receiverUsers = await ctx.db.user.findMany({
          where: { companyId: invoice.receiverCompanyId },
        });

        await ctx.db.notification.createMany({
          data: receiverUsers.map((u) => ({
            message: `Invoice ${invoice.invoiceNumber}: payment approved`,
            type: "INVOICE_PAID" as const,
            userId: u.id,
            invoiceId: invoice.id,
          })),
        });

        void sendPushToCompany(invoice.receiverCompanyId, {
          title: "Payment Approved",
          body: `Invoice ${invoice.invoiceNumber} — payment confirmed`,
          url: `/invoices/${invoice.id}`,
          tag: `payment-${invoice.id}`,
        });
      }

      return invoice;
    }),

  /** Sender rejects the payment claim — moves back to SENT */
  rejectPayment: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invoice = await ctx.db.invoice.update({
        where: { id: input.id },
        data: {
          invoiceStatus: "SENT",
          timelineItems: {
            create: { message: "Payment rejected by sender" },
          },
        },
      });

      // Notify receiver that payment was rejected
      if (invoice.receiverCompanyId) {
        const receiverUsers = await ctx.db.user.findMany({
          where: { companyId: invoice.receiverCompanyId },
        });

        await ctx.db.notification.createMany({
          data: receiverUsers.map((u) => ({
            message: `Invoice ${invoice.invoiceNumber}: payment was rejected`,
            type: "GENERAL" as const,
            userId: u.id,
            invoiceId: invoice.id,
          })),
        });

        void sendPushToCompany(invoice.receiverCompanyId, {
          title: "Payment Rejected",
          body: `Invoice ${invoice.invoiceNumber} — payment was not accepted`,
          url: `/invoices/${invoice.id}`,
          tag: `payment-${invoice.id}`,
        });
      }

      return invoice;
    }),
});
