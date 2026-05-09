"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "~/components/ui/button";

export function ExpiredBanner({
  message = "Your free trial has ended. Upgrade to keep sending invoices.",
}: {
  message?: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-900 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
        <p className="text-sm">{message}</p>
      </div>
      <Button asChild size="sm">
        <Link href="/upgrade">Upgrade</Link>
      </Button>
    </div>
  );
}
