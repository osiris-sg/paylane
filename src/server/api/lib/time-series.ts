/** Bucket key generator for daily / weekly / monthly aggregation. */
export type Granularity = "daily" | "weekly" | "monthly";

export function bucketKey(date: Date, granularity: Granularity): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();

  if (granularity === "daily") {
    const mm = String(m + 1).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }

  if (granularity === "monthly") {
    const mm = String(m + 1).padStart(2, "0");
    return `${y}-${mm}-01`;
  }

  // weekly — bucket = Monday of the week (ISO).
  const dow = date.getUTCDay() || 7; // 1..7, Sunday → 7
  const monday = new Date(Date.UTC(y, m, d - dow + 1));
  const yy = monday.getUTCFullYear();
  const mm = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(monday.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Returns a list of every bucket key from `from` to `to` inclusive. */
export function bucketRange(
  from: Date,
  to: Date,
  granularity: Granularity,
): string[] {
  const keys = new Set<string>();
  const cursor = new Date(from);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor <= to) {
    keys.add(bucketKey(cursor, granularity));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return Array.from(keys).sort();
}

/**
 * Group { invoicedDate, amount } rows into [{ bucket, amount }], including
 * empty buckets so the chart shows a continuous time axis.
 */
export function aggregateByBucket<
  T extends { invoicedDate: Date; amount: { toString(): string } | number },
>(
  rows: T[],
  from: Date,
  to: Date,
  granularity: Granularity,
): Array<{ bucket: string; amount: number }> {
  const totals = new Map<string, number>();
  for (const k of bucketRange(from, to, granularity)) totals.set(k, 0);

  for (const row of rows) {
    const k = bucketKey(new Date(row.invoicedDate), granularity);
    if (!totals.has(k)) continue;
    const amt =
      typeof row.amount === "number" ? row.amount : Number(row.amount);
    totals.set(k, (totals.get(k) ?? 0) + amt);
  }

  return Array.from(totals.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([bucket, amount]) => ({ bucket, amount }));
}
