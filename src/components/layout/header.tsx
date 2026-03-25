"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { api } from "~/trpc/react";

export function Header() {
  const { data } = api.notification.getUnreadCount.useQuery();
  const unreadCount = data?.count ?? 0;

  return (
    <header className="flex h-14 items-center justify-between border-b bg-white px-6">
      <div />
      <div className="flex items-center gap-4">
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
      </div>
    </header>
  );
}
