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
  Menu,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { useState, useEffect } from "react";
import { Button } from "~/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "~/components/ui/sheet";
import { api } from "~/trpc/react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  modules?: ("RECEIVE" | "SEND" | "BOTH")[];
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/customers", label: "Customers", icon: Users, modules: ["SEND", "BOTH"] },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/admin", label: "Admin", icon: Shield, adminOnly: true },
];

function useVisibleItems() {
  const { data: status } = api.onboarding.getStatus.useQuery();
  const { data: adminCheck } = api.admin.isAdmin.useQuery();
  const companyModule = status?.module;
  const isAdmin = adminCheck?.isAdmin ?? false;

  return navItems.filter((item) => {
    if (item.adminOnly) return isAdmin;
    if (!item.modules) return true;
    if (!companyModule) return true;
    return item.modules.includes(companyModule as "RECEIVE" | "SEND" | "BOTH");
  });
}

function NavLinks({
  items,
  pathname,
  collapsed,
  onClick,
}: {
  items: NavItem[];
  pathname: string;
  collapsed?: boolean;
  onClick?: () => void;
}) {
  return (
    <nav className="flex-1 space-y-1 p-2">
      {items.map((item) => {
        const isActive = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClick}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-blue-50 text-blue-700"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
            )}
          >
            <item.icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** Desktop sidebar — hidden on mobile */
export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const visibleItems = useVisibleItems();

  return (
    <aside
      className={cn(
        "hidden md:flex h-screen flex-col border-r bg-white transition-all duration-200",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className="flex h-14 items-center justify-between border-b px-4">
        {!collapsed && (
          <Link href="/dashboard" className="text-xl font-bold text-blue-600">
            PayLane
          </Link>
        )}
        <Button variant="ghost" size="icon" onClick={() => setCollapsed(!collapsed)} className="h-8 w-8">
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      <NavLinks items={visibleItems} pathname={pathname} collapsed={collapsed} />

      <div className="border-t p-4">
        <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
          <UserButton />
          {!collapsed && <span className="text-sm text-gray-600">Account</span>}
        </div>
      </div>
    </aside>
  );
}

/** Mobile sidebar — hamburger menu in a sheet */
export function MobileSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const visibleItems = useVisibleItems();

  // Close on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden h-9 w-9">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <div className="flex h-14 items-center border-b px-4">
          <Link href="/dashboard" className="text-xl font-bold text-blue-600" onClick={() => setOpen(false)}>
            PayLane
          </Link>
        </div>

        <NavLinks items={visibleItems} pathname={pathname} onClick={() => setOpen(false)} />

        <div className="border-t p-4">
          <div className="flex items-center gap-3">
            <UserButton />
            <span className="text-sm text-gray-600">Account</span>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
