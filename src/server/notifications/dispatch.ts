import { db } from "~/lib/db";
import { sendWhatsAppTemplate, type WhatsAppTemplate } from "./whatsapp";

/**
 * Fan a WhatsApp template send out to every user in a company who has
 * opted in and provided a number. Errors are swallowed per user so one
 * bad number doesn't block the rest.
 */
export async function sendWhatsAppToCompany(
  companyId: string,
  message: WhatsAppTemplate,
  options?: { buttonUrlSlug?: string },
) {
  const recipients = await db.user.findMany({
    where: {
      companyId,
      whatsappOptIn: true,
      whatsappNumber: { not: null },
    },
    select: { id: true, whatsappNumber: true },
  });

  if (recipients.length === 0) return;

  await Promise.allSettled(
    recipients.map((u) =>
      sendWhatsAppTemplate({
        to: u.whatsappNumber!,
        message,
        buttonUrlSlug: options?.buttonUrlSlug,
      }),
    ),
  );
}

/**
 * Send a template to a single user (by user.id). Looks up their opt-in
 * status and number internally.
 */
export async function sendWhatsAppToUser(userId: string, message: WhatsAppTemplate) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { whatsappNumber: true, whatsappOptIn: true },
  });
  if (!user || !user.whatsappOptIn || !user.whatsappNumber) return;
  await sendWhatsAppTemplate({ to: user.whatsappNumber, message });
}
