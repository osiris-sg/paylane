"use client";

import { Bell, LogOut } from "lucide-react";
import Link from "next/link";
import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { api } from "~/trpc/react";
import { MobileSidebar } from "~/components/layout/sidebar";

export function Header() {
  const { data } = api.notification.getUnreadCount.useQuery();
  const unreadCount = data?.count ?? 0;
  const { signOut } = useClerk();
  const router = useRouter();

  const handleSignOut = () => {
    void signOut(() => router.push("/sign-in"));
  };

  return (
    <header className="flex h-14 items-center justify-between border-b bg-white px-4 md:px-6">
      <div className="flex items-center gap-2">
        <MobileSidebar />
        <Link href="/dashboard" className="text-lg font-bold text-blue-600 md:hidden">
          PayLane
        </Link>
      </div>
      <div className="flex items-center gap-2">
        <Link href="/notifications">
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="h-5 w-5" />
            {unreadCount > 0 ? (
              <Badge
                variant="destructive"
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full p-0 text-xs"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </Badge>
            ) : null}
          </Button>
        </Link>
        <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Sign out">
          <LogOut className="h-5 w-5" />
        </Button>
      </div>
    </header>
  );
}
