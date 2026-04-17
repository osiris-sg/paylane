import { Sidebar } from "~/components/layout/sidebar";
import { Header } from "~/components/layout/header";
import { OnboardingGuard } from "~/components/onboarding-guard";
import { PullToRefresh } from "~/components/pull-to-refresh";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <OnboardingGuard>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <PullToRefresh className="flex-1 bg-gray-50 p-3 md:p-6">
            {children}
          </PullToRefresh>
        </div>
      </div>
    </OnboardingGuard>
  );
}
