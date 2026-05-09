"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Send,
  Sparkles,
  AlertCircle,
  Loader2,
  Trash2,
  Plus,
  MessageSquare,
  PanelLeft,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Sheet, SheetContent, SheetTrigger } from "~/components/ui/sheet";
import { SendAccessGuard } from "~/components/subscription/send-access-guard";
import { cn } from "~/lib/utils";

type TextBlock = { type: "text"; text: string };
type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};
type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
type Message = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
};

const STORE_KEY = "paylane:agent-store";
const LEGACY_KEY = "paylane:agent-history";
const VOICE_KEY = "paylane:agent-voice";
const MAX_BYTES = 500_000;

const SUGGESTIONS = [
  "Send Acme an invoice for SGD 1,200, due in 30 days",
  "What invoices are still unpaid?",
  "How much did I bill this month?",
  "Show me my recent customers",
];

function newId() {
  return Math.random().toString(36).slice(2, 11);
}

/** Strip markdown so the TTS engine doesn't read out asterisks and backticks. */
function stripForSpeech(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function lastAssistantText(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "assistant") continue;
    const blocks =
      typeof m.content === "string"
        ? ([{ type: "text", text: m.content }] as ContentBlock[])
        : m.content;
    const text = blocks
      .filter((b): b is TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return null;
}

function deriveTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New chat";
  const text =
    typeof first.content === "string"
      ? first.content
      : first.content
          .filter((b): b is TextBlock => b.type === "text")
          .map((b) => b.text)
          .join(" ");
  const trimmed = text.trim().slice(0, 50);
  return trimmed || "New chat";
}

export default function AgentPage() {
  return (
    <SendAccessGuard title="AI Assistant">
      <AgentInner />
    </SendAccessGuard>
  );
}

