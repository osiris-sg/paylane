// PayLane service worker — minimal passive SW so Chrome on Android recognises
// the app as installable ("Install app" instead of "Add shortcut"). We don't
// cache anything: previous caching attempts caused stale HTML issues. The
// fetch handler is required for installability but just passes through.

const SW_VERSION = "v3-passive";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Clear any leftover caches from previous SW versions
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
      await self.clients.claim();
      console.log("[SW] Activated", SW_VERSION);
    })(),
  );
});

// Pass-through fetch handler. No caching. Its presence is what makes Chrome
// consider the app installable.
self.addEventListener("fetch", (event) => {
  // Only intercept same-origin, non-extension requests
  const url = new URL(event.request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  // Let the browser handle it normally; the pass-through is just so the
  // fetch event has a registered listener.
  return;
});

// ─── Push Notifications ──────────────────────────────────────────────────

self.addEventListener("push", function (event) {
  if (!event.data) return;

  try {
    const data = event.data.json();

    const options = {
      body: data.body,
      icon: "/icons/icon-192x192.png",
      badge: "/icons/icon-192x192.png",
      vibrate: [100, 50, 100],
      data: { url: data.url || "/" },
      tag: data.tag || "paylane-notification",
      renotify: data.renotify || false,
      requireInteraction: data.requireInteraction || false,
    };

    event.waitUntil(self.registration.showNotification(data.title, options));
  } catch (error) {
    console.error("[SW Push] Error:", error);
  }
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || "/dashboard";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url.includes(urlToOpen) && "focus" in client) {
            return client.focus();
          }
        }
        if (clientList.length > 0) {
          const client = clientList[0];
          if ("navigate" in client) {
            return client.navigate(urlToOpen).then(function (c) {
              return c && c.focus();
            });
          }
          return client.focus();
        }
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      }),
  );
});
