// This service worker unregisters itself and clears all caches
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", async () => {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map((name) => caches.delete(name)));
  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach((client) => client.navigate(client.url));
  await self.registration.unregister();
});
