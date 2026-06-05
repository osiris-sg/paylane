"use client";

import { useState } from "react";
import {
  SlidersHorizontal,
  ChevronDown,
  Search,
  Check as CheckIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  ALL_DATES,
  DATE_PRESETS,
  dateFilterLabel,
  isDateFilterActive,
  type DateFilterValue,
} from "./date-filter";

/** A single option row inside a filter section. */
function OptionRow({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${
        selected ? "bg-blue-50 font-medium dark:bg-blue-950/40" : ""
      }`}
    >
      <span>{children}</span>
      {selected && <CheckIcon className="h-3.5 w-3.5 text-blue-600" />}
    </button>
  );
}

/**
 * Collapsible "Date" section — last 7/30/90 days or a custom range. Styled to
 * match the Customer section in the invoices filter so they stack cleanly inside
 * the same popover.
 */
function DateSection({
  value,
  onChange,
}: {
  value: DateFilterValue;
  onChange: (v: DateFilterValue) => void;
}) {
  const active = isDateFilterActive(value);
  const [open, setOpen] = useState(active);
  const label = dateFilterLabel(value);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        <span className="flex items-center gap-2">
          Date
          {label && (
            <span className="max-w-[150px] truncate rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
              {label}
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="space-y-0.5 px-2 pb-2">
          <OptionRow
            selected={value.preset === "all"}
            onClick={() => onChange(ALL_DATES)}
          >
            All time
          </OptionRow>
          {DATE_PRESETS.map((p) => (
            <OptionRow
              key={p.value}
              selected={value.preset === p.value}
              onClick={() => onChange({ preset: p.value, from: "", to: "" })}
            >
              {p.label}
            </OptionRow>
          ))}
          <OptionRow
            selected={value.preset === "custom"}
            onClick={() => onChange({ ...value, preset: "custom" })}
          >
            Custom range
          </OptionRow>

          {value.preset === "custom" && (
            <div className="flex flex-col gap-2 px-1 pt-1.5">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                From
                <Input
                  type="date"
                  value={value.from}
                  max={value.to || undefined}
                  onChange={(e) =>
                    onChange({ ...value, preset: "custom", from: e.target.value })
                  }
                  className="h-8"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                To
                <Input
                  type="date"
                  value={value.to}
                  min={value.from || undefined}
                  onChange={(e) =>
                    onChange({ ...value, preset: "custom", to: e.target.value })
                  }
                  className="h-8"
                />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export type FilterEntity = {
  id: string;
  name: string;
  company?: string | null;
};

/**
 * Collapsible searchable entity picker (Customer / Supplier). Styled to match
 * the Date section so they stack inside the same popover. Single-select; passing
 * `undefined` to onChange clears it.
 */
export function EntityFilterSection({
  label,
  allLabel,
  emptyLabel,
  options,
  selectedId,
  onChange,
}: {
  label: string;
  allLabel?: string;
  emptyLabel?: string;
  options: FilterEntity[];
  selectedId: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const [open, setOpen] = useState(!!selectedId);
  const [search, setSearch] = useState("");
  const selected = options.find((o) => o.id === selectedId);
  const q = search.toLowerCase();
  const filtered = options.filter(
    (o) =>
      !q ||
      (o.company ?? "").toLowerCase().includes(q) ||
      o.name.toLowerCase().includes(q),
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        <span className="flex items-center gap-2">
          {label}
          {selected && (
            <span className="max-w-[140px] truncate rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
              {selected.company || selected.name}
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-2 pb-2">
          <div className="mb-1 flex items-center gap-2 rounded-md border bg-background px-2 py-1">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder={`Search ${label.toLowerCase()}s...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                onChange(undefined);
                setSearch("");
              }}
              className={`flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${!selectedId ? "bg-blue-50 font-medium dark:bg-blue-950/40" : ""}`}
            >
              <span>{allLabel ?? `All ${label}s`}</span>
              {!selectedId && <CheckIcon className="h-3.5 w-3.5 text-blue-600" />}
            </button>
            {filtered.length === 0 ? (
              <p className="py-3 text-center text-xs text-muted-foreground">
                {emptyLabel ?? `No ${label.toLowerCase()}s`}
              </p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    onChange(o.id);
                    setSearch("");
                  }}
                  className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${o.id === selectedId ? "bg-blue-50 dark:bg-blue-950/40" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{o.company || o.name}</p>
                    {o.company && o.name !== o.company && (
                      <p className="truncate text-xs text-muted-foreground">{o.name}</p>
                    )}
                  </div>
                  {o.id === selectedId && (
                    <CheckIcon className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Unified "Filter" popover used across the invoices, statements and
 * delivery-order lists. Always provides a Date section; pages can pass extra
 * collapsible sections via `children` (e.g. the invoices Customer filter) along
 * with their active count + clear handler so the shared header stays accurate.
 */
export function FilterMenu({
  date,
  onDateChange,
  extraActiveCount = 0,
  onClearExtra,
  children,
}: {
  date: DateFilterValue;
  onDateChange: (v: DateFilterValue) => void;
  extraActiveCount?: number;
  onClearExtra?: () => void;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const activeCount = (isDateFilterActive(date) ? 1 : 0) + extraActiveCount;

  const clearAll = () => {
    onDateChange(ALL_DATES);
    onClearExtra?.();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="relative h-10 shrink-0 gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">Filter</span>
          {activeCount > 0 && (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold text-white">
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="end">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Filters</span>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              Clear all
            </button>
          )}
        </div>

        {children}

        <div className={children ? "border-t" : undefined}>
          <DateSection value={date} onChange={onDateChange} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
