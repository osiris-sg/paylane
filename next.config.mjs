/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // react-pdf / pdfjs-dist references an optional `canvas` Node binding we
    // don't use in the browser; alias it away so the build doesn't bundle it.
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
