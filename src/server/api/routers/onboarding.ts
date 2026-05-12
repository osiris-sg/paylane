import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { z } from "zod";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.EMAIL_FROM ?? "PayLane <onboarding@resend.dev>";

async function sendInviteEmail({
  to,
  supplierCompanyName,
  senderCompanyName,
}: {
  to: string;
  supplierCompanyName: string;
  senderCompanyName: string;
}) {
  const signupUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/sign-up?email=${encodeURIComponent(to)}`;

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${senderCompanyName} invited you to PayLane`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="font-size: 24px; font-weight: 700; color: #2563eb; margin: 0;">PayLane</h1>
          </div>
          <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 32px;">
            <h2 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 8px;">
              You've been invited!
            </h2>
            <p style="color: #6b7280; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
              <strong style="color: #111827;">${senderCompanyName}</strong> wants to pay you faster using PayLane.
              Sign up to send and manage invoices to ${senderCompanyName}.
            </p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${signupUrl}" style="display: inline-block; background: #2563eb; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 8px;">
                Create Your Account
              </a>
            </div>
            <p style="color: #9ca3af; font-size: 13px; line-height: 1.5; margin: 0;">
              Hi ${supplierCompanyName},<br/><br/>
              Once you sign up, ${senderCompanyName} will already be in your customer list.
              You can start sending invoices right away.
            </p>
          </div>
          <div style="text-align: center; margin-top: 24px;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">
              PayLane — Get paid faster.
            </p>
          </div>
        </div>
      `,
    });
    console.log(`Invite email sent to ${to}`);
  } catch (error) {
    console.error(`Failed to send invite email to ${to}:`, error);
    // Don't throw — we still want the supplier to be created even if email fails
  }
}

export const onboardingRouter = createTRPCRouter({
  /** Get current company onboarding status */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { clerkId: ctx.auth.userId },
      include: { company: true },
    });

    // Check if this company was invited (has linked customers pointing to it)
    const linkedFrom = await ctx.db.customer.findFirst({
      where: { linkedCompanyId: user.companyId },
      select: { company: true },
    });

    // Find first received invoice to deep-link after onboarding
    const firstInvoice = await ctx.db.invoice.findFirst({
      where: { receiverCompanyId: user.companyId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    return {
      onboarded: user.company.onboarded,
      module: user.company.module,
      companyName: user.company.name,
      companyId: user.company.id,
      companyPhone: user.company.phone,
      // Prefill data from invitation
      userEmail: user.email,
      invitedByCompanyName: linkedFrom?.company ?? null,
      firstInvoiceId: firstInvoice?.id ?? null,
    };
  }),

  /** Set the company module (RECEIVE or SEND) */
  setModule: protectedProcedure
    .input(z.object({ module: z.enum(["RECEIVE", "SEND"]) }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });

      return ctx.db.company.update({
        where: { id: user.companyId },
        data: { module: input.module },
      });
    }),

  /** Update company profile during onboarding */
  updateCompany: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });

      return ctx.db.company.update({
        where: { id: user.companyId },
        data: input,
      });
    }),

  /** Add suppliers (creates Customer records + Invitations) */
  addSuppliers: protectedProcedure
    .input(
      z.object({
        suppliers: z.array(
          z.object({
            companyName: z.string().min(1),
            email: z.string().email(),
            contactName: z.string().optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUniqueOrThrow({
        where: { clerkId: ctx.auth.userId },
      });

      const results: { email: string; status: "created" | "linked" | "exists" }[] = [];

      for (const supplier of input.suppliers) {
        // Check if customer with this email already exists for this company
        const existingCustomer = await ctx.db.customer.findFirst({
          where: {
            companyId: user.companyId,
            email: supplier.email.toLowerCase(),
          },
        });

        if (existingCustomer) {
          results.push({ email: supplier.email, status: "exists" });
          continue;
        }

        // Check if a Company with this email already exists on the platform
        const existingCompany = await ctx.db.company.findFirst({
          where: { email: supplier.email.toLowerCase() },
        });

        // Create the Customer record
        await ctx.db.customer.create({
          data: {
            name: supplier.contactName || supplier.companyName,
            email: supplier.email.toLowerCase(),
            company: supplier.companyName,
            companyId: user.companyId,
            linkedCompanyId: existingCompany?.id ?? null,
          },
        });

        // Create invitation (upsert to avoid dupes)
        await ctx.db.invitation.upsert({
          where: {
            email_senderCompanyId: {
              email: supplier.email.toLowerCase(),
              senderCompanyId: user.companyId,
            },
          },
          create: {
            email: supplier.email.toLowerCase(),
            companyName: supplier.companyName,
            senderCompanyId: user.companyId,
            status: existingCompany ? "ACCEPTED" : "PENDING",
          },
          update: {},
        });

        // Send invite email if supplier is not yet on the platform
        if (!existingCompany) {
          const senderCompany = await ctx.db.company.findUniqueOrThrow({
            where: { id: user.companyId },
          });

          await sendInviteEmail({
            to: supplier.email.toLowerCase(),
            supplierCompanyName: supplier.companyName,
            senderCompanyName: senderCompany.name,
          });
        }

        results.push({
          email: supplier.email,
          status: existingCompany ? "linked" : "created",
        });
      }

      return results;
    }),

  /** Mark onboarding as complete */
  complete: protectedProcedure.mutation(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { clerkId: ctx.auth.userId },
    });

    return ctx.db.company.update({
      where: { id: user.companyId },
      data: { onboarded: true },
    });
  }),

  /** Get pending invitations sent by this company */
  getInvitations: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { clerkId: ctx.auth.userId },
    });

    return ctx.db.invitation.findMany({
      where: { senderCompanyId: user.companyId },
      orderBy: { createdAt: "desc" },
    });
  }),
});
