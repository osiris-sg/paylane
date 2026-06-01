"use client";

import dayjs from "dayjs";
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

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

export function MonthlyChart({
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
  const xAxisLabel =
    granularity === "monthly" ? "Month" : granularity === "weekly" ? "Week" : "Day";
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
          <ResponsiveContainer width="100%" height={240}>
            <LineChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 24, left: 16 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                fontSize={12}
                tickFormatter={tickFormat}
                label={{
                  value: xAxisLabel,
                  position: "insideBottom",
                  offset: -12,
                  style: { fontSize: 11, fill: "#6b7280" },
                }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={12}
                width={56}
                tickFormatter={(v) => formatCurrencyCompact(v)}
                label={{
                  value: "Amount (SGD)",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 11, fill: "#6b7280", textAnchor: "middle" },
                }}
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