function AgentInner() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [listening, setListening] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Browser SpeechRecognition is non-standard; type as `unknown` and cast.
  const recognitionRef = useRef<unknown>(null);

  const speechSupported =
    typeof window !== "undefined" &&
    !!(
      (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown })
        .webkitSpeechRecognition
    );
  const synthSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  // Hydrate voice toggle preference.
  useEffect(() => {
    try {
      setVoiceEnabled(localStorage.getItem(VOICE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  // Stop any in-flight speech / mic when the page unmounts.
  useEffect(() => {
    return () => {
      if (synthSupported) window.speechSynthesis.cancel();
      const rec = recognitionRef.current as { stop?: () => void } | null;
      rec?.stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleVoice = () => {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    try {
      localStorage.setItem(VOICE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (!next && synthSupported) window.speechSynthesis.cancel();
  };

  const speak = (text: string) => {
    if (!synthSupported) return;
    const cleaned = stripForSpeech(text);
    if (!cleaned) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(cleaned);
    utt.rate = 1.05;
    utt.pitch = 1;
    window.speechSynthesis.speak(utt);
  };

  const startListening = () => {
    const Ctor = ((window as unknown as { SpeechRecognition?: new () => unknown })
      .SpeechRecognition ||
      (window as unknown as {
        webkitSpeechRecognition?: new () => unknown;
      }).webkitSpeechRecognition) as (new () => {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onresult: (e: {
        resultIndex: number;
        results: ArrayLike<{
          isFinal: boolean;
          0: { transcript: string };
        }>;
      }) => void;
      onerror: () => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    }) | undefined;
    if (!Ctor) return;
    if (synthSupported) window.speechSynthesis.cancel();

    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-US";
    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        const t = r[0].transcript;
        if (r.isFinal) finalText += t;
        else interim += t;
      }
      setInput((finalText + interim).replace(/\s+/g, " ").trim());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
    recognitionRef.current = rec;
    setListening(true);
  };

  const stopListening = () => {
    const rec = recognitionRef.current as { stop?: () => void } | null;
    rec?.stop?.();
    setListening(false);
  };

  // Load store on first mount, including a one-shot legacy migration.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { conversations?: Conversation[] };
        if (Array.isArray(parsed.conversations)) {
          setConversations(parsed.conversations);
        }
      } else {
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) {
          const msgs = JSON.parse(legacy) as Message[];
          if (Array.isArray(msgs) && msgs.length > 0) {
            const conv: Conversation = {
              id: newId(),
              title: deriveTitle(msgs),
              messages: msgs,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            setConversations([conv]);
          }
          localStorage.removeItem(LEGACY_KEY);
        }
      }
    } catch {
      /* ignore corrupt store */
    }
    setHydrated(true);
  }, []);

  // Persist conversations whenever they change.
  useEffect(() => {
    if (!hydrated) return;
    try {
      let serialised = JSON.stringify({ conversations });
      // Trim oldest conversations if we're over the cap.
      if (serialised.length > MAX_BYTES) {
        let trimmed = [...conversations];
        while (
          JSON.stringify({ conversations: trimmed }).length > MAX_BYTES &&
          trimmed.length > 1
        ) {
          // drop the oldest by updatedAt
          const oldest = trimmed.reduce((a, b) =>
            a.updatedAt < b.updatedAt ? a : b,
          );
          trimmed = trimmed.filter((c) => c.id !== oldest.id);
        }
        serialised = JSON.stringify({ conversations: trimmed });
      }
      localStorage.setItem(STORE_KEY, serialised);
    } catch {
      /* localStorage full — silently skip */
    }
  }, [conversations, hydrated]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, pending]);

  const sortedConvs = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations],
  );

  const startNewChat = () => {
    setActiveId(null);
    setMessages([]);
    setInput("");
    setError(null);
    setMobileSheetOpen(false);
  };

  const openConversation = (id: string) => {
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;
    setActiveId(id);
    setMessages(conv.messages);
    setInput("");
    setError(null);
    setMobileSheetOpen(false);
  };

  const deleteConversation = (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
  };

  const persistMessages = (id: string, title: string, msgs: Message[]) => {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      const now = Date.now();
      if (idx === -1) {
        return [
          {
            id,
            title,
            messages: msgs,
            createdAt: now,
            updatedAt: now,
          },
          ...prev,
        ];
      }
      const next = [...prev];
      next[idx] = {
        ...next[idx]!,
        messages: msgs,
        updatedAt: now,
        // keep title from first save (or update if it was "New chat")
        title:
          next[idx]!.title && next[idx]!.title !== "New chat"
            ? next[idx]!.title
            : title,
      };
      return next;
    });
  };

  const send = async (text: string) => {
    if (!text.trim() || pending) return;
    setError(null);

    const userMsg: Message = { role: "user", content: text.trim() };
    const next = [...messages, userMsg];

    // Make sure the conversation has an id from the very first message,
    // so subsequent saves stay on the same row.
    let convId = activeId;
    if (!convId) {
      convId = newId();
      setActiveId(convId);
    }

    setMessages(next);
    setInput("");
    setPending(true);
    persistMessages(convId, deriveTitle(next), next);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const data = (await res.json()) as { newMessages: Message[] };
      const updated = [...next, ...data.newMessages];
      setMessages(updated);
      persistMessages(convId, deriveTitle(updated), updated);
      if (voiceEnabled) {
        const reply = lastAssistantText(data.newMessages);
        if (reply) speak(reply);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const sidebar = (
    <ChatSidebar
      conversations={sortedConvs}
      activeId={activeId}
      onNew={startNewChat}
      onOpen={openConversation}
      onDelete={deleteConversation}
    />
  );

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-4">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 md:block">{sidebar}</aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {/* Mobile sheet trigger */}
            <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <PanelLeft className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-3">
                {sidebar}
              </SheetContent>
            </Sheet>
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
                <Sparkles className="h-6 w-6 text-blue-600" />
                AI Assistant
              </h1>
              <p className="text-sm text-muted-foreground">
                Ask me to send invoices, look up customers, or check what&apos;s outstanding.
              </p>
            </div>
          </div>
          {synthSupported && (
            <Button
              variant={voiceEnabled ? "default" : "outline"}
              size="sm"
              onClick={toggleVoice}
              title={voiceEnabled ? "Voice replies on" : "Voice replies off"}
            >
              {voiceEnabled ? (
                <Volume2 className="mr-1.5 h-4 w-4" />
              ) : (
                <VolumeX className="mr-1.5 h-4 w-4" />
              )}
              <span className="hidden sm:inline">
                {voiceEnabled ? "Voice on" : "Voice off"}
              </span>
            </Button>
          )}
        </div>

        <div
          ref={scrollerRef}
          className="flex-1 space-y-4 overflow-y-auto rounded-lg border bg-gray-50/40 p-4"
        >
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-4 py-12">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                <Sparkles className="h-6 w-6 text-blue-600" />
              </div>
              <p className="text-center text-sm text-muted-foreground">
                Try one of these to get started:
              </p>
              <div className="flex w-full max-w-md flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-lg border bg-white px-3 py-2 text-left text-sm transition-colors hover:bg-blue-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <MessageView key={i} message={m} />
          ))}

          {pending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Thinking…
            </div>
          )}

          {error && (
            <Card className="border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            </Card>
          )}
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={listening ? "Listening…" : "Ask anything…"}
            rows={2}
            disabled={pending}
            className="resize-none"
          />
          <div className="flex flex-col gap-2">
            {speechSupported && (
              <Button
                type="button"
                variant={listening ? "default" : "outline"}
                onClick={listening ? stopListening : startListening}
                disabled={pending}
                className={cn(
                  listening && "animate-pulse bg-rose-600 hover:bg-rose-700",
                )}
                title={listening ? "Stop listening" : "Speak to type"}
              >
                {listening ? (
                  <MicOff className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
                <span className="sr-only">
                  {listening ? "Stop" : "Start dictation"}
                </span>
              </Button>
            )}
            <Button type="submit" disabled={pending || !input.trim()}>
              <Send className="h-4 w-4" />
              <span className="sr-only">Send</span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ChatSidebar({
  conversations,
  activeId,
  onNew,
  onOpen,
  onDelete,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col gap-2 rounded-lg border bg-white p-2">
      <Button
        onClick={onNew}
        variant="outline"
        size="sm"
        className="justify-start"
      >
        <Plus className="mr-2 h-4 w-4" />
        New chat
      </Button>

      <div className="px-2 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Recents
      </div>

      <div className="flex-1 space-y-0.5 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            No saved chats yet.
          </p>
        ) : (
          conversations.map((c) => (
            <ConversationRow
              key={c.id}
              conv={c}
              active={c.id === activeId}
              onOpen={() => onOpen(c.id)}
              onDelete={() => onDelete(c.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ConversationRow({
  conv,
  active,
  onOpen,
  onDelete,
}: {
  conv: Conversation;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm",
        active ? "bg-blue-50 text-blue-700" : "hover:bg-gray-100",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="truncate">{conv.title || "New chat"}</span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className={cn(
          "shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100",
          active && "opacity-70",
        )}
        title="Delete chat"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function MessageView({ message }: { message: Message }) {
  if (message.role === "user") {
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((b): b is TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("\n");
    if (!text) return null;
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-blue-600 px-3 py-2 text-sm text-white">
          {text}
        </div>
      </div>
    );
  }

  const blocks =
    typeof message.content === "string"
      ? ([{ type: "text", text: message.content }] as ContentBlock[])
      : message.content;

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((b, i) => {
        if (b.type === "text") {
          if (!b.text.trim()) return null;
          return (
            <div
              key={i}
              className="max-w-[85%] rounded-lg border bg-white px-3 py-2 text-sm leading-relaxed"
            >
              <Markdown text={b.text} />
            </div>
          );
        }
        // tool_use / tool_result blocks intentionally not rendered
        return null;
      })}
    </div>
  );
}

// ─── Tiny markdown renderer ──────────────────────────────────────────────────
function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      out.push(
        <code
          key={key++}
          className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[12px]"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Array<
    | { type: "p"; lines: string[] }
    | { type: "ul"; items: string[] }
    | { type: "ol"; items: string[] }
    | { type: "h"; level: 1 | 2 | 3; text: string }
  > = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        type: "h",
        level: heading[1]!.length as 1 | 2 | 3,
        text: heading[2] ?? "",
      });
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() &&
      !/^\s*[-*]\s+/.test(lines[i] ?? "") &&
      !/^\s*\d+\.\s+/.test(lines[i] ?? "") &&
      !/^#{1,3}\s+/.test(lines[i] ?? "")
    ) {
      para.push(lines[i] ?? "");
      i++;
    }
    blocks.push({ type: "p", lines: para });
  }

  return (
    <div className="space-y-2">
      {blocks.map((b, idx) => {
        if (b.type === "h") {
          const cls =
            b.level === 1
              ? "text-base font-semibold"
              : b.level === 2
                ? "text-sm font-semibold"
                : "text-sm font-medium";
          return (
            <p key={idx} className={cls}>
              {renderInline(b.text)}
            </p>
          );
        }
        if (b.type === "ul") {
          return (
            <ul key={idx} className="ml-4 list-disc space-y-0.5">
              {b.items.map((it, j) => (
                <li key={j}>{renderInline(it)}</li>
              ))}
            </ul>
          );
        }
        if (b.type === "ol") {
          return (
            <ol key={idx} className="ml-4 list-decimal space-y-0.5">
              {b.items.map((it, j) => (
                <li key={j}>{renderInline(it)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={idx} className="whitespace-pre-wrap">
            {b.lines.map((ln, j) => (
              <span key={j}>
                {renderInline(ln)}
                {j < b.lines.length - 1 ? "\n" : null}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
