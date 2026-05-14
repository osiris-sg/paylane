"use client";

import { useMemo, useState } from "react";
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
  FileClock,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import {
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  DateRangeFilter,
  rangeForPreset,
  type RangePreset,
  type DateRange,
} from "~/components/dashboard/date-range-filter";

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

type CardDef = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  bg: string;
  highlight?: "overdue";
  statusFilter: string | null;
};

const CUSTOMER_CARDS: CardDef[] = [
  { key: "total", label: "Total", icon: FileText, accent: "text-blue-600", bg: "bg-blue-50", statusFilter: null },
  { key: "draft", label: "Draft", icon: FileClock, accent: "text-gray-600", bg: "bg-gray-100", statusFilter: "DRAFT" },
  { key: "pending", label: "Pending", icon: Clock, accent: "text-amber-600", bg: "bg-amber-50", statusFilter: "SENT" },
  { key: "overdue", label: "Overdue", icon: AlertTriangle, accent: "text-red-600", bg: "bg-red-50", highlight: "overdue", statusFilter: "OVERDUE" },
  { key: "paid", label: "Paid", icon: DollarSign, accent: "text-emerald-600", bg: "bg-emerald-50", statusFilter: "PAID" },
];

const SUPPLIER_CARDS: CardDef[] = [
  { key: "total", label: "Total", icon: FileDown, accent: "text-purple-600", bg: "bg-purple-50", statusFilter: null },
  { key: "pending", label: "Pending", icon: Clock, accent: "text-amber-600", bg: "bg-amber-50", statusFilter: "SENT" },
  { key: "overdue", label: "Overdue", icon: AlertTriangle, accent: "text-red-600", bg: "bg-red-50", highlight: "overdue", statusFilter: "OVERDUE" },
  { key: "paid", label: "Paid", icon: DollarSign, accent: "text-emerald-600", bg: "bg-emerald-50", statusFilter: "PAID" },
];

type Bucket = { count: number; amount: number };

function SummaryCard({
  card,
  bucket,
  href,
}: {
  card: CardDef;
  bucket: Bucket | undefined;
  href: string | null;
}) {
  const count = bucket?.count ?? 0;
  const amount = bucket?.amount ?? 0;
  const isOverdueHighlight = card.highlight === "overdue" && count > 0;
  const Icon = card.icon;

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
          <div className={`text-2xl font-bold tracking-tight md:text-3xl ${isOverdueHighlight ? "text-red-700" : "text-gray-900"}`}>
            {formatCurrency(amount)}
          </div>
          <p className={`mt-1 text-xs ${isOverdueHighlight ? "font-semibold text-red-600" : "text-muted-foreground"}`}>
            {count} invoice{count === 1 ? "" : "s"}
          </p>
        </div>
      </div>
    </Card>
  );

  return href ? (
    <Link href={href} className="block">
      {cardContent}
    </Link>
  ) : (
    <div>{cardContent}</div>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}

type SummaryShape = {
  sent: Record<string, Bucket>;
  received: Record<string, Bucket>;
};

function CardGrid({
  cards,
  data,
  isLoading,
  buildHref,
  tab,
  cols,
}: {
  cards: CardDef[];
  data: Record<string, Bucket> | undefined;
  isLoading: boolean;
  buildHref: (tab: "sent" | "received", statusFilter: string | null) => string;
  tab: "sent" | "received";
  cols: string;
}) {
  if (isLoading) {
    return (
      <div className={`grid grid-cols-2 gap-4 ${cols}`}>
        {cards.map((c) => (
          <SkeletonCard key={c.key} />
        ))}
      </div>
    );
  }
  return (
    <div className={`grid grid-cols-2 gap-4 ${cols}`}>
      {cards.map((card) => (
        <SummaryCard
          key={card.key}
          card={card}
          bucket={data?.[card.key]}
          href={buildHref(tab, card.statusFilter)}
        />
      ))}
    </div>
  );
}

