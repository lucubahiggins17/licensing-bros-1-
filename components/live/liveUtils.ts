"use client";
// Small helpers shared by the Live pages: dates in the viewer's timezone, countdowns, calendar files,
// video link conversion, access hints and realtime channel names.
import type { Account, Course, Live } from "@/lib/types";

/** Assumed class length for calendar entries (lives have no duration column). */
export const CLASS_MINUTES = 60;

/** e.g. "Tue, Oct 21 · 7:00 PM CDT" in the viewer's own timezone */
export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  return `${day} · ${time}`;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

/** Parts for the date block on schedule cards */
export function dateParts(iso: string): { month: string; day: string; weekday: string } {
  const d = new Date(iso);
  return {
    month: d.toLocaleDateString(undefined, { month: "short" }).toUpperCase(),
    day: String(d.getDate()),
    weekday: d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()
  };
}

/** Human countdown: "3d 4h", "2h 05m", "12:04", or null once the time has passed */
export function countdownText(targetIso: string, now: number): string | null {
  const ms = new Date(targetIso).getTime() - now;
  if (isNaN(ms) || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** "12:34" or "1:02:03" */
export function elapsedText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function timeAgo(iso: string): string {
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------------------
// Calendar (.ics) built in the browser
// ---------------------------------------------------------------------------------------
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
/** Fold lines to 75 octets as the iCalendar spec asks (approximated by characters). */
const fold = (line: string) => {
  if (line.length <= 74) return line;
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 73) out.push((i ? " " : "") + line.slice(i, i + 73));
  return out.join("\r\n");
};

export function absoluteUrl(path: string, siteUrl = ""): string {
  const base = siteUrl || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}${path}`;
}

export function buildIcs(live: Pick<Live, "id" | "title" | "description" | "starts_at">, url: string): string {
  const start = new Date(live.starts_at);
  const end = new Date(start.getTime() + CLASS_MINUTES * 60_000);
  const desc = [live.description, `Join here: ${url}`].filter(Boolean).join("\n\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Licensing Bros//Live classes//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:live-${live.id}@licensingbros`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(`Live class: ${live.title}`)}`,
    `DESCRIPTION:${icsText(desc)}`,
    `LOCATION:${icsText(url)}`,
    `URL:${url}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(`Starting soon: ${live.title}`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Download the .ics file through a Blob and a temporary <a download>. */
export function downloadIcs(live: Pick<Live, "id" | "title" | "description" | "starts_at">, url: string) {
  const blob = new Blob([buildIcs(live, url)], { type: "text/calendar;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `${slugify(live.title) || "live-class"}.ics`;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 4000);
}

/** Google Calendar link: used inside the Android app, where blob downloads don't work. */
export function googleCalendarUrl(live: Pick<Live, "title" | "description" | "starts_at">, url: string): string {
  const start = new Date(live.starts_at);
  const end = new Date(start.getTime() + CLASS_MINUTES * 60_000);
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: `Live class: ${live.title}`,
    dates: `${icsDate(start)}/${icsDate(end)}`,
    details: [live.description, `Join here: ${url}`].filter(Boolean).join("\n\n"),
    location: url
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

// ---------------------------------------------------------------------------------------
// Video links
// ---------------------------------------------------------------------------------------
export type Playable = { kind: "iframe"; src: string } | { kind: "video"; src: string } | null;

/** Turns YouTube/Vimeo watch links into embed links; direct files play in <video>. */
export function toPlayable(raw: string | null | undefined, opts: { autoplay?: boolean } = {}): Playable {
  const url = (raw || "").trim();
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const auto = opts.autoplay ? "1" : "0";

  if (host === "youtu.be" || host.endsWith("youtube.com") || host === "youtube-nocookie.com") {
    let id = "";
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    else if (u.pathname === "/watch") id = u.searchParams.get("v") || "";
    else {
      const m = u.pathname.match(/^\/(embed|live|shorts|v)\/([^/?#]+)/);
      if (m) id = m[2];
    }
    if (id) return { kind: "iframe", src: `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=${auto}&playsinline=1&rel=0&modestbranding=1` };
    return { kind: "iframe", src: url };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    if (host === "player.vimeo.com") return { kind: "iframe", src: url };
    const ev = u.pathname.match(/^\/event\/(\d+)/);
    if (ev) return { kind: "iframe", src: `https://vimeo.com/event/${ev[1]}/embed?autoplay=${auto}` };
    const m = u.pathname.match(/^\/(?:.*\/)?(\d+)(?:\/([a-z0-9]+))?/i);
    if (m) return { kind: "iframe", src: `https://player.vimeo.com/video/${m[1]}?${m[2] ? `h=${m[2]}&` : ""}autoplay=${auto}&playsinline=1` };
    return { kind: "iframe", src: url };
  }
  if (/\.(mp4|webm|ogg|ogv|mov|m4v|m3u8)(\?|#|$)/i.test(u.pathname + u.search) || u.pathname.includes("/storage/v1/object/")) {
    return { kind: "video", src: url };
  }
  return { kind: "iframe", src: url };
}

// ---------------------------------------------------------------------------------------
// Access hints (the server still decides; this only labels the cards)
// ---------------------------------------------------------------------------------------
export type AccessHint = { label: string; tone: "free" | "paid" | "ok"; detail: string };

export function accessHint(live: Live, course: Pick<Course, "id" | "title"> | null | undefined, account: Account | null, signedIn: boolean): AccessHint {
  if (account?.is_admin || account?.is_staff) return { label: account?.is_admin ? "Admin" : "Instructor", tone: "ok", detail: "You can watch every class." };
  if (live.is_free) return { label: "Free", tone: "free", detail: signedIn ? "Free class. Just show up." : "Free with a Licensing Bro's account." };
  if (live.course_id) {
    const name = course?.title || "its course";
    if (account?.enrolled?.includes(live.course_id)) return { label: "You're in", tone: "ok", detail: `Included with ${name}, which you own.` };
    return { label: `Included with ${name}`, tone: "paid", detail: `Students of ${name} watch free.` };
  }
  if (account?.paid) return { label: "You're in", tone: "ok", detail: "Included with your Pro access." };
  return { label: "Pro", tone: "paid", detail: "Included with any paid course." };
}

// ---------------------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------------------
/** Unique realtime topic (supabase-js reuses channels with the same name). */
export const channelName = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch { return false; }
  }
}

export const isHttpUrl = (s: string) => {
  try { const u = new URL(s.trim()); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; }
};

export const sortLives = (a: Live, b: Live) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
