import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { createCaller } from "~/server/api/root";
import { db } from "~/lib/db";

type Caller = ReturnType<typeof createCaller>;

/**
 * Tool definitions exposed to the agent. Order matters — the LAST tool gets
 * cache_control set on it by the route, which caches system + all tools.
 */
export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_customers",
    description:
      "Search the user's customers by name, company, or email. Use this whenever the user mentions a customer to disambiguate which one they mean. Returns up to 20 matches.",
    input_schema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description:
            "Free-text search across customer company name, contact name, and email. Omit to list the most recent customers.",
        },
      },
    },
  },
  {
    name: "create_customer",
    description:
      "Create a new customer record. Only call this AFTER asking the user to confirm — never silently create. Returns the created customer.",
    input_schema: {
      type: "object",
      properties: {
        company: {
          type: "string",
          description: "Customer company name (required).",
        },
        name: {
          type: "string",
          description: "Contact person at the customer.",
        },
        email: { type: "string" },
        phone: { type: "string" },
        address: { type: "string" },
      },
      required: ["company"],
    },
  },
  {
    name: "list_invoices",
    description:
      "List recent invoices the user has sent. Useful for questions like 'what did I send last week' or 'which are still unpaid'. Returns up to 20.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["DRAFT", "SENT", "PAID", "OVERDUE", "CANCELLED"],
          description: "Filter by status.",
        },
        customerId: {
          type: "string",
          description: "Filter to a single customer (use list_customers first).",
        },
        limit: { type: "number", description: "Max results, default 20." },
      },
    },
  },
  {
    name: "get_invoice",
    description: "Get full details of a single invoice by id.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "create_invoice_draft",
    description:
      "Create a DRAFT invoice. Required: customerId and amount (total). Plus either invoicedDate (defaults to today) and dueDate (or paymentTerms — defaults to 30 days). Defaults: SGD, no tax, 'Services' description, auto-numbered (e.g. INV-007). The amount the user says is the TOTAL — don't add tax unless the user explicitly mentions GST/VAT/tax. After creating, summarise (customer, amount, dates) and ask the user to confirm before send_invoice.",
    input_schema: {
      type: "object",
      properties: {
        customerId: {
          type: "string",
          description: "Resolved via list_customers.",
        },
        amount: {
          type: "number",
          description: "Total invoice amount the customer will pay.",
        },
        invoicedDate: {
          type: "string",
          description: "ISO date YYYY-MM-DD. Defaults to today.",
        },
        dueDate: {
          type: "string",
          description: "ISO date YYYY-MM-DD. Provide this OR paymentTerms.",
        },
        paymentTerms: {
          type: "number",
          description: "Days until due. Default 30. Ignored if dueDate is set.",
        },
        description: {
          type: "string",
          description: "Short description of what the invoice is for. Defaults to 'Services'.",
        },
        currency: { type: "string", description: "Default SGD." },
        taxRate: {
          type: "number",
          description: "Percentage. Default 0 (no tax). Only set if the user explicitly asked for GST/tax.",
        },
        invoiceNumber: { type: "string" },
        reference: { type: "string" },
        notes: { type: "string" },
      },
      required: ["customerId", "amount"],
    },
  },
  {
    name: "send_invoice",
    description:
      "Send a DRAFT invoice. ONLY call this after the user has explicitly confirmed they want to send (e.g. they said 'yes', 'send it', 'go ahead'). NEVER call this without an explicit confirmation in the immediately preceding user message.",
    input_schema: {
      type: "object",
      properties: {
        invoiceId: { type: "string" },
      },
      required: ["invoiceId"],
    },
  },
  {
    name: "get_dashboard_summary",
    description:
      "Get high-level totals for the company: how much was billed, received, paid, and outstanding this month / last 30 days. Use for 'how am I doing' style questions.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
];