function DashboardSummary({
  summary,
  isLoading,
  canSend,
  canReceive,
  buildHref,
  mobileTab,
  onMobileTabChange,
}: {
  summary: SummaryShape | undefined;
  isLoading: boolean;
  canSend: boolean;
  canReceive: boolean;
  buildHref: (tab: "sent" | "received", statusFilter: string | null) => string;
  mobileTab: "customer" | "supplier";
  onMobileTabChange: (v: "customer" | "supplier") => void;
}) {
  const customerGrid = canSend ? (
    <CardGrid
      cards={CUSTOMER_CARDS}
      data={summary?.sent}
      isLoading={isLoading}
      buildHref={buildHref}
      tab="sent"
      cols="md:grid-cols-3 lg:grid-cols-5"
    />
  ) : null;

  const supplierGrid = canReceive ? (
    <CardGrid
      cards={SUPPLIER_CARDS}
      data={summary?.received}
      isLoading={isLoading}
      buildHref={buildHref}
      tab="received"
      cols="md:grid-cols-4"
    />
  ) : null;

  const customerSection = canSend ? (
    <section className="space-y-3">
      <SectionHeading title="Customer" subtitle="Invoices you sent to customers" />
      {customerGrid}
    </section>
  ) : null;

  const supplierSection = canReceive ? (
    <section className="space-y-3">
      <SectionHeading title="Supplier" subtitle="Invoices you received from suppliers" />
      {supplierGrid}
    </section>
  ) : null;

  return (
    <>
      {canSend && canReceive ? (
        <div className="md:hidden">
          <Tabs
            value={mobileTab}
            onValueChange={(v) => onMobileTabChange(v as "customer" | "supplier")}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="customer" className="font-bold">
                CUSTOMER
              </TabsTrigger>
              <TabsTrigger value="supplier" className="font-bold">
                SUPPLIER
              </TabsTrigger>
            </TabsList>
            <TabsContent value="customer" className="mt-4">
              {customerGrid}
            </TabsContent>
            <TabsContent value="supplier" className="mt-4">
              {supplierGrid}
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <div className="space-y-6 md:hidden">
          {customerSection}
          {supplierSection}
        </div>
      )}

      <div className="hidden space-y-6 md:block md:space-y-8">
        {customerSection}
        {supplierSection}
      </div>
    </>
  );
}

