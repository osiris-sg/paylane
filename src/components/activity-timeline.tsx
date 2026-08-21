"use client";

import dayjs from "dayjs";
import {
  FileText,
  Send,
  CheckCircle,
  CreditCard,
  AlertTriangle,
  Clock,
  Eye,
  RefreshCw,
} from "lucide-react";

/**
 * Shared activity timeline for the invoice / statement / delivery-order
 * detail pages. Renders newest-first with an icon inferred from the message
 * text (the rows only store a message + timestamp).
 */
export interface TimelineEvent {
  id: string;
  message: string;
  createdAt: string | Date;
}

function iconFor(message: string): { Icon: React.ElementType; color: string } {
  const msg = message.toLowerCase();
  if (msg.includes("replaced") || msg.includes("updated") || msg.includes("overridden"))
    return { Icon: RefreshCw, color: "text-purple-500" };
  if (msg.includes("viewed")) return { Icon: Eye, color: "text-green-500" };
  if (msg.includes("sent")) return { Icon: Send, color: "text-blue-500" };
  if (msg.includes("acknowledged")) return { Icon: CheckCircle, color: "text-green-500" };
  if (msg.includes("paid")) return { Icon: CreditCard, color: "text-green-500" };
  if (msg.includes("overdue")) return { Icon: AlertTriangle, color: "text-red-500" };
  if (msg.includes("created")) return { Icon: FileText, color: "text-blue-500" };
  return { Icon: FileText, color: "text-muted-foreground" };
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  const { Icon, color } = iconFor(event.message);
  return (
    <div className="relative flex gap-3 pb-6 last:pb-0">
      {/* Vertical line */}
      <div className="absolute left-[15px] top-8 h-[calc(100%-16px)] w-px bg-border last:hidden" />
      {/* Icon dot */}
      <div
        className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background ${color}`}
      >
        <Icon className="h-4 w-4" />
      </div>
      {/* Content */}
      <div className="flex-1 pt-0.5">
        <p className="text-sm font-medium">{event.message}</p>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{dayjs(event.createdAt).format("MMM D, YYYY [at] h:mm A")}</span>
        </div>
      </div>
    </div>
  );
}

/** Newest-first list with an empty state. Wrap in whatever Card the page uses. */
export function TimelineList({ events }: { events: TimelineEvent[] }) {
  const sorted = [...events].sort(
    (a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf(),
  );
  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
        <Clock className="h-8 w-8" />
        <p className="text-sm">No activity yet</p>
      </div>
    );
  }
  return (
    <div className="space-y-0">
      {sorted.map((event) => (
        <TimelineRow key={event.id} event={event} />
      ))}
    </div>
  );
}
