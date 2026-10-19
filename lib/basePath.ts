// Subfolder support (no "use client": the root layout and manifest use it at build time too).
// NEXT_PUBLIC_BASE_PATH is set only when the site is served from a subfolder, e.g. GitHub Pages without a custom
// domain (https://you.github.io/licensing-bros). Links and router calls add it automatically; plain <img> tags,
// icons and other file URLs need asset().
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");
export const asset = (p: string) => `${BASE_PATH}${p}`;
/** A same-site path without the subfolder, safe to hand to router.push or <Link>. */
export function stripBase(p: string): string {
  if (BASE_PATH && (p === BASE_PATH || p.startsWith(BASE_PATH + "/"))) return p.slice(BASE_PATH.length) || "/";
  return p;
}
