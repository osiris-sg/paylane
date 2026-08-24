/**
 * Compact label/value pair used by the detail pages' info cards
 * (invoice / statement / delivery order).
 */
export function Field({
  label,
  value,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-medium">{value || "-"}</p>
    </div>
  );
}
