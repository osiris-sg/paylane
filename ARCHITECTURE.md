# Architecture — Database & tRPC

This document explains how **paylane** (package name `invoice-platform`, product
name *E-StatementNow*) is wired together: the database connection, the Prisma
data model, and the end-to-end tRPC stack from React component → HTTP → server
procedure → Postgres.

## Stack at a glance

| Concern        | Technology |
| -------------- | ---------- |
| Framework      | Next.js 14 (App Router, RSC) |
| API layer      | tRPC v11 (`@trpc/server`, `@trpc/react-query`, `@trpc/client`) |
| Data fetching  | TanStack Query v5 + SuperJSON transformer |
| ORM            | Prisma 6 (`@prisma/client`) |
| Database       | PostgreSQL (Neon, `ap-southeast-1`) |
| Auth           | Clerk (`@clerk/nextjs`) |
| Hosting        | Vercel (`ap-southeast-1`) |
| File storage   | AWS S3 (presigned URLs) |
| AI extraction  | Anthropic Claude (`@anthropic-ai/sdk`) |

---

## 1. Database connection

### Provider & URL
- **Postgres** via the Prisma datasource in `prisma/schema.prisma`:
  ```prisma
  datasource db {
    provider = "postgresql"
    url      = env("DATABASE_URL")
  }
  ```
- `DATABASE_URL` is the only DB env var (see `.env.example`). In production this
  points at **Neon** (same AWS region as Vercel — `ap-southeast-1` — to keep
  round-trip latency low).

### The singleton client — `src/lib/db.ts`
A single `PrismaClient` is created and cached on `globalThis` so Next.js hot
reloads (dev) don't open a new pool on every change:

```ts
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development"
      ? ["query", "error", "warn"]
      : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
```

- In **dev**, the instance is stashed on `globalForPrisma.prisma` and reused.
- In **prod**, a fresh client is created per serverless cold start; query logging
  is reduced to errors only.
- Everything in the app imports this one `db` — never instantiate `PrismaClient`
  elsewhere.

### Schema management
- `npm run db:push` → `prisma db push` (schema-first; no migration files in repo).
- `prisma generate` runs on `postinstall` and as part of `npm run build`, so the
  generated client is always in sync with `schema.prisma`.

---

## 2. Data model (Prisma schema)

All tables are **multi-tenant, scoped by `Company`**. The central pivot is the
`Company` ↔ `User` relationship; every business document hangs off a company as
either a **sender** or a **receiver**.

### Core entities
- **`Company`** — the tenant. Linked to a Clerk org via `clerkOrgId`. Carries the
  `module` (SEND / RECEIVE / BOTH), the `sendingPlan` (LOCKED / TRIAL / EXPIRED /
  PAID) with trial dates, and feature gates like `deliveryOrdersEnabled`.
  `isStub` marks auto-created placeholder companies discovered via email
  ingestion.
- **`User`** — a person. `clerkId` is unique and is the join key to Clerk auth.
  Belongs to exactly one `Company`. Holds WhatsApp opt-in fields.
- **`Customer`** / **`Supplier`** — a company's address-book entries. Each has an
  `owner` company (`companyId`) and an optional `linkedCompany` — the *real*
  E-StatementNow company behind that contact, set once a counterpart signs up.
  This linking is what connects an invoice sent "into the void" to a real
  recipient later.

### Documents (each has sender + optional receiver company)
- **`Invoice`** — the main artifact. `senderCompanyId` (required),
  `receiverCompanyId` (nullable until routed), `customerId`, `routingStatus`
  (PENDING / ACKNOWLEDGED / FAILED), `source` (MANUAL / EMAIL_FORWARD), money as
  `Decimal(12,2)`, plus `InvoiceItem[]`, `TimelineItem[]`, `Notification[]`.
  Unique on `(invoiceNumber, senderCompanyId)`.
- **`Statement`** (SOA) — **one-per-customer** (`@@unique([customerId])`): a new
  statement *replaces* the previous one.
