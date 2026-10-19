"use client";
// AI calls for the study tools. They go through lib/api (sign-in + x-session-id headers, friendly errors),
// re-claim this device once if the server says the session is stale, and keep a small "used today" count.
import { useEffect, useState } from "react";
import { ApiError, callFn, streamFn } from "@/lib/api";
import { claimSession } from "@/lib/session";

/** Kept for older imports: AI errors are ApiErrors ({message, status, code, data}). */
export { ApiError as AIError };

export type Turn = { role: "user" | "assistant"; content: string };
export type TutorBody = {
  state: string;
  trade: string;
  messages: Turn[];
  image?: { mediaType: string; data: string };
  /** Extra background, e.g. the lesson summary or the exam question being explained */
  context?: string;
  /** Speech-friendly reply (short, no markdown, ends with a check-in question) */
  voice?: boolean;
};

const SESSION_CODES = new Set(["session_replaced", "no_session"]);

/** Runs a call; when this device's session is stale, claims it again (no takeover) and retries once. */
export async function withSessionRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e: any) {
    if (e instanceof ApiError && SESSION_CODES.has(e.code)) {
      const s = await claimSession(false);
      if (s.status === "ok") return run();
    }
    throw e;
  }
}

// ---- "AI questions used today" on this device (server day = UTC). The server is the authority; this is a hint.
const USAGE_KEY = "lb.ai.used";
const USAGE_EVENT = "lb:ai-used";
const utcDay = () => new Date().toISOString().slice(0, 10);
type Usage = { day: string; n: number; hit?: boolean };

function readUsage(): Usage {
  try {
    const v = JSON.parse(localStorage.getItem(USAGE_KEY) || "null");
    if (v && v.day === utcDay()) return { day: v.day, n: Number(v.n) || 0, hit: !!v.hit };
  } catch { /* storage blocked */ }
  return { day: utcDay(), n: 0 };
}
function writeUsage(u: Usage) {
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch { /* storage blocked */ }
  try { window.dispatchEvent(new Event(USAGE_EVENT)); } catch { /* not in a browser */ }
}
const bumpUsage = () => { const u = readUsage(); writeUsage({ ...u, n: u.n + 1 }); };
const markLimitHit = () => writeUsage({ ...readUsage(), hit: true });

/** AI requests made from this device today, and whether the server already said the daily limit is reached. */
export function useAiUsage(): Usage {
  const [u, setU] = useState<Usage>({ day: "", n: 0 });
  useEffect(() => {
    const read = () => setU(readUsage());
    read();
    window.addEventListener(USAGE_EVENT, read);
    window.addEventListener("storage", read);
    return () => { window.removeEventListener(USAGE_EVENT, read); window.removeEventListener("storage", read); };
  }, []);
  return u;
}

async function tracked<T>(run: () => Promise<T>, count = true): Promise<T> {
  try {
    const r = await withSessionRetry(run);
    if (count) bumpUsage();
    return r;
  } catch (e: any) {
    if (e?.code === "limit_reached") markLimitHit();
    throw e;
  }
}

/** Streams a tutor answer; onText gets the full text so far. */
export function streamTutor(body: TutorBody, onText: (text: string) => void, signal?: AbortSignal): Promise<string> {
  return tracked(() => streamFn("tutor", body, onText, signal));
}

export function generate<T = any>(body: Record<string, unknown>): Promise<T> {
  return tracked(() => callFn<T>("generate", body), body.kind !== "delete_account");
}

/** Shrinks a photo to about 1400px on the long side as JPEG base64 (keeps uploads small). */
export async function shrinkImage(file: File): Promise<{ mediaType: string; data: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const data = c.toDataURL("image/jpeg", 0.85).split(",")[1];
    return { mediaType: "image/jpeg", data };
  } finally { URL.revokeObjectURL(url); }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

/** "nfpa.org" from "https://www.nfpa.org/codes/..." */
export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// [label](https://…) or a bare https:// link (trailing punctuation left out)
const LINK_RE = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()"']*[^\s<>()"'.,;:!?])/g;
const fmt = (h: string) => h.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");

/** One line of text → safe HTML with bold, code and clickable http(s) links. */
function inline(raw: string): string {
  let out = "", last = 0;
  LINK_RE.lastIndex = 0;
  for (let m = LINK_RE.exec(raw); m; m = LINK_RE.exec(raw)) {
    const url = m[2] || m[3];
    out += fmt(esc(raw.slice(last, m.index)));
    out += `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(m[1] || hostOf(url))}</a>`;
    last = m.index + m[0].length;
  }
  return out + fmt(esc(raw.slice(last)));
}

/** Minimal, safe markdown: escapes everything, then applies bold, code, links and lists. */
export function md(s: string): string {
  let out = "", list: string | null = null;
  for (const ln of s.split(/\n/)) {
    const m = ln.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (m) {
      const tag = /^\s*\d/.test(ln) ? "ol" : "ul";
      if (list !== tag) { if (list) out += `</${list}>`; out += `<${tag}>`; list = tag; }
      out += `<li>${inline(m[1])}</li>`; continue;
    }
    if (list) { out += `</${list}>`; list = null; }
    if (ln.trim()) out += `<p>${inline(ln.replace(/^#+\s*/, ""))}</p>`;
  }
  if (list) out += `</${list}>`;
  return out;
}

export type Source = { title: string; url: string };

// A "Sources:" heading on its own line (with or without markdown decoration)
const SOURCES_RE = /(^|\n)[ \t]*[*_#>]*[ \t]*sources?[ \t]*[*_]*[ \t]*[:：][*_]*[ \t]*/i;

/**
 * Splits a tutor answer into the teaching text and its "Sources:" list (`- Title — URL` lines).
 * Lines after the list that aren't sources (e.g. a closing question) stay with the answer.
 */
export function splitSources(text: string): { body: string; sources: Source[] } {
  const m = SOURCES_RE.exec(text);
  if (!m) return { body: text, sources: [] };
  const body = text.slice(0, m.index).trimEnd();
  const rest = text.slice(m.index + m[0].length);
  const sources: Source[] = [];
  const tail: string[] = [];
  const seen = new Set<string>();
  for (const line of rest.split(/\n/)) {
    if (!line.trim()) continue;
    const link = line.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
    const bare = line.match(/https?:\/\/[^\s<>()"']*[^\s<>()"'.,;:!?]/);
    const url = link?.[2] || bare?.[0];
    if (!url) {
      if (!/^\s*(?:[-*•]|\d+[.)])\s+/.test(line)) tail.push(line);
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    let title = link ? link[1] : line.replace(url, "");
    title = title
      .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
      .replace(/[*_`]/g, "")
      .replace(/[\s(<\[]*$/, "")
      .replace(/[\s—–:|-]+$/, "")
      .replace(/^[\s—–:|-]+/, "")
      .trim();
    sources.push({ title: title || hostOf(url), url });
  }
  return { body: tail.length ? `${body}\n\n${tail.join("\n")}` : body, sources };
}
