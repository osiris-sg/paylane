"use client";

import { useRouter } from "next/navigation";
import { Sidebar } from "~/components/layout/sidebar";
import { Header } from "~/components/layout/header";
import { api } from "~/trpc/react";
import { Loader2 } from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { data: status, isLoading } = api.onboarding.getStatus.useQuery();

  // Show loading screen while checking onboarding status
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // Redirect to onboarding if not completed
  if (status && !status.onboarded) {
    router.push("/onboarding");
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto bg-gray-50 p-3 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
