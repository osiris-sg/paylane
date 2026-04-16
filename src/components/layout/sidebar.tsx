"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import {
  LayoutDashboard,
  FileText,
  Users,
  Bell,
  ChevronLeft,
  ChevronRight,
  Shield,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  modules?: ("RECEIVE" | "SEND" | "BOTH")[]; // which modules can see this item, undefined = all
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/customers", label: "Customers", icon: Users, modules: ["SEND", "BOTH"] },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/admin", label: "Admin", icon: Shield, adminOnly: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const { data: status } = api.onboarding.getStatus.useQuery();
  const { data: adminCheck } = api.admin.isAdmin.useQuery();
  const companyModule = status?.module;
  const isAdmin = adminCheck?.isAdmin ?? false;

  const visibleItems = navItems.filter((item) => {
    // Admin-only items: only show for admins
    if (item.adminOnly) return isAdmin;
    // No module filter = visible to all
    if (!item.modules) return true;
    // No module set on company = show everything
    if (!companyModule) return true;
    // Check if the company's module is in the allowed list
    return item.modules.includes(companyModule as "RECEIVE" | "SEND" | "BOTH");
  });

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r bg-white transition-all duration-200",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div className="flex h-14 items-center justify-between border-b px-4">
        {!collapsed && (
          <Link href="/dashboard" className="text-xl font-bold text-blue-600">
            PayLane
          </Link>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className="h-8 w-8"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {visibleItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-4">
        <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
          <UserButton />
          {!collapsed && (
            <span className="text-sm text-gray-600">Account</span>
          )}
        </div>
      </div>
    </aside>
  );
}
