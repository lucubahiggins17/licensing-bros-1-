import fs from "node:fs";
import path from "node:path";
/** @type {import('next').NextConfig} */
// Static export: the same build runs as the website (any static host) and inside the Android app.
// AI and accounts are served by Supabase, so no Node server is needed.
// NEXT_PUBLIC_BASE_PATH is set only when the site lives in a subfolder, e.g. GitHub Pages without a custom domain
// (https://you.github.io/licensing-bros). Leave it empty for a custom domain, Vercel and the Android app.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");

// pdf.js reads PDFs (admin knowledge uploads) in a web worker that must be served as-is, not bundled,
// so copy it from node_modules into public/vendor on every build. public/vendor is git-ignored.
try {
  const src = path.join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
  const dst = path.join(process.cwd(), "public/vendor/pdf.worker.min.mjs");
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst);
  }
} catch { /* the PDF upload shows an error instead */ }

const nextConfig = {
  output: "export",
  ...(basePath ? { basePath } : {}),
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false
};

export default nextConfig;
