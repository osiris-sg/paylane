"use client";

import { useMemo } from "react";
import dayjs from "dayjs";
import { Calendar } from "lucide-react";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

export type DateRange = { from: string; to: string };

export type RangePreset =
  | "7d"
  | "30d"
  | "3mo"
  | "6mo"
  | "ytd"
  | "1y"
  | "custom";

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "3mo", label: "3 months" },
  { value: "6mo", label: "6 months" },
  { value: "ytd", label: "YTD" },
  { value: "1y", label: "12 months" },
];

export function rangeForPreset(preset: RangePreset, custom?: DateRange): DateRange {
  if (preset === "custom" && custom) return custom;
  const to = dayjs().endOf("day");
  let from = dayjs().subtract(6, "month").startOf("day");
  if (preset === "7d") from = dayjs().subtract(6, "day").startOf("day");
  else if (preset === "30d") from = dayjs().subtract(29, "day").startOf("day");
  else if (preset === "3mo") from = dayjs().subtract(3, "month").startOf("day");
  else if (preset === "6mo") from = dayjs().subtract(6, "month").startOf("day");
  else if (preset === "1y") from = dayjs().subtract(1, "year").startOf("day");
  else if (preset === "ytd") from = dayjs().startOf("year");
  return {
    from: from.format("YYYY-MM-DD"),
    to: to.format("YYYY-MM-DD"),
  };
}

export function DateRangeFilter({
  preset,
  range,
  onPresetChange,
  onRangeChange,
}: {
  preset: RangePreset;
  range: DateRange;
  onPresetChange: (p: RangePreset) => void;
  onRangeChange: (r: DateRange) => void;
}) {
  const summary = useMemo(() => {
    const from = dayjs(range.from);
    const to = dayjs(range.to);
    if (from.year() === to.year()) {
      return `${from.format("D MMM")} – ${to.format("D MMM YYYY")}`;
    }
    return `${from.format("D MMM YYYY")} – ${to.format("D MMM YYYY")}`;
  }, [range.from, range.to]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          Time frame
        </div>
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => onPresetChange(p.value)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              preset === p.value
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPresetChange("custom")}
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
            preset === "custom"
              ? "border-blue-600 bg-blue-600 text-white"
              : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
          )}
        >
          Custom
        </button>
        <span className="ml-auto text-xs text-muted-foreground">{summary}</span>
      </div>

      {preset === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={range.from}
            onChange={(e) => onRangeChange({ ...range, from: e.target.value })}
            className="h-8 w-[150px]"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={range.to}
            onChange={(e) => onRangeChange({ ...range, to: e.target.value })}
            className="h-8 w-[150px]"
          />
        </div>
      )}
    </div>
  );
}
