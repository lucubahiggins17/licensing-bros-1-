"use client";
// Small navigation helpers for the static site (routes use query strings, e.g. /course/?id=...).
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Read a query-string value on the client (static export has no server-side params).
 * Returns undefined until mounted, then the value (or null). Updates on <Link>/router navigation and back/forward.
 * Every route file wraps its page in <Suspense>, which useSearchParams needs in a static export.
 */
export function useQueryParam(name: string): string | null | undefined {
  const params = useSearchParams();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return undefined;
  return params?.get(name) ?? null;
}

export const routes = {
  home: "/",
  courses: (q?: { state?: string; trade?: string }) => `/courses/${q ? "?" + new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString() : ""}`,
  course: (id: string) => `/course/?id=${id}`,
  lesson: (id: string) => `/lesson/?id=${id}`,
  learn: (tab?: string) => `/learn/${tab ? "#" + tab : ""}`,
  lives: "/live/",
  watch: (id: string) => `/live/watch/?id=${id}`,
  studio: (id: string) => `/live/studio/?id=${id}`,
  community: "/community/",
  post: (id: string) => `/community/?post=${id}`,
  account: (tab?: string) => `/account/${tab ? "#" + tab : ""}`,
  admin: (tab?: string) => `/admin/${tab ? "#" + tab : ""}`,
  login: (mode?: "signup", next?: string) => `/login/${mode || next ? "?" + new URLSearchParams({ ...(mode ? { mode } : {}), ...(next ? { next } : {}) }).toString() : ""}`,
  verify: (code?: string) => `/verify/${code ? "?code=" + code : ""}`
};

export const IS_APP_BUILD = process.env.NEXT_PUBLIC_TARGET === "app";
export { BASE_PATH, asset, stripBase } from "./basePath";
/** The public website address (used for checkout links from the Android app) */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
