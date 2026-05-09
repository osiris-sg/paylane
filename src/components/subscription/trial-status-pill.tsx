"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Lock, Sparkles, Clock, Crown, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";
import { cn } from "~/lib/utils";

export function TrialStatusPill({ collapsed = false }: { collapsed?: boolean }) {
  const utils = api.useUtils();
  const { data: status, isLoading } = api.subscription.getStatus.useQuery();
  const [open, setOpen] = useState(false);

  const startTrial = api.subscription.startTrial.useMutation({
    onSuccess: async () => {
      await utils.subscription.getStatus.invalidate();
      toast.success("Free trial started — 14 days of full access.");
      setOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading || !status) return null;

  if (status.plan === "PAID") {
    if (collapsed) return null;
    return (
      <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700">
        <Crown className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Pro plan</span>
      </div>
    );
  }

  if (status.plan === "TRIAL") {
    const days = status.daysRemaining ?? 0;
    const urgent = days <= 3;
    if (collapsed) {
      return (
        <div
          className={cn(
            "flex items-center justify-center rounded-md p-1.5",
            urgent ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700",
          )}
          title={`Trial · ${days} day${days === 1 ? "" : "s"} left`}
        >
          <Clock className="h-3.5 w-3.5" />
        </div>
      );
    }
    return (
      <Link
        href="/upgrade"
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
          urgent
            ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
            : "bg-blue-50 text-blue-700 hover:bg-blue-100",
        )}
      >
        <Clock className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          Trial · {days} day{days === 1 ? "" : "s"} left
        </span>
      </Link>
    );
  }

  if (status.plan === "EXPIRED") {
    if (collapsed) {
      return (
        <Link
          href="/upgrade"
          className="flex items-center justify-center rounded-md bg-rose-50 p-1.5 text-rose-700 hover:bg-rose-100"
          title="Trial ended — upgrade"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
        </Link>
      );
    }
    return (
      <Link
        href="/upgrade"
        className="flex items-center gap-2 rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-700 transition-colors hover:bg-rose-100"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Trial ended · upgrade</span>
      </Link>
    );
  }

  // LOCKED
  return (
    <>
      {collapsed ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center justify-center rounded-md bg-blue-50 p-1.5 text-blue-700 hover:bg-blue-100"
          title="Start free trial"
        >
          <Lock className="h-3.5 w-3.5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-md bg-blue-50 px-2 py-1.5 text-xs text-blue-700 transition-colors hover:bg-blue-100"
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Start free trial</span>
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-blue-600" />
              Start your 14-day free trial
            </DialogTitle>
            <DialogDescription>
              Unlock everything on the sending side — no credit card required.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 py-2 text-sm text-gray-700">
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
              Add and manage your customer list
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
              Create and send invoices via email, WhatsApp, push
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
              Bulk import customers and invoices
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
              AI-powered invoice extraction
            </li>
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Not now
            </Button>
            <Button
              onClick={() => startTrial.mutate()}
              disabled={startTrial.isPending}
            >
              {startTrial.isPending ? "Starting…" : "Start free trial"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
