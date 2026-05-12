import type { PrismaClient } from "@prisma/client";

/**
 * Force all invoices and statements that belong to this customer to have
 * receiverCompanyId == customer.linkedCompanyId. Returns counts of what
 * was actually changed.
 *
 * Call this whenever a customer's linkedCompanyId is set or changed — at
 * sign-up back-fill, at first-send link, or via any admin action — so
 * stored deliveries stay in sync with the customer's current link.
 */
export async function syncCustomerReceivers(
  db: PrismaClient,
  customerId: string,
): Promise<{ invoicesUpdated: number; statementsUpdated: number }> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { linkedCompanyId: true },
  });
  if (!customer?.linkedCompanyId) {
    return { invoicesUpdated: 0, statementsUpdated: 0 };
  }
  const link = customer.linkedCompanyId;

  const mismatch = {
    customerId,
    OR: [
      { receiverCompanyId: null },
      { receiverCompanyId: { not: link } },
    ],
  };

  const [inv, stmt] = await Promise.all([
    db.invoice.updateMany({ where: mismatch, data: { receiverCompanyId: link } }),
    db.statement.updateMany({ where: mismatch, data: { receiverCompanyId: link } }),
  ]);
  return { invoicesUpdated: inv.count, statementsUpdated: stmt.count };
}
