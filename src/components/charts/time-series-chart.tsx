"use client";

import dayjs from "dayjs";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { formatCurrency } from "~/lib/currency";

export type Granularity = "daily" | "weekly" | "monthly";

export type SeriesPoint = { bucket: string; amount: number };

export function TimeSeriesChart({
  title,
  subtitle,
  series,
  total,
  granularity,
  from,
  to,
  stroke,
  totalLabel = "Total",
  onGranularityChange,
  onFromChange,
  onToChange,
  isLoading,
}: {
  title: string;
  subtitle?: string;
  series: SeriesPoint[];
  total: number;
  granularity: Granularity;
  from: string;
  to: string;
  stroke: string;
  totalLabel?: string;
  onGranularityChange: (g: Granularity) => void;
  onFromChange: (d: string) => void;
  onToChange: (d: string) => void;
  isLoading?: boolean;
}) {
  const tickFormat = (v: string) => {
    const d = dayjs(v);
    if (granularity === "monthly") return d.format("MMM YY");
    if (granularity === "weekly") return d.format("D MMM");
    return d.format("D MMM");
  };
  const labelFormat = (v: string) => {
    const d = dayjs(v);
    if (granularity === "monthly") return d.format("MMMM YYYY");
    if (granularity === "weekly") return `Week of ${d.format("D MMM YYYY")}`;
    return d.format("D MMM YYYY");
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <CardTitle className="text-base font-semibold">{title}</CardTitle>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">{totalLabel}</p>
            <p className="text-2xl font-bold tabular-nums">
              {formatCurrency(total, "SGD")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label className="text-xs">View</Label>
            <Select
              value={granularity}
              onValueChange={(v) => onGranularityChange(v as Granularity)}
            >
              <SelectTrigger className="h-8 w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => onFromChange(e.target.value)}
              className="h-8 w-[140px]"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => onToChange(e.target.value)}
              className="h-8 w-[140px]"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[220px] animate-pulse rounded bg-muted/50" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              data={series}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#e5e7eb"
              />
              <XAxis
                dataKey="bucket"
                tickLine={false}
                axisLine={false}
                fontSize={12}
                tickFormatter={tickFormat}
              />
              <YAxis tickLine={false} axisLine={false} fontSize={12} />
              <Tooltip
                labelFormatter={(v) => labelFormat(String(v))}
                formatter={(v: unknown) => [formatCurrency(v as number, "SGD"), "Amount"]}
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid #e5e7eb",
                  fontSize: "13px",
                }}
              />
              <Line
                type="monotone"
                dataKey="amount"
                stroke={stroke}
                strokeWidth={2}
                dot={{ r: 3, fill: stroke }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

/** Default to "last 6 calendar months" for the initial chart range. */
export function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}
