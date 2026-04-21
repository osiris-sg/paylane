// Some statements/invoices use non-ISO shorthand. Normalise before handing
// the code to Intl.NumberFormat, which throws on unknown currencies.
const ALIASES: Record<string, string> = {
  RP: "IDR",
  RMB: "CNY",
  RIAL: "IRR",
  NT: "TWD",
  NTD: "TWD",
};

export function normalizeCurrency(code: string | null | undefined): string {
  if (!code) return "USD";
  const trimmed = code.trim().toUpperCase();
  if (ALIASES[trimmed]) return ALIASES[trimmed]!;
  // ISO 4217 codes are 3 letters. Anything else falls back to USD.
  if (/^[A-Z]{3}$/.test(trimmed)) return trimmed;
  return "USD";
}

export function formatCurrency(
  amount: number | unknown,
  currency: string | null | undefined,
  locale = "en-US",
): string {
  const code = normalizeCurrency(currency);
  const value = Number(amount);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);
  } catch {
    const safeValue = Number.isFinite(value) ? value.toFixed(2) : "0.00";
    return `${code} ${safeValue}`;
  }
}
