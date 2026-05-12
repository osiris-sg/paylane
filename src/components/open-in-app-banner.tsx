"use client";

import { useEffect, useState } from "react";
import { Smartphone, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { isStandalone } from "~/components/pwa-install-guide";

/**
 * Shown on shareable detail pages (invoice, etc.) when the user lands there
 * from outside the PWA — e.g. a WhatsApp button link. On Android Chrome the
 * "Open" action can trigger the PWA's app-switcher prompt; on iOS the OS
 * doesn't support web-link → PWA redirection so we just nudge the user to
 * open from their home screen.
 */
export function OpenInAppBanner() {
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandalone()) return;
    if (sessionStorage.getItem("open-in-app-dismissed")) return;
    const ua = navigator.userAgent.toLowerCase();
    const isMobile = /iphone|ipad|ipod|android/.test(ua);
    if (!isMobile) return;
    setIsIOS(/iphone|ipad|ipod/.test(ua));
    setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    sessionStorage.setItem("open-in-app-dismissed", "1");
    setShow(false);
  };

  const tryOpen = () => {
    // On Android Chrome, navigating to the same URL after PWA install can
    // surface the "Open with PayLane" intent picker. On iOS this is a no-op
    // but reloads to the same page.
    window.location.href = window.location.href;
  };

  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 dark:border-blue-900 dark:bg-blue-950/30">
      <div className="flex items-center gap-2.5 min-w-0">
        <Smartphone className="h-5 w-5 shrink-0 text-blue-600" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
            Open in the PayLane app
          </p>
          <p className="truncate text-xs text-blue-700 dark:text-blue-300">
            {isIOS
              ? "Tap your PayLane icon on the home screen for the full experience."
              : "Better performance and push notifications inside the app."}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {!isIOS && (
          <Button size="sm" onClick={tryOpen} className="shrink-0">
            Open
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          onClick={dismiss}
          className="h-8 w-8 shrink-0 text-blue-600 hover:bg-blue-100"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
