import { auth, currentUser } from "@clerk/nextjs/server";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { db } from "~/lib/db";
import { syncCustomerReceivers } from "~/server/api/lib/customer-routing";

/**
 * Auto-provision a User + Company on first authenticated request.
 * This avoids the need for a separate webhook to seed the database.
 */
// Prevent concurrent ensureUser calls from creating duplicate companies
const pendingUsers = new Map<string, Promise<{ id: string; clerkId: string; email: string; companyId: string }>>();

async function ensureUser(clerkUserId: string) {
  const existing = await db.user.findUnique({
    where: { clerkId: clerkUserId },
  });
  if (existing) return existing;

  // Deduplicate concurrent calls for the same user
  if (pendingUsers.has(clerkUserId)) {
    return pendingUsers.get(clerkUserId)!;
  }

  const promise = createUserAndCompany(clerkUserId);
  pendingUsers.set(clerkUserId, promise);
  try {
    return await promise;
  } finally {
    pendingUsers.delete(clerkUserId);
  }
}

async function createUserAndCompany(clerkUserId: string) {
  // Double-check after getting the "lock"
  const doubleCheck = await db.user.findUnique({ where: { clerkId: clerkUserId } });
  if (doubleCheck) return doubleCheck;

  const clerkUser = await currentUser();
  const email =
    clerkUser?.emailAddresses[0]?.emailAddress ?? `${clerkUserId}@placeholder`;
  const name =
    [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") ||
    null;

  // Create a personal company for this user
  const company = await db.company.create({
    data: {
      name: name ? `${name}'s Company` : "My Company",
      email: email.toLowerCase(),
      module: "BOTH",
    },
  });

  const user = await db.user.create({
    data: {
      clerkId: clerkUserId,
      email,
      name,
      companyId: company.id,
    },
  });

  // Auto-link: find all Customer records that match this email
  // and link them to the new company. This connects invoices
  // sent to this email before the user signed up.
  const normalizedEmail = email.toLowerCase();

  await db.customer.updateMany({
    where: {
      email: normalizedEmail,
      linkedCompanyId: null,
    },
    data: {
      linkedCompanyId: company.id,
    },
  });

  // Also set receiverCompanyId on any invoices sent to those customers
  const linkedCustomers = await db.customer.findMany({
    where: {
      email: normalizedEmail,
      linkedCompanyId: company.id,
    },
    select: { id: true },
  });

  if (linkedCustomers.length > 0) {
    // Re-route invoices AND statements for each linked customer to the
    // new company. This handles both the "never delivered" case
    // (receiverCompanyId null) and the drift case where an earlier wrong
    // link parked the rows on a different company.
    for (const c of linkedCustomers) {
      await syncCustomerReceivers(db, c.id);
    }

    // Auto-assign BOTH module — invitee may also want to send invoices
    await db.company.update({
      where: { id: company.id },
      data: { module: "BOTH" },
    });

    // Mark invitations as accepted
    await db.invitation.updateMany({
      where: {
        email: normalizedEmail,
        status: "PENDING",
      },
      data: {
        status: "ACCEPTED",
      },
    });
  }

  return user;
}

export const createTRPCContext = async (opts: { headers: Headers }) => {
  const authData = await auth();
  return {
    db,
    auth: authData,
    ...opts,
  };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createCallerFactory = t.createCallerFactory;
export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

const isAuth = t.middleware(async ({ next, ctx }) => {
  if (!ctx.auth.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  // Auto-provision user + company on first request
  const user = await ensureUser(ctx.auth.userId);

  return next({
    ctx: {
      auth: ctx.auth,
      user,
    },
  });
});

export const protectedProcedure = t.procedure.use(isAuth);
