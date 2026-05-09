"use client";

import { api } from "~/trpc/react";

export type SendAccessState = "loading" | "locked" | "trial" | "expired" | "paid";

export function useSendAccess(): {
  state: SendAccessState;
  daysRemaining: number | null;
  canSend: boolean;
} {
  const { data, isLoading } = api.subscription.getStatus.useQuery();
  if (isLoading || !data)
    return { state: "loading", daysRemaining: null, canSend: false };

  const map: Record<typeof data.plan, SendAccessState> = {
    LOCKED: "locked",
    TRIAL: "trial",
    EXPIRED: "expired",
    PAID: "paid",
  };
  const state = map[data.plan];
  return {
    state,
    daysRemaining: data.daysRemaining,
    canSend: state === "trial" || state === "paid",
  };
}
