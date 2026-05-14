import { db } from "~/lib/db";

async function main() {
  const id = "cmp59zmsj0005l804hxfem9al";
  const inv = await db.invoice.findUnique({
    where: { id },
    include: {
      senderCompany: { select: { id: true, name: true } },
      receiverCompany: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, email: true, company: true, linkedCompanyId: true } },
    },
  });
  if (!inv) {
    console.log("No invoice with id", id);
    return;
  }
  console.log("INVOICE:", {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    invoiceStatus: inv.invoiceStatus,
    sentAt: inv.sentAt,
    senderCompanyId: inv.senderCompanyId,
    senderCompanyName: inv.senderCompany?.name,
    receiverCompanyId: inv.receiverCompanyId,
    receiverCompanyName: inv.receiverCompany?.name,
    customer: inv.customer,
    viewedAt: inv.viewedAt,
  });

  const user = await db.user.findFirst({
    where: { email: { contains: "kumara.guru", mode: "insensitive" } },
    include: { company: { select: { id: true, name: true } } },
  });
  console.log("\nUSER:", {
    id: user?.id,
    email: user?.email,
    companyId: user?.companyId,
    companyName: user?.company.name,
  });

  if (user && inv.receiverCompanyId !== user.companyId && inv.senderCompanyId !== user.companyId) {
    console.log("\n!! MISMATCH: invoice is not on this user's company");
    console.log("   invoice.receiverCompanyId =", inv.receiverCompanyId);
    console.log("   invoice.senderCompanyId   =", inv.senderCompanyId);
    console.log("   user.companyId            =", user.companyId);
  }
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
