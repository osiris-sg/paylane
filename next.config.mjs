import withPWAInit from "next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  register: false,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  // Disable precaching — this is what causes stale HTML crashes
  buildExcludes: [/./],
  runtimeCaching: [
    {
      // HTML pages — ALWAYS go to network, never serve cached HTML
      urlPattern: ({ request }) => request.mode === "navigate",
      handler: "NetworkOnly",
    },
    {
      // Next.js data/RSC requests
      urlPattern: /\/_next\/data\/.+\/.+\.json$/,
      handler: "NetworkFirst",
      options: {
        cacheName: "next-data",
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 60 * 5,
        },
      },
    },
    {
      // Next.js JS/CSS bundles
      urlPattern: /\/_next\/static\/.+/,
      handler: "CacheFirst",
      options: {
        cacheName: "next-static",
        expiration: {
          maxEntries: 64,
          maxAgeSeconds: 24 * 60 * 60,
        },
      },
    },
    {
      // API calls — always network
      urlPattern: /\/api\/.*/,
      handler: "NetworkOnly",
    },
    {
      // tRPC calls — always network
      urlPattern: /\/trpc\/.*/,
      handler: "NetworkOnly",
    },
    {
      // Static assets (images, fonts) — cache first
      urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?)$/,
      handler: "CacheFirst",
      options: {
        cacheName: "static-assets",
        expiration: {
          maxEntries: 64,
          maxAgeSeconds: 7 * 24 * 60 * 60,
        },
      },
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default withPWA(nextConfig);
