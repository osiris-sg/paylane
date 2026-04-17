import withPWAInit from "next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  register: false,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  runtimeCaching: [
    {
      // Never cache page navigations — always go to network
      urlPattern: /^https:\/\/.*\/_next\/.*$/,
      handler: "NetworkFirst",
      options: {
        cacheName: "next-assets",
        expiration: {
          maxEntries: 64,
          maxAgeSeconds: 24 * 60 * 60, // 1 day
        },
      },
    },
    {
      // API calls — always network first
      urlPattern: /^https:\/\/.*\/api\/.*/,
      handler: "NetworkFirst",
      options: {
        cacheName: "api-cache",
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 60 * 5, // 5 minutes
        },
      },
    },
    {
      // Static assets (images, fonts) — cache first
      urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?)$/,
      handler: "CacheFirst",
      options: {
        cacheName: "static-assets",
        expiration: {
          maxEntries: 64,
          maxAgeSeconds: 7 * 24 * 60 * 60, // 1 week
        },
      },
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default withPWA(nextConfig);
