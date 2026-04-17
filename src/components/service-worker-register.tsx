"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (isLocalhost) return;

    async function registerSW() {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

        // Force check for updates on every page load
        registration.update().catch(() => {});

        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                // New version available — activate immediately
                newWorker.postMessage({ type: "SKIP_WAITING" });
              }
            });
          }
        });

        let refreshing = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (refreshing) return;
          refreshing = true;
          window.location.reload();
        });
      } catch (error) {
        console.error("[SW] Registration failed:", error);
        // If SW fails, unregister it so the app still works
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const reg of registrations) {
            await reg.unregister();
          }
          console.log("[SW] Unregistered broken service workers");
        } catch {
          // ignore
        }
      }
    }

    registerSW();
  }, []);

  return null;
}
