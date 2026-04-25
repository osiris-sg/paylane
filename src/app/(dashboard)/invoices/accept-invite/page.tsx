"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "~/trpc/react";

const STORAGE_KEY = "paylane:pending-invite-token";

function AcceptInviteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const acceptedRef = useRef(false);
  const acceptInvite = api.invoice.acceptInvite.useMutation();

  useEffect(() => {
    if (acceptedRef.current) return;

    const tokenFromUrl = searchParams.get("token");
    const tokenFromStorage =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_KEY) : null;
    const token = tokenFromUrl ?? tokenFromStorage;

    if (!token) {
      router.replace("/dashboard");
      return;
    }
    acceptedRef.current = true;

    acceptInvite.mutate(
      { token },
      {
        onSuccess: ({ invoiceId }) => {
          if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
          router.replace(`/invoices/${invoiceId}`);
        },
        onError: (err) => {
          if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
          toast.error(err.message || "Couldn't open the invited invoice");
          router.replace("/dashboard");
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <p className="text-sm text-muted-foreground">Opening your invoice…</p>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      }
    >
      <AcceptInviteInner />
    </Suspense>
  );
}
