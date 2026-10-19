"use client";
// Shared data helpers for the Courses area (catalog, course, lesson, certificate pages).
import { useSearchParams } from "next/navigation";
import { Zap, Droplets, Wind, Hammer, Layers, type LucideIcon } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { routes } from "@/lib/nav";
import { money, TRADE_LABELS } from "@/lib/types";
import type { Course, Lesson, LessonProgress, Module, Trade, TradeOrAll } from "@/lib/types";

/**
 * Reads a query-string value and follows client-side navigations (lesson → next lesson keeps the
 * same page mounted, which `popstate` alone doesn't catch). Pages using it wrap their content in <Suspense>.
 */
export function useParam(name: string): string | null {
  const sp = useSearchParams();
  return sp ? sp.get(name) : null;
}

// ---------------------------------------------------------------------------------------
// Trades and states
// ---------------------------------------------------------------------------------------
export const TRADE_META: Record<TradeOrAll, { label: string; short: string; Icon: LucideIcon }> = {
  elec: { label: TRADE_LABELS.elec, short: "Electrical", Icon: Zap },
  plumb: { label: TRADE_LABELS.plumb, short: "Plumbing", Icon: Droplets },
  hvac: { label: TRADE_LABELS.hvac, short: "HVAC", Icon: Wind },
  gc: { label: TRADE_LABELS.gc, short: "General", Icon: Hammer },
  all: { label: TRADE_LABELS.all, short: "All trades", Icon: Layers }
};
/** Order of the trade tiles on the catalog */
export const TILE_TRADES: Trade[] = ["elec", "plumb", "hvac", "gc"];
export const isTrade = (t: string | null | undefined): t is Trade => t === "gc" || t === "elec" || t === "plumb" || t === "hvac";

export const STATE_ABBR: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE",
  "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
  "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR",
  Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
  Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY"
};

