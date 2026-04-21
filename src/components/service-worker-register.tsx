"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const isLocalhost =
      window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (isLocalhost) return;

    async function setupSW() {
      try {
        // Clean up the legacy push-only SW if it's still registered — it now
        // lives inside /sw.js, and two SWs at scope "/" would conflict.
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) {
          if (reg.active?.scriptURL.endsWith("/push-sw.js")) {
            await reg.unregister();
            console.log("[SW] Unregistered legacy push-sw.js");
          }
        }

        // Register the main passive SW. Required for Chrome on Android to
        // recognise the app as installable.
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        console.log("[SW] Registered:", reg.scope);
      } catch (error) {
        console.error("[SW] Registration failed:", error);
      }
    }

    void setupSW();
  }, []);

  return null;
}