/** Auto-generate the next invoice number for a company (INV-001, INV-002, ...). */
async function nextInvoiceNumber(companyId: string): Promise<string> {
  const existing = await db.invoice.findMany({
    where: { senderCompanyId: companyId },
    select: { invoiceNumber: true },
  });
  let max = 0;
  for (const inv of existing) {
    const m = /(\d+)$/.exec(inv.invoiceNumber);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  return `INV-${String(max + 1).padStart(3, "0")}`;
}

/**
 * Execute a tool call. Errors are caught at the route layer and fed back to
 * the agent as is_error tool_results so it can recover gracefully.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  caller: Caller,
  ctx: { companyId: string },
): Promise<unknown> {
  switch (name) {
    case "list_customers": {
      const search =
        typeof input.search === "string" ? input.search : undefined;
      const res = await caller.customer.list({ search, page: 1, limit: 20 });
      // Trim to essentials so we don't blow context on every call
      return {
        customers: res.customers.map((c) => ({
          id: c.id,
          company: c.company,
          name: c.name,
          email: c.email,
          phone: c.phone,
          invoices: c._count.invoices,
        })),
        totalCount: res.totalCount,
      };
    }

    case "create_customer": {
      const out = await caller.customer.create({
        company: String(input.company ?? ""),
        name: input.name ? String(input.name) : undefined,
        email: input.email ? String(input.email) : undefined,
        phone: input.phone ? String(input.phone) : undefined,
        address: input.address ? String(input.address) : undefined,
      });
      return { id: out.id, company: out.company, name: out.name, email: out.email };
    }

    case "list_invoices": {
      const STATUSES = [
        "DRAFT",
        "SENT",
        "PENDING_APPROVAL",
        "PAID",
        "OVERDUE",
        "CANCELLED",
      ] as const;
      type Status = (typeof STATUSES)[number];
      const status =
        typeof input.status === "string" &&
        (STATUSES as readonly string[]).includes(input.status)
          ? (input.status as Status)
          : undefined;
      const customerId =
        typeof input.customerId === "string" ? input.customerId : undefined;
      const limit =
        typeof input.limit === "number"
          ? Math.min(50, Math.max(1, input.limit))
          : 20;
      const res = await caller.invoice.list({
        type: "sent",
        status,
        customerId,
        page: 1,
        limit,
      });
      return {
        invoices: res.invoices.map((i) => ({
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          status: i.invoiceStatus,
          amount: Number(i.amount),
          currency: i.currency,
          invoicedDate: i.invoicedDate,
          dueDate: i.dueDate,
          customer: i.customer
            ? {
                id: i.customer.id,
                company: i.customer.company,
                name: i.customer.name,
              }
            : null,
        })),
        totalCount: res.totalCount,
      };
    }

    case "get_invoice": {
      const id = String(input.id ?? "");
      const inv = await caller.invoice.getById({ id });
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        status: inv.invoiceStatus,
        amount: Number(inv.amount),
        subtotal: Number(inv.subtotal),
        taxRate: Number(inv.taxRate),
        taxAmount: Number(inv.taxAmount),
        currency: inv.currency,
        invoicedDate: inv.invoicedDate,
        dueDate: inv.dueDate,
        notes: inv.notes,
        reference: inv.reference,
        customer: inv.customer,
        items: inv.items.map((it) => ({
          description: it.description,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
          amount: Number(it.amount),
        })),
      };
    }

    case "create_invoice_draft": {
      const amount = Number(input.amount ?? 0);
      const description =
        typeof input.description === "string" && input.description.trim()
          ? input.description.trim()
          : "Services";
      const today = new Date();
      const invoicedDate =
        typeof input.invoicedDate === "string"
          ? new Date(input.invoicedDate)
          : today;

      // dueDate wins over paymentTerms if both given.
      let paymentTerms =
        typeof input.paymentTerms === "number" ? input.paymentTerms : 30;
      if (typeof input.dueDate === "string") {
        const due = new Date(input.dueDate);
        paymentTerms = Math.max(
          0,
          Math.round(
            (due.getTime() - invoicedDate.getTime()) / (1000 * 60 * 60 * 24),
          ),
        );
      }

      const taxRate = typeof input.taxRate === "number" ? input.taxRate : 0;
      const subtotal = amount;
      const taxAmount = +(subtotal * (taxRate / 100)).toFixed(2);
      const totalAmount = +(subtotal + taxAmount).toFixed(2);

      const invoiceNumber =
        typeof input.invoiceNumber === "string" && input.invoiceNumber.trim()
          ? input.invoiceNumber.trim()
          : await nextInvoiceNumber(ctx.companyId);

      const out = await caller.invoice.create({
        invoiceNumber,
        invoicedDate,
        paymentTerms,
        currency:
          typeof input.currency === "string" && input.currency.length
            ? input.currency
            : "SGD",
        taxRate,
        customerId:
          typeof input.customerId === "string" ? input.customerId : undefined,
        notes: typeof input.notes === "string" ? input.notes : undefined,
        reference:
          typeof input.reference === "string" ? input.reference : undefined,
        items: [
          {
            description,
            quantity: 1,
            unitPrice: subtotal,
            amount: subtotal,
            sortOrder: 0,
          },
        ],
        subtotal,
        taxAmount,
        totalAmount,
      });

      return {
        id: out.id,
        invoiceNumber: out.invoiceNumber,
        status: out.invoiceStatus,
        amount: Number(out.amount),
        currency: out.currency,
        dueDate: out.dueDate,
        customer: out.customer
          ? { id: out.customer.id, company: out.customer.company }
          : null,
        message:
          "Draft created. Summarise it (customer, amount, due date) and ask the user to confirm before calling send_invoice.",
      };
    }

    case "send_invoice": {
      const invoiceId = String(input.invoiceId ?? "");
      await caller.invoice.send({ id: invoiceId });
      return { success: true, sentAt: new Date().toISOString() };
    }

    case "get_dashboard_summary": {
      const summary = await caller.dashboard.getSummary();
      return summary;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
