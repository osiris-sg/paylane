import withPWAInit from "next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  register: false, // We register manually for better iOS support
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default withPWA(nextConfig);
