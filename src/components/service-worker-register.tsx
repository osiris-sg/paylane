"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (isLocalhost) return;

    // Unregister any existing service workers to prevent stale cache issues
    // The PWA still works for home screen install without a service worker
    async function cleanupSW() {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
          console.log("[SW] Unregistered service worker:", reg.scope);
        }
        // Clear all caches
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
          await caches.delete(name);
          console.log("[SW] Deleted cache:", name);
        }
      } catch (error) {
        console.error("[SW] Cleanup failed:", error);
      }
    }

    cleanupSW();
  }, []);

  return null;
}
