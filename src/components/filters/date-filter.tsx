import dayjs from "dayjs";

export type DatePreset = "all" | "7d" | "30d" | "90d" | "custom";

export type DateFilterValue = {
  preset: DatePreset;
  /** YYYY-MM-DD — only meaningful when preset === "custom" */
  from: string;
  to: string;
};

export const ALL_DATES: DateFilterValue = { preset: "all", from: "", to: "" };

export const DATE_PRESETS: { value: Exclude<DatePreset, "all" | "custom">; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

/**
 * Resolve the filter value to a concrete [from, to] range, or null when the
 * filter is inactive ("all", or "custom" with no dates entered). A "custom"
 * range with only one bound is treated as open-ended on the other side.
 */
export function resolveDateRange(
  v: DateFilterValue,
): { from: Date; to: Date } | null {
  if (v.preset === "all") return null;
  const to = dayjs().endOf("day");
  if (v.preset === "7d")
    return { from: dayjs().subtract(6, "day").startOf("day").toDate(), to: to.toDate() };
  if (v.preset === "30d")
    return { from: dayjs().subtract(29, "day").startOf("day").toDate(), to: to.toDate() };
  if (v.preset === "90d")
    return { from: dayjs().subtract(89, "day").startOf("day").toDate(), to: to.toDate() };

  // custom
  const from = v.from ? dayjs(v.from).startOf("day") : null;
  const customTo = v.to ? dayjs(v.to).endOf("day") : null;
  if (!from && !customTo) return null;
  return {
    from: (from ?? dayjs("1970-01-01")).toDate(),
    to: (customTo ?? dayjs().endOf("day")).toDate(),
  };
}

/** True when `date` falls within the resolved range (range null = "all"). */
export function withinDateRange(
  date: Date | string | null | undefined,
  v: DateFilterValue,
): boolean {
  const range = resolveDateRange(v);
  if (!range) return true;
  if (!date) return false;
  const t = new Date(date).getTime();
  return t >= range.from.getTime() && t <= range.to.getTime();
}

/** Whether the date filter is doing anything. */
export function isDateFilterActive(v: DateFilterValue): boolean {
  return resolveDateRange(v) !== null;
}

/** Short label for the active-filter chip, or null when inactive. */
export function dateFilterLabel(v: DateFilterValue): string | null {
  switch (v.preset) {
    case "7d":
      return "Last 7 days";
    case "30d":
      return "Last 30 days";
    case "90d":
      return "Last 90 days";
    case "custom": {
      const r = resolveDateRange(v);
      if (!r) return null;
      const f = dayjs(r.from);
      const t = dayjs(r.to);
      return f.year() === t.year()
        ? `${f.format("D MMM")} – ${t.format("D MMM")}`
        : `${f.format("D MMM 'YY")} – ${t.format("D MMM 'YY")}`;
    }
    default:
      return null;
  }
}
