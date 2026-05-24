import { cn } from "~/lib/utils";

/**
 * E-StatementNow brand mark — a statement document on a blue rounded badge.
 * Square (40×40 viewBox); scale via height/width utility classes.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="esnGrad"
          x1="4"
          y1="4"
          x2="36"
          y2="36"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#3B82F6" />
          <stop offset="1" stopColor="#2563EB" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill="url(#esnGrad)" />
      <rect x="13" y="9" width="14" height="22" rx="3" fill="#fff" />
      <rect x="16" y="14" width="8" height="2.2" rx="1.1" fill="#2563EB" />
      <rect x="16" y="18.5" width="8" height="2.2" rx="1.1" fill="#93C5FD" />
      <rect x="16" y="23" width="5" height="2.2" rx="1.1" fill="#93C5FD" />
    </svg>
  );
}

/**
 * Wordmark logo — "E-Statement" with "Now" accented in brand blue. No icon
 * mark (the badge is reserved for the favicon / PWA app icon). `className`
 * controls the text size.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "whitespace-nowrap font-bold tracking-tight text-slate-900",
        className,
      )}
    >
      E-Statement<span className="text-blue-600">Now</span>
    </span>
  );
}
