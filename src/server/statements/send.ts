import "server-only";

import { Resend } from "resend";
import { sendPushToCompany } from "~/lib/push-notifications";
import { sendWhatsAppToCompany } from "~/server/notifications/dispatch";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.EMAIL_FROM ?? "E-StatementNow <onboarding@resend.dev>";

export async function persistAndDispatch({
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

  await ctx.db.timelineItem.create({
    data: {
      statementId: statement.id,
      message: isUpdate
        ? "Statement replaced with a new version"
        : "Statement sent to customer",
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
                    <strong>${senderCompany.name}</strong> just sent you a statement of account on E-StatementNow.
                  </p>
                  <p style="color: #4b5563; font-size: 15px; line-height: 1.6;">
                    Open E-StatementNow to view the file.
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
