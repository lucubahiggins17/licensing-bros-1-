/** @type {import('next').NextConfig} */
// Static export: the same build runs as the website (any static host) and inside the Android app.
// AI and accounts are served by Supabase, so no Node server is needed.
// NEXT_PUBLIC_BASE_PATH is set only when the site lives in a subfolder, e.g. GitHub Pages without a custom domain
// (https://you.github.io/licensing-bros). Leave it empty for a custom domain, Vercel and the Android app.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");

const nextConfig = {
  output: "export",
  ...(basePath ? { basePath } : {}),
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false
};

export default nextConfig;
