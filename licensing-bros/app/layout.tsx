import "@fontsource/archivo-black/400.css";
import "@fontsource/archivo/600.css";
import "@fontsource/archivo/700.css";
import "@fontsource/archivo/800.css";
import "@fontsource/archivo/900.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import Providers from "./providers";

import { asset } from "@/lib/basePath";
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://licensingbros.com").replace(/\/+$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "Licensing Bro's — Contractor License Exam Prep",
  description: "Master your contractor license: courses, live classes, an AI tutor you can talk to, timed mock exams and games for general contractor, electrical, plumbing and HVAC exams in all 50 states.",
  icons: { icon: asset("/icon-192.png"), apple: asset("/apple-touch-icon.png") },
  appleWebApp: { capable: true, title: "Licensing Bro's", statusBarStyle: "default" },
  openGraph: {
    title: "Licensing Bro's — Master your contractor license",
    description: "Courses, live classes and an AI tutor for GC, electrical, plumbing and HVAC licensing exams.",
    images: [`${SITE}/logo.png`]
  }
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#1b1f3b" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
