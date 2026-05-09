"use client";

import { useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Sparkles, ArrowLeft, Crown, Clock, Check } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { api } from "~/trpc/react";

export default function UpgradePage() {
  const utils = api.useUtils();
  const { data: status, isLoading } = api.subscription.getStatus.useQuery();

  const startTrial = api.subscription.startTrial.useMutation({
    onSuccess: async () => {
      await utils.subscription.getStatus.invalidate();
      toast.success("Free trial started — 14 days of full access.");
    },
    onError: (err) => toast.error(err.message),
  });

  const [contactSubmitted, setContactSubmitted] = useState(false);

  if (isLoading || !status) return null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href="/dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to dashboard
          </Link>
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">Upgrade your plan</h1>
        <p className="text-muted-foreground">
          Send unlimited invoices, add unlimited customers, and unlock the full
          PayLane sender suite.
        </p>
      </div>

      {status.plan === "PAID" && (
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <Crown className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold">You&apos;re on the Pro plan</p>
              <p className="text-sm text-muted-foreground">
                You have full access to all sender features.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {status.plan === "TRIAL" && (
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold">
                Trial active — {status.daysRemaining}{" "}
                day{status.daysRemaining === 1 ? "" : "s"} left
              </p>
              <p className="text-sm text-muted-foreground">
                Upgrade to keep sending after your trial ends.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {status.plan === "LOCKED" && (
        <Card>
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Start free — no credit card</p>
              <p className="text-sm text-muted-foreground">
                Get 14 days of full sender access. Cancel anytime.
              </p>
            </div>
            <Button
              onClick={() => startTrial.mutate()}
              disabled={startTrial.isPending}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {startTrial.isPending ? "Starting…" : "Start free trial"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="border-blue-200">
        <CardContent className="space-y-5 p-6">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">
                Pro
              </p>
              <p className="mt-1 text-3xl font-bold">Coming soon</p>
              <p className="text-sm text-muted-foreground">
                Self-serve checkout via Airwallex is on the way.
              </p>
            </div>
          </div>

          <ul className="space-y-2 text-sm">
            {[
              "Unlimited customers and contacts",
              "Unlimited invoice sending (email, WhatsApp, push)",
              "Bulk import from CSV / Excel / PDFs",
              "AI-powered invoice and statement extraction",
              "Payment confirmation workflow",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>{line}</span>
              </li>
            ))}
          </ul>

          {status.plan === "EXPIRED" || status.plan === "TRIAL" ? (
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-sm font-medium">
                Want to upgrade now? We&apos;re still wiring up Airwallex.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Email us and we&apos;ll get you onto Pro manually until checkout
                ships.
              </p>
              {contactSubmitted ? (
                <p className="mt-3 text-sm text-emerald-700">
                  Thanks — we&apos;ll be in touch shortly.
                </p>
              ) : (
                <Button
                  variant="outline"
                  className="mt-3"
                  asChild
                  onClick={() => setContactSubmitted(true)}
                >
                  <a href="mailto:hello@paylane.app?subject=PayLane%20Pro%20upgrade">
                    Email us to upgrade
                  </a>
                </Button>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