- **`DeliveryOrder`** — gated feature; **many-per-customer** (unlike Statement).
  `fileUrl` holds an S3 object key.
- **`InvoiceItem`**, **`TimelineItem`** — children of `Invoice` (cascade delete).

### Email ingestion
- **`EmailIntegration`** — per-company inbound `inboundToken` used in a plus-
  address (`...+<token>@cloudmailin.net`); optional Gmail/Outlook OAuth fields.
- **`IngestedEmail`** — one row per forwarded email; tracks parse `status`
  (RECEIVED → PARSED / IGNORED / FAILED / CONFIRMATION) and links to the created
  `Invoice`.

### Supporting tables
- **`Notification`** (+ `NotificationType` enum), **`PushSubscription`** (web-push
  per `clerkId`), **`Invitation`** (supplier invites), **`FeatureFlag`** (global
  key/enabled toggles).

### Indexing strategy
Because every query filters by tenant, composite indexes lead with the company
id, e.g. on `Invoice`:
```
@@index([senderCompanyId, dueDate])
@@index([receiverCompanyId, dueDate])
@@index([senderCompanyId, invoicedDate])   // monthly / aging charts
@@index([receiverCompanyId, invoicedDate])
@@index([customerId])
```

---

## 3. tRPC stack

tRPC gives end-to-end type safety: the server router types flow to the client
with no codegen. SuperJSON is the transformer everywhere, so `Date`, `Decimal`,
`Map`, etc. survive the wire.

### 3a. Context & procedures — `src/server/api/trpc.ts`
`createTRPCContext` builds the per-request context from Clerk auth + the shared
`db`:

```ts
export const createTRPCContext = async (opts: { headers: Headers }) => {
  const authData = await auth();          // Clerk
  return { db, auth: authData, ...opts };
};
```

The tRPC instance is initialized with SuperJSON and a Zod-aware error formatter
(surfaces `zodError` to the client). It exports:
- `createTRPCRouter` — router factory
- `publicProcedure` — no auth
- `protectedProcedure` — runs the `isAuth` middleware

**`protectedProcedure` / `isAuth` middleware** does two things:
1. Rejects unauthenticated requests (`UNAUTHORIZED` if no `ctx.auth.userId`).
2. **Auto-provisions** a `User` + personal `Company` on first request via
   `ensureUser()` — no separate Clerk webhook is needed to seed the DB. It also
   auto-links pre-existing `Customer` rows that match the user's email (so
   invoices sent before signup get routed), accepts pending invitations, and
   dedupes concurrent calls with an in-memory `pendingUsers` map.

The middleware then narrows the context, exposing the resolved `user` (and thus
`user.companyId`) to every protected procedure. Routers read `ctx.user` and
`ctx.db`.

### 3b. Root router — `src/server/api/root.ts`
All feature routers are merged into one `appRouter`, and its type is exported for
the client:

```ts
export const appRouter = createTRPCRouter({
  invoice, customer, supplier, notification, dashboard, onboarding,
  admin, featureFlag, subscription, statement, deliveryOrder,
  emailIntegration, storage,
});
export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
```

Routers live in `src/server/api/routers/*.ts`. Procedure counts give a feel for
where the logic lives: `invoice` (17), `deliveryOrder` (13), `statement` (13),
`supplier` (9), `customer` (8), `notification` (8), `onboarding` (7), `admin`
(6), `emailIntegration` (5). Shared helpers sit in `src/server/api/lib/`
(`sending-access`, `time-series`, `customer-routing`).

**Typical procedure shape** (from `customer.ts`) — Zod-validated input, tenant
scoping by `ctx.user.companyId`, parallel count for pagination:
```ts
list: protectedProcedure
  .input(z.object({ search: z.string().optional(),
                    page: z.number().min(1).default(1),
                    limit: z.number().min(1).max(100).default(20) }))
  .query(async ({ ctx, input }) => {
    const where = { companyId: ctx.user.companyId, /* + search OR */ };
    const [rows, total] = await Promise.all([
      ctx.db.customer.findMany({ where, skip, take, include: {...} }),
      ctx.db.customer.count({ where }),
    ]);
    ...
  });
```