export default function DashboardPage() {
  const summary = api.dashboard.getSummary.useQuery();
  const { data: onboardingStatus } = api.onboarding.getStatus.useQuery();

  const companyModule = onboardingStatus?.module;
  const canSend = companyModule === "SEND" || companyModule === "BOTH";
  const canReceive = companyModule === "RECEIVE" || companyModule === "BOTH";

  // Filter state — preset + custom range. Default to "Last 6 months".
  const [preset, setPreset] = useState<RangePreset>("6mo");
  const [customRange, setCustomRange] = useState<DateRange>(rangeForPreset("6mo"));
  const effectiveRange = useMemo<DateRange>(
    () => (preset === "custom" ? customRange : rangeForPreset(preset)),
    [preset, customRange],
  );

  const monthly = api.dashboard.getMonthlyTotals.useQuery({
    from: new Date(effectiveRange.from),
    to: new Date(effectiveRange.to),
  });

  // Mobile tab — shared between summary section AND chart section so that
  // selecting CUSTOMER shows only Sales, SUPPLIER shows only Purchases.
  const [mobileTab, setMobileTab] = useState<"customer" | "supplier">(
    canReceive && !canSend ? "supplier" : "customer",
  );

  const buildHref = (tab: "sent" | "received", statusFilter: string | null) => {
    const params = new URLSearchParams({ tab });
    if (statusFilter) params.set("status", statusFilter);
    return `/invoices?${params.toString()}`;
  };

  const showSales = canSend;
  const showPurchases = canReceive;

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

      <DashboardSummary
        summary={summary.data}
        isLoading={summary.isLoading}
        canSend={canSend}
        canReceive={canReceive}
        buildHref={buildHref}
        mobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
      />

      {/* Charts */}
      {(showSales || showPurchases) && (
        <div className="space-y-4">
          <DateRangeFilter
            preset={preset}
            range={effectiveRange}
            onPresetChange={(p) => {
              setPreset(p);
              if (p !== "custom") setCustomRange(rangeForPreset(p));
            }}
            onRangeChange={(r) => {
              setPreset("custom");
              setCustomRange(r);
            }}
          />

          {/* Desktop / tablet — show both side by side */}
          <div className="hidden md:grid md:grid-cols-2 md:gap-6">
            {showSales && (
              <MonthlyChart
                title="Sales"
                subtitle="Invoices sent"
                icon={TrendingUp}
                accent="text-blue-600"
                bg="bg-blue-50"
                data={monthly.data?.buckets ?? []}
                dataKey="sent"
                stroke="#3b82f6"
                seriesLabel="Sales"
                total={monthly.data?.sentTotal ?? 0}
                granularity={monthly.data?.granularity ?? "monthly"}
                isLoading={monthly.isLoading}
              />
            )}
            {showPurchases && (
              <MonthlyChart
                title="Purchases"
                subtitle="Invoices received"
                icon={TrendingDown}
                accent="text-purple-600"
                bg="bg-purple-50"
                data={monthly.data?.buckets ?? []}
                dataKey="received"
                stroke="#8b5cf6"
                seriesLabel="Purchases"
                total={monthly.data?.receivedTotal ?? 0}
                granularity={monthly.data?.granularity ?? "monthly"}
                isLoading={monthly.isLoading}
              />
            )}
          </div>

          {/* Mobile — show only the chart for the active tab */}
          <div className="md:hidden">
            {showSales && showPurchases ? (
              mobileTab === "customer" ? (
                <MonthlyChart
                  title="Sales"
                  subtitle="Invoices sent"
                  icon={TrendingUp}
                  accent="text-blue-600"
                  bg="bg-blue-50"
                  data={monthly.data?.buckets ?? []}
                  dataKey="sent"
                  stroke="#3b82f6"
                  seriesLabel="Sales"
                  total={monthly.data?.sentTotal ?? 0}
                  granularity={monthly.data?.granularity ?? "monthly"}
                  isLoading={monthly.isLoading}
                />
              ) : (
                <MonthlyChart
                  title="Purchases"
                  subtitle="Invoices received"
                  icon={TrendingDown}
                  accent="text-purple-600"
                  bg="bg-purple-50"
                  data={monthly.data?.buckets ?? []}
                  dataKey="received"
                  stroke="#8b5cf6"
                  seriesLabel="Purchases"
                  total={monthly.data?.receivedTotal ?? 0}
                  granularity={monthly.data?.granularity ?? "monthly"}
                  isLoading={monthly.isLoading}
                />
              )
            ) : (
              <>
                {showSales && (
                  <MonthlyChart
                    title="Sales"
                    subtitle="Invoices sent"
                    icon={TrendingUp}
                    accent="text-blue-600"
                    bg="bg-blue-50"
                    data={monthly.data?.buckets ?? []}
                    dataKey="sent"
                    stroke="#3b82f6"
                    seriesLabel="Sales"
                    total={monthly.data?.sentTotal ?? 0}
                    granularity={monthly.data?.granularity ?? "monthly"}
                    isLoading={monthly.isLoading}
                  />
                )}
                {showPurchases && (
                  <MonthlyChart
                    title="Purchases"
                    subtitle="Invoices received"
                    icon={TrendingDown}
                    accent="text-purple-600"
                    bg="bg-purple-50"
                    data={monthly.data?.buckets ?? []}
                    dataKey="received"
                    stroke="#8b5cf6"
                    seriesLabel="Purchases"
                    total={monthly.data?.receivedTotal ?? 0}
                    granularity={monthly.data?.granularity ?? "monthly"}
                    isLoading={monthly.isLoading}
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MonthlyChart({
  title,
  subtitle,
  icon: Icon,
  accent,
  bg,
  data,
  dataKey,
  stroke,
  seriesLabel,
  total,
  granularity,
  isLoading,
}: {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  accent: string;
  bg: string;
  data: Array<{ month: string; sent: number; received: number }>;
  dataKey: "sent" | "received";
  stroke: string;
  seriesLabel: string;
  total: number;
  granularity: "daily" | "weekly" | "monthly";
  isLoading?: boolean;
}) {
  const tickFormat = (v: string) => {
    const d = dayjs(v);
    if (granularity === "monthly") return d.format("MMM YY");
    return d.format("D MMM");
  };
  const labelFormat = (v: string) => {
    const d = dayjs(v);
    if (granularity === "monthly") return d.format("MMMM YYYY");
    if (granularity === "weekly") return `Week of ${d.format("D MMM YYYY")}`;
    return d.format("D MMM YYYY");
  };
  return (
    <Card className="overflow-hidden shadow-sm">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className={`rounded-lg p-2 ${bg}`}>
              <Icon className={`h-4 w-4 ${accent}`} />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">{title}</CardTitle>
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-2xl font-bold tabular-nums">
              {formatCurrency(total)}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[220px] animate-pulse rounded bg-muted/40" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                fontSize={12}
                tickFormatter={tickFormat}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={12}
                tickFormatter={(v) => formatCurrencyCompact(v)}
              />
              <Tooltip
                labelFormatter={(v) => labelFormat(String(v))}
                formatter={(value) => [formatCurrency(value), "Amount"]}
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid #e5e7eb",
                  fontSize: "13px",
                }}
              />
              <Line
                type="monotone"
                dataKey={dataKey}
                stroke={stroke}
                strokeWidth={2}
                dot={{ r: 3, fill: stroke }}
                activeDot={{ r: 5 }}
                name={seriesLabel}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