/** True when the course is sold in this state (empty list = every state). Accepts full names or 2-letter codes. */
export function coversState(courseStates: string[] | null | undefined, state: string | null | undefined): boolean {
  if (!state) return true;
  const list = (courseStates || []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  const full = state.trim().toLowerCase();
  const abbr = (STATE_ABBR[state] || "").toLowerCase();
  return list.includes(full) || (!!abbr && list.includes(abbr));
}

export function courseMatches(c: Course, state: string | null, trade: string | null): boolean {
  const tradeOk = !trade || c.trade === trade || c.trade === "all";
  return tradeOk && coversState(c.states, state);
}

/** "All 50 states + DC", "Tennessee", "TN, GA, AL" or "12 states" */
export function statesLabel(states: string[] | null | undefined): string {
  const list = (states || []).filter(Boolean);
  if (!list.length) return "All 50 states + DC";
  if (list.length === 1) return list[0];
  if (list.length <= 4) return list.map((s) => STATE_ABBR[s] || s).join(", ");
  return `${list.length} states`;
}

// ---------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------
/** Free means `is_free` (that's what the lesson function checks). A $0 price without is_free isn't for sale yet. */
export const isFreeCourse = (c: Pick<Course, "is_free" | "price_cents">) => !!c.is_free;
export const priceLabel = (c: Pick<Course, "is_free" | "price_cents">) =>
  c.is_free ? "Free" : c.price_cents > 0 ? money(c.price_cents) : "Price coming soon";

export function hoursLabel(h: number | null | undefined): string | null {
  if (h == null || !Number(h)) return null;
  const n = Number(h);
  const v = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
  return `${v} ${n === 1 ? "hr" : "hrs"}`;
}

export function minutesLabel(min: number | null | undefined): string | null {
  if (!min || min <= 0) return null;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/** Splits a title for the two-tone headline: "Tennessee Electrical | Exam Prep". */
export function splitTitle(title: string): [string, string] {
  const t = (title || "").trim();
  const sep = /\s*(?::|\s[—–-]\s)\s*/.exec(t);
  if (sep && sep.index > 0 && sep.index < t.length - sep[0].length) return [t.slice(0, sep.index), t.slice(sep.index + sep[0].length)];
  const words = t.split(/\s+/);
  if (words.length < 3) return [t, ""];
  const cut = Math.ceil(words.length * 0.55);
  return [words.slice(0, cut).join(" "), words.slice(cut).join(" ")];
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** A safe "next" path for the login page (keeps the user on this page after signing in). */
export function hereWith(extra?: Record<string, string>): string {
  if (typeof window === "undefined") return "/";
  const u = new URL(window.location.href);
  Object.entries(extra || {}).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.pathname + u.search;
}

/** The public website origin (the Android app runs on a local origin, so prefer SITE_URL there). */
export function publicOrigin(siteUrl: string): string {
  if (siteUrl) return siteUrl;
  if (typeof window !== "undefined" && /^https?:/.test(window.location.origin)) return window.location.origin;
  return "";
}

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
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------
export type CatalogCourse = Course & { lessonCount: number; previewCount: number };

/** Published courses (RLS) with lesson counts. Admins also get drafts. */
export async function fetchCatalog(): Promise<CatalogCourse[]> {
  const { data, error } = await supabase()
    .from("courses")
    .select("*, lessons(is_preview)")
    .order("sort", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => {
    const lessons: { is_preview: boolean }[] = Array.isArray(row.lessons) ? row.lessons : [];
    const { lessons: _drop, ...course } = row;
    return { ...(course as Course), lessonCount: lessons.length, previewCount: lessons.filter((l) => l.is_preview).length };
  });
}

export async function fetchCourse(idOrSlug: string): Promise<Course | null> {
  const q = supabase().from("courses").select("*");
  const { data, error } = await (isUuid(idOrSlug) ? q.eq("id", idOrSlug) : q.eq("slug", idOrSlug)).maybeSingle();
  if (error) throw error;
  return (data as Course) || null;
}

export type LessonGroup = { id: string; title: string | null; lessons: Lesson[] };
export type Outline = { course: Course; modules: Module[]; lessons: Lesson[]; groups: LessonGroup[]; flat: Lesson[] };

/** Modules in order, each with its lessons in order. Lessons without a module come last. */
export function groupLessons(modules: Module[], lessons: Lesson[]): { groups: LessonGroup[]; flat: Lesson[] } {
  const byLesson = (a: Lesson, b: Lesson) => a.sort - b.sort || a.created_at.localeCompare(b.created_at);
  const mods = [...modules].sort((a, b) => a.sort - b.sort);
  const known = new Set(mods.map((m) => m.id));
  const groups: LessonGroup[] = mods
    .map((m) => ({ id: m.id, title: m.title, lessons: lessons.filter((l) => l.module_id === m.id).sort(byLesson) }))
    .filter((g) => g.lessons.length);
  const loose = lessons.filter((l) => !l.module_id || !known.has(l.module_id)).sort(byLesson);
  if (loose.length) groups.push({ id: "loose", title: groups.length ? "More lessons" : null, lessons: loose });
  return { groups, flat: groups.flatMap((g) => g.lessons) };
}

const outlineCache = new Map<string, Promise<Outline | null>>();
const lessonCourse = new Map<string, string>();

/** Which course a lesson belongs to (from a loaded outline when possible). */
export async function courseIdForLesson(lessonId: string): Promise<string | null> {
  if (!isUuid(lessonId)) return null;
  const known = lessonCourse.get(lessonId);
  if (known) return known;
  const { data, error } = await supabase().from("lessons").select("course_id").eq("id", lessonId).maybeSingle();
  if (error) throw error;
  return (data as { course_id: string } | null)?.course_id ?? null;
}

/** Course + modules + lessons. Cached per course so moving between lessons is instant. */
export function fetchOutline(courseId: string, force = false): Promise<Outline | null> {
  if (!force && outlineCache.has(courseId)) return outlineCache.get(courseId) as Promise<Outline | null>;
  const p = (async () => {
    const sb = supabase();
    const [course, mods, les] = await Promise.all([
      fetchCourse(courseId),
      sb.from("modules").select("*").eq("course_id", courseId),
      sb.from("lessons").select("*").eq("course_id", courseId)
    ]);
    if (mods.error) throw mods.error;
    if (les.error) throw les.error;
    if (!course) return null;
    const modules = (mods.data || []) as Module[];
    const lessons = (les.data || []) as Lesson[];
    lessons.forEach((l) => lessonCourse.set(l.id, l.course_id));
    return { course, modules, lessons, ...groupLessons(modules, lessons) };
  })();
  outlineCache.set(courseId, p);
  p.catch(() => outlineCache.delete(courseId));
  return p;
}

export type ProgressRow = Pick<LessonProgress, "lesson_id" | "completed" | "position_sec" | "notes">;
export type ProgressMap = Record<string, ProgressRow>;

export async function fetchProgress(userId: string, courseId: string): Promise<ProgressMap> {
  const { data, error } = await supabase()
    .from("lesson_progress")
    .select("lesson_id,completed,position_sec,notes")
    .eq("user_id", userId)
    .eq("course_id", courseId);
  if (error) throw error;
  return Object.fromEntries((data || []).map((r: any) => [r.lesson_id, r as ProgressRow]));
}

/** Upsert only the given columns (merge), so saving notes never resets "completed" and vice versa. */
export async function saveProgress(userId: string, lesson: Pick<Lesson, "id" | "course_id">, patch: Partial<Pick<LessonProgress, "completed" | "position_sec" | "notes">>) {
  const { error } = await supabase()
    .from("lesson_progress")
    .upsert({ user_id: userId, lesson_id: lesson.id, course_id: lesson.course_id, ...patch, updated_at: new Date().toISOString() }, { onConflict: "user_id,lesson_id" });
  if (error) throw error;
}

export function completedCount(flat: Lesson[], progress: ProgressMap): number {
  return flat.reduce((n, l) => n + (progress[l.id]?.completed ? 1 : 0), 0);
}

/** First lesson not yet completed (or the first lesson when everything is done or nothing started). */
export function nextLessonFor(flat: Lesson[], progress: ProgressMap): Lesson | null {
  return flat.find((l) => !progress[l.id]?.completed) || flat[0] || null;
}

export const coursePathWith = (id: string, extra = "") => routes.course(id) + extra;
