"use client";

import Link from "next/link";
import dayjs from "dayjs";
import { PWAInstallBanner } from "~/components/pwa-install-guide";
import {
  FileText,
  FileDown,
  Clock,
  AlertTriangle,
  DollarSign,
  Plus,
  Upload,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";

import { api } from "~/trpc/react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";

const formatCurrency = (value: number | { toNumber?: () => number } | unknown) =>
  new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value));

const formatCurrencyCompact = (value: number | unknown) =>
  new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(Number(value));

function SkeletonCard() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-8 w-8 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent>
        <div className="h-8 w-16 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-3 w-28 animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

function SkeletonChart() {
  return (
    <Card>
      <CardHeader>
        <div className="h-5 w-36 animate-pulse rounded bg-muted" />
        <div className="h-3 w-52 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

type CardModules = "send" | "receive" | "both";

const SUMMARY_CARDS = [
  {
    key: "totalSent" as const,
    amountKey: "totalAmountSent" as const,
    label: "Total Sent",
    icon: FileText,
    accent: "text-blue-600",
    bg: "bg-blue-50",
    border: "",
    statusFilter: null,
    modules: "send" as CardModules,
  },
  {
    key: "totalReceived" as const,
    amountKey: "totalAmountReceived" as const,
    label: "Total Received",
    icon: FileDown,
    accent: "text-purple-600",
    bg: "bg-purple-50",
    border: "",
    statusFilter: null,
    modules: "receive" as CardModules,
  },
  {
    key: "pending" as const,
    amountKey: "totalAmountPending" as const,
    label: "Pending",
    icon: Clock,
    accent: "text-amber-600",
    bg: "bg-amber-50",
    border: "",
    statusFilter: "SENT",
    modules: "both" as CardModules,
  },
  {
    key: "overdue" as const,
    amountKey: "totalAmountOverdue" as const,
    label: "Overdue",
    icon: AlertTriangle,
    accent: "text-red-600",
    bg: "bg-red-50",
    border: "overdue",
    statusFilter: "OVERDUE",
    modules: "both" as CardModules,
  },
  {
    key: "paid" as const,
    amountKey: "totalAmountPaid" as const,
    label: "Paid",
    icon: DollarSign,
    accent: "text-emerald-600",
    bg: "bg-emerald-50",
    border: "",
    statusFilter: "PAID",
    modules: "both" as CardModules,
  },
] as const;

export default function DashboardPage() {
  const summary = api.dashboard.getSummary.useQuery();
  const aging = api.dashboard.getAgingData.useQuery();
  const monthly = api.dashboard.getMonthlyTotals.useQuery();
  const { data: onboardingStatus } = api.onboarding.getStatus.useQuery();

  const companyModule = onboardingStatus?.module;
  const canSend = companyModule === "SEND" || companyModule === "BOTH";
  const canReceive = companyModule === "RECEIVE" || companyModule === "BOTH";

  const visibleCards = SUMMARY_CARDS.filter((card) => {
    if (card.modules === "both") return true;
    if (card.modules === "send") return canSend;
    if (card.modules === "receive") return canReceive;
    return false;
  });

  // Build the target URL for a card based on its scope and the user's module
  const buildHref = (card: (typeof SUMMARY_CARDS)[number]): string | null => {
    const params = new URLSearchParams();
    // Pick the tab this card pertains to
    let tab: "sent" | "received" | null = null;
    if (card.modules === "send") tab = "sent";
    else if (card.modules === "receive") tab = "received";
    else if (card.modules === "both") {
      // For shared cards, prefer the tab the user actually has access to
      tab = canSend ? "sent" : canReceive ? "received" : null;
    }
    if (!tab) return null;
    params.set("tab", tab);
    if (card.statusFilter) params.set("status", card.statusFilter);
    return `/invoices?${params.toString()}`;
  };

  return (
    <div className="space-y-6 p-3 md:space-y-8 md:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Overview of your invoice activity
          </p>
        </div>
        {canSend && (
          <div className="flex gap-3">
            <Button variant="outline" asChild>
              <Link href="/invoices/upload">
                <Upload className="mr-2 h-4 w-4" />
                Upload Invoice
              </Link>
            </Button>
            <Button asChild>
              <Link href="/invoices/new">
                <Plus className="mr-2 h-4 w-4" />
                Create Invoice
              </Link>
            </Button>
          </div>
        )}
      </div>

      <PWAInstallBanner />

      <Separator />

      {/* Summary Cards */}
      {summary.isLoading ? (
        <div
          className={`grid gap-4 grid-cols-2 ${
            visibleCards.length <= 3
              ? "lg:grid-cols-3"
              : visibleCards.length === 4
                ? "md:grid-cols-2 lg:grid-cols-4"
                : "md:grid-cols-3 lg:grid-cols-5"
          }`}
        >
          {Array.from({ length: visibleCards.length || 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : summary.data ? (
        <div
          className={`grid gap-4 grid-cols-2 ${
            visibleCards.length <= 3
              ? "lg:grid-cols-3"
              : visibleCards.length === 4
                ? "md:grid-cols-2 lg:grid-cols-4"
                : "md:grid-cols-3 lg:grid-cols-5"
          }`}
        >
          {visibleCards.map((card) => {
            const count = summary.data[card.key];
            const amount = card.amountKey ? summary.data[card.amountKey] : null;
            const isOverdueHighlight = card.border === "overdue" && count > 0;
            const Icon = card.icon;
            const href = buildHref(card);

            const cardContent = (
              <Card
                className={`group relative h-full overflow-hidden border shadow-sm transition-all ${
                  isOverdueHighlight
                    ? "border-red-300 bg-gradient-to-br from-red-50 to-white"
                    : "bg-white"
                } ${href ? "cursor-pointer hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md" : ""}`}
              >
                <div className="flex h-full flex-col gap-3 p-5">
                  <div className="flex items-start justify-between">
                    <span className={`text-sm font-medium ${isOverdueHighlight ? "text-red-700" : "text-muted-foreground"}`}>
                      {card.label}
                    </span>
                    <div className={`rounded-lg p-2 ${card.bg}`}>
                      <Icon className={`h-4 w-4 ${card.accent}`} />
                    </div>
                  </div>
                  <div className="mt-auto">
                    <div className={`text-3xl font-bold tracking-tight ${isOverdueHighlight ? "text-red-700" : "text-gray-900"}`}>
                      {count}
                    </div>
                    {amount !== null && Number(amount) > 0 && (
                      <p className={`mt-1 text-xs ${isOverdueHighlight ? "font-semibold text-red-600" : "text-muted-foreground"}`}>
                        {formatCurrency(amount)}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            );

            return href ? (
              <Link key={card.key} href={href} className="block">
                {cardContent}
              </Link>
            ) : (
              <div key={card.key}>{cardContent}</div>
            );
          })}
        </div>
      ) : null}

      {/* Charts */}
      <div className={`grid gap-6 ${canReceive ? "lg:grid-cols-2" : ""}`}>
        {/* Invoice Aging Bar Chart — only for RECEIVE-capable accounts */}
        {canReceive && aging.isLoading ? (
          <SkeletonChart />
        ) : canReceive && aging.data ? (
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Invoice Aging
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Received unpaid invoices grouped by days outstanding
              </p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={aging.data}
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis
                    dataKey="bucket"
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                    tickFormatter={(v: string) => `${v} days`}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                    tickFormatter={(v) => formatCurrencyCompact(v)}
                  />
                  <Tooltip
                    formatter={(value) => [formatCurrency(value), "Amount"]}
                    labelFormatter={(label) => `${label} days`}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid #e5e7eb",
                      fontSize: "13px",
                    }}
                  />
                  <Bar
                    dataKey="amount"
                    fill="#3b82f6"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={60}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ) : null}

        {/* Monthly Totals Line Chart */}
        {monthly.isLoading ? (
          <SkeletonChart />
        ) : monthly.data ? (
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Monthly Totals
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Invoices sent and received over the last 6 months
              </p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart
                  data={monthly.data}
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                    tickFormatter={(v: string) => dayjs(v).format("MMM YY")}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                  />
                  <Tooltip
                    labelFormatter={(label) => dayjs(String(label)).format("MMMM YYYY")}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid #e5e7eb",
                      fontSize: "13px",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="sent"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 4, fill: "#3b82f6" }}
                    activeDot={{ r: 6 }}
                    name="Sent"
                  />
                  <Line
                    type="monotone"
                    dataKey="received"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    dot={{ r: 4, fill: "#8b5cf6" }}
                    activeDot={{ r: 6 }}
                    name="Received"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
