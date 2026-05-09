import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import Anthropic from "@anthropic-ai/sdk";

import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { db } from "~/lib/db";
import { AGENT_TOOLS, executeTool } from "~/lib/agent-tools";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-6";
const MAX_TURNS = 8;

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { messages?: Anthropic.MessageParam[] } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  if (!incoming.length) {
    return NextResponse.json({ error: "No messages" }, { status: 400 });
  }

  // Resolve user → company for system prompt + tool execution context.
  const user = await db.user.findUnique({
    where: { clerkId: userId },
    include: { company: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Build a tRPC caller scoped to this request's auth so every tool call
  // runs through the same procedures (with the same gates) the UI uses.
  const ctx = await createTRPCContext({ headers: new Headers(await headers()) });
  const caller = createCaller(ctx);

  const today = new Date().toISOString().slice(0, 10);
  const companyName = user.company.name;

  // System: a static instructions block + a stable per-company context block.
  // The cache_control on the last tool caches system + all tools as one prefix.
  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: SYSTEM_INSTRUCTIONS,
    },
    {
      type: "text",
      text: `Company: ${companyName}\nDefault currency: SGD\nDefault payment terms: 30 days\nDefault tax rate: 9% (Singapore GST)\nToday's date: ${today}`,
    },
  ];

  // Mark the last tool with cache_control so system + tools are cached.
  const tools: Anthropic.Tool[] = AGENT_TOOLS.map((t, i) =>
    i === AGENT_TOOLS.length - 1
      ? ({ ...t, cache_control: { type: "ephemeral" } } as Anthropic.Tool)
      : t,
  );

  // Working copy of the conversation. We append assistant turns + tool_result
  // user turns to it as we loop, then return everything new to the client.
  const messages: Anthropic.MessageParam[] = [...incoming];
  const newMessages: Anthropic.MessageParam[] = [];
  let stopReason: string | null = null;
  let usage: Anthropic.Usage | null = null;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: systemBlocks,
      tools,
      messages,
    });

    stopReason = response.stop_reason;
    usage = response.usage;

    const assistantMsg: Anthropic.MessageParam = {
      role: "assistant",
      content: response.content,
    };
    messages.push(assistantMsg);
    newMessages.push(assistantMsg);

    if (response.stop_reason !== "tool_use") break;

    // Execute every tool_use block in this turn and feed results back.
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      try {
        const result = await executeTool(
          tu.name,
          (tu.input ?? {}) as Record<string, unknown>,
          caller,
          { companyId: user.companyId },
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify({ error: message }),
          is_error: true,
        });
      }
    }

    const toolResultMsg: Anthropic.MessageParam = {
      role: "user",
      content: toolResults,
    };
    messages.push(toolResultMsg);
    newMessages.push(toolResultMsg);
  }

  return NextResponse.json({
    newMessages,
    stopReason,
    usage,
  });
}

const SYSTEM_INSTRUCTIONS = `You are PayLane Assistant — an AI agent for the PayLane invoicing platform.

CAPABILITIES:
- list_customers, create_customer (only with user confirmation)
- list_invoices, get_invoice
- create_invoice_draft (creates a DRAFT — does NOT send)
- send_invoice (only after explicit user confirmation)

SENDING AN INVOICE — you only need: customer, amount, invoice date, due date.
1. Resolve the customer with list_customers. If ambiguous, ask. If they don't exist, ask permission to create.
2. Call create_invoice_draft with customerId + amount. Default invoice date = today, default terms = 30 days, no tax. Don't ask the user for a line-item description — pass "Services" or just omit it. Don't ask about tax — if they want GST they'll mention it.
3. Show the user a 3-line summary: who, how much (with currency), when due. Ask "Send it?".
4. ONLY after a clear yes (yes / send / go ahead), call send_invoice with the draft's id.

STYLE — IMPORTANT:
- Don't narrate what you're about to do. No "Let me grab...", "Let me check...", "I'll look up..." — just do it and give the answer.
- Be terse. Most replies should be 1-3 short lines.
- When showing money, include currency: "SGD 1,200.00".
- If a tool errors (e.g. "free trial has ended"), explain plainly and stop. Don't retry.

DON'T:
- Don't invent customer ids, invoice ids, or amounts.
- Don't try to edit sent invoices or delete things — point the user to the dashboard.
- Don't add tax (GST) unless the user explicitly asks.`;
