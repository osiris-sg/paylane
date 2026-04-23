/**
 * Registry of supported feature flags. Safe to import from client components.
 * Add new entries here — the admin page renders a toggle for each one.
 * `defaultEnabled` is the value used when the DB has no row for that key yet.
 */
export const FEATURE_FLAGS = {
  paymentApprovalFlow: {
    label: "Payment approval flow",
    description:
      "When enabled, receivers can submit payment and senders approve/reject before an invoice is marked PAID. When disabled, the platform only displays invoices — the only action allowed on a sent invoice is Delete.",
    defaultEnabled: false,
  },
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;
export const FEATURE_FLAG_KEYS = Object.keys(FEATURE_FLAGS) as FeatureFlagKey[];
