"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import {
  FileText,
  FileDown,
  Clock,
  CheckCircle,
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

const SUMMARY_CARDS = [
  {
    key: "totalSent" as const,
    amountKey: "totalAmountSent" as const,
    label: "Total Sent",
    icon: FileText,
    accent: "text-blue-600",
    bg: "bg-blue-50",
    border: "",
  },
  {
    key: "totalReceived" as const,
    amountKey: "totalAmountReceived" as const,
    label: "Total Received",
    icon: FileDown,
    accent: "text-purple-600",
    bg: "bg-purple-50",
    border: "",
  },
  {
    key: "pending" as const,
    amountKey: null,
    label: "Pending",
    icon: Clock,
    accent: "text-yellow-600",
    bg: "bg-yellow-50",
    border: "",
  },
  {
    key: "acknowledged" as const,
    amountKey: null,
    label: "Acknowledged",
    icon: CheckCircle,
    accent: "text-green-600",
    bg: "bg-green-50",
    border: "",
  },
  {
    key: "overdue" as const,
    amountKey: null,
    label: "Overdue",
    icon: AlertTriangle,
    accent: "text-red-600",
    bg: "bg-red-50",
    border: "overdue",
  },
  {
    key: "paid" as const,
    amountKey: null,
    label: "Paid",
    icon: DollarSign,
    accent: "text-emerald-600",
    bg: "bg-emerald-50",
    border: "",
  },
] as const;

export default function DashboardPage() {
  const router = useRouter();
  const onboarding = api.onboarding.getStatus.useQuery();
  const summary = api.dashboard.getSummary.useQuery();
  const aging = api.dashboard.getAgingData.useQuery();
  const monthly = api.dashboard.getMonthlyTotals.useQuery();

  // Redirect to onboarding if not completed
  if (onboarding.data && !onboarding.data.onboarded) {
    router.push("/onboarding");
    return null;
  }

  return (
    <div className="space-y-8 p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Overview of your invoice activity
          </p>
        </div>
        <div className="flex gap-3">
          <Button asChild>
            <Link href="/invoices/new">
              <Plus className="mr-2 h-4 w-4" />
              Create Invoice
            </Link>
          </Button>
          <Button asChild variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100">
            <Link href="/invoices/upload">
              <Upload className="mr-2 h-4 w-4" />
              Upload Invoice
            </Link>
          </Button>
        </div>
      </div>

      <Separator />

      {/* Summary Cards */}
      {summary.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : summary.data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SUMMARY_CARDS.map((card) => {
            const count = summary.data[card.key];
            const amount = card.amountKey ? summary.data[card.amountKey] : null;
            const isOverdueHighlight =
              card.border === "overdue" && count > 0;
            const Icon = card.icon;

            return (
              <Card
                key={card.key}
                className={
                  isOverdueHighlight
                    ? "border-red-300 bg-red-50/30 shadow-sm"
                    : "shadow-sm"
                }
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {card.label}
                  </CardTitle>
                  <div className={`rounded-lg p-2 ${card.bg}`}>
                    <Icon className={`h-4 w-4 ${card.accent}`} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className={`text-3xl font-bold ${isOverdueHighlight ? "text-red-700" : ""}`}>
                    {count}
                  </div>
                  {amount !== null && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatCurrency(amount)} total
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Invoice Aging Bar Chart */}
        {aging.isLoading ? (
          <SkeletonChart />
        ) : aging.data ? (
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
              <ResponsiveContainer width="100%" height={300}>
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
              <ResponsiveContainer width="100%" height={300}>
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