### 3c. HTTP entry point — `src/app/api/trpc/[trpc]/route.ts`
A single Next.js route handler bridges HTTP → tRPC using the fetch adapter, for
both `GET` and `POST`, at the endpoint `/api/trpc`:
```ts
const handler = (req) => fetchRequestHandler({
  endpoint: "/api/trpc",
  req, router: appRouter,
  createContext: () => createTRPCContext({ headers: req.headers }),
  onError: dev ? logToConsole : undefined,
});
export { handler as GET, handler as POST };
```

### 3d. Client (React) — `src/trpc/react.tsx`
For client components. `createTRPCReact<AppRouter>()` produces the typed `api`
hooks. The provider sets up:
- a singleton `QueryClient` (one per browser tab; fresh per request on server),
- a `loggerLink` (verbose in dev / on errors),
- an **`unstable_httpBatchStreamLink`** with the SuperJSON transformer pointing at
  `/api/trpc` — batches calls and streams responses.

It also re-exports the inferred `RouterInputs` / `RouterOutputs` helper types.
~31 files import from `~/trpc/react` and call e.g. `api.invoice.list.useQuery()`.

### 3e. Server (RSC) — `src/trpc/server.ts`
For React Server Components. Instead of HTTP, it uses a **direct caller**
(`createCaller`) so server components hit procedures in-process (no network hop),
wrapped in React `cache` for per-render reuse. It exports:
- `api` — call/prefetch procedures from server components
  (e.g. `api.dashboard.getSummary.prefetch()`),
- `HydrateClient` — wraps a subtree so server-prefetched data hydrates on the
  client without a refetch.

The shared `createQueryClient` (`src/trpc/query-client.ts`) configures SuperJSON
(de)serialization and `shouldDehydrateQuery` for pending queries, enabling
streaming prefetch with clean hydration. Default query options:
`refetchOnWindowFocus: false`, `staleTime: 30s`.

### 3f. Provider mount — `src/app/_providers.tsx`
Composed top-down: `ThemeProvider` → `Toaster` → `ClerkProvider` →
`TRPCReactProvider`. Clerk wraps tRPC so auth context is available when the tRPC
client issues requests.

---

## 4. Request lifecycle (end to end)

**Client component query:**
```
api.invoice.list.useQuery(input)            // src/trpc/react.tsx (typed hook)
   → httpBatchStreamLink (SuperJSON encode)
   → POST /api/trpc                          // route.ts (fetch adapter)
   → createTRPCContext: Clerk auth() + db
   → protectedProcedure → isAuth → ensureUser(clerkUserId)
   → invoiceRouter.list resolver: Zod-validate, scope by ctx.user.companyId
   → ctx.db.invoice.findMany(...)            // Prisma → Postgres (Neon)
   → SuperJSON encode → TanStack Query cache → component re-render
```

**Server component (RSC):**
```
api.dashboard.getSummary.prefetch()          // src/trpc/server.ts (direct caller)
   → in-process createCaller (no HTTP)
   → same context + middleware + resolver + Prisma
   → data dehydrated → <HydrateClient> → client hydrates without refetch
```

---

## 5. Where to make changes

| Task | File(s) |
| ---- | ------- |
| Add/alter a table or column | `prisma/schema.prisma`, then `npm run db:push` |
| Add a new API procedure | `src/server/api/routers/<feature>.ts` |
| Register a new router | `src/server/api/root.ts` |
| Change auth / auto-provisioning | `src/server/api/trpc.ts` |
| Tune query caching / hydration | `src/trpc/query-client.ts` |
| Change the DB client / logging | `src/lib/db.ts` |
| Shared server helpers | `src/server/api/lib/*` |
