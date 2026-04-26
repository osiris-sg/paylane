"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: status, isLoading } = api.onboarding.getStatus.useQuery();
  const needsOnboarding = !!status && !status.onboarded;

  // Trigger the redirect from an effect, not during render. Calling
  // router.replace synchronously while rendering can cause invalid-element
  // errors (React #300) when the next page mounts mid-flush.
  useEffect(() => {
    if (needsOnboarding) router.replace("/onboarding");
  }, [needsOnboarding, router]);

  if (isLoading || needsOnboarding) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
