import { env } from "~/env";

/**
 * WhatsApp Cloud API client (Meta direct, no Twilio).
 *
 * Setup:
 *   1. Create a WhatsApp Business Account in Meta Business Manager
 *   2. Add a phone number → note the Phone Number ID (numeric, e.g. 1234567890)
 *   3. Generate a permanent access token (System User > grant `whatsapp_business_messaging`)
 *   4. Submit each template below for approval; once Meta approves, the
 *      template is referenced by NAME (not SID) — no extra env per template.
 *
 * Templates referenced here must exist with the exact name + variable count
 * in your WABA before sending will succeed.
 */

const API_VERSION = env.META_WHATSAPP_API_VERSION ?? "v21.0";

const templates = {
  invoice_received: {
    name: "paylane_invoice_received",
    vars: ["senderName", "invoiceNumber", "amount"] as const,
  },
  payment_submitted: {
    name: "paylane_payment_submitted",
    vars: ["receiverName", "invoiceNumber", "amount"] as const,
  },
  payment_approved: {
    name: "paylane_payment_approved",
    vars: ["invoiceNumber", "amount"] as const,
  },
  payment_due_soon: {
    name: "paylane_payment_due_soon",
    vars: ["invoiceNumber", "daysUntilDue"] as const,
  },
  payment_overdue: {
    name: "paylane_payment_overdue",
    vars: ["invoiceNumber", "daysOverdue"] as const,
  },
  verification: {
    name: "paylane_verification",
    vars: ["code"] as const,
  },
} as const;

export type WhatsAppTemplate = {
  [K in keyof typeof templates]: {
    template: K;
    contentVariables: {
      [V in (typeof templates)[K]["vars"][number]]: string;
    };
  };
}[keyof typeof templates];

/**
 * Meta expects E.164 without the leading "+", e.g. 6591234567.
 */
function normalisePhone(to: string): string {
  return to.replace(/^whatsapp:/, "").replace(/^\+/, "").replace(/\s+/g, "");
}

function isConfigured() {
  return !!(env.META_WHATSAPP_PHONE_NUMBER_ID && env.META_WHATSAPP_ACCESS_TOKEN);
}

async function call(path: string, body: unknown) {
  const url = `https://graph.facebook.com/${API_VERSION}/${env.META_WHATSAPP_PHONE_NUMBER_ID}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.META_WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>;
    error?: { message?: string; code?: number };
  };
  if (!res.ok || json.error) {
    return {
      ok: false as const,
      error: json.error?.message ?? `Meta API ${res.status}`,
    };
  }
  return { ok: true as const, sid: json.messages?.[0]?.id };
}

export async function sendWhatsAppTemplate(input: {
  to: string;
  message: WhatsAppTemplate;
}): Promise<{ ok: boolean; sid?: string; error?: string }> {
  if (!isConfigured()) {
    return { ok: false, error: "Meta WhatsApp not configured" };
  }

  const def = templates[input.message.template];
  const parameters = def.vars.map((name) => ({
    type: "text" as const,
    text: (input.message.contentVariables as Record<string, string>)[name] ?? "",
  }));

  return call("/messages", {
    messaging_product: "whatsapp",
    to: normalisePhone(input.to),
    type: "template",
    template: {
      name: def.name,
      language: { code: "en" },
      components: parameters.length > 0 ? [{ type: "body", parameters }] : [],
    },
  });
}

/**
 * Free-text message — only delivers within an active 24h session window.
 * Outside that window WhatsApp will reject with a "re-engagement" error
 * and you must use a template instead.
 */
export async function sendWhatsAppMessage(input: {
  to: string;
  text: string;
}): Promise<{ ok: boolean; sid?: string; error?: string }> {
  if (!isConfigured()) {
    return { ok: false, error: "Meta WhatsApp not configured" };
  }

  return call("/messages", {
    messaging_product: "whatsapp",
    to: normalisePhone(input.to),
    type: "text",
    text: { body: input.text },
  });
}
