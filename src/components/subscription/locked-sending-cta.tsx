"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, Lock } from "lucide-react";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { api } from "~/trpc/react";

export function LockedSendingCTA({
  title = "Sending invoices is locked",
  body = "Start your free 14-day trial to add customers and send invoices. No credit card required.",
}: {
  title?: string;
  body?: string;
}) {
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const startTrial = api.subscription.startTrial.useMutation({
    onSuccess: async () => {
      await utils.subscription.getStatus.invalidate();
      toast.success("Free trial started — 14 days of full access.");
      setOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <>
      <Card className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <Lock className="h-6 w-6" />
        </div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mb-6 mt-1 max-w-md text-sm text-muted-foreground">
          {body}
        </p>
        <Button onClick={() => setOpen(true)}>
          <Sparkles className="mr-2 h-4 w-4" />
          Start 14-day free trial
        </Button>
      </Card>

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
