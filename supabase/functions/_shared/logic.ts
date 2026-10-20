// Pure helpers shared by the Licensing Bro's edge functions.
// No network, no database and no Deno.env here, so tests can import this file directly.

// ---------------------------------------------------------------------------------------------
// Settings shapes and defaults (mirror site_settings in supabase/schema.sql)
// ---------------------------------------------------------------------------------------------
export type Limits = { ai_daily: number; exam_max_questions: number; ai_exams: boolean; practice_sets: boolean };
export type LocationRules = {
  enforce: boolean;
  home_radius_miles: number;
  home_change_days: number;
  away_max_days: number;
  away_default_days: number;
  away_passes_per_90_days: number;
  session_timeout_seconds: number;
};

export const DEFAULT_FREE_LIMITS: Limits = { ai_daily: 5, exam_max_questions: 10, ai_exams: false, practice_sets: false };
export const DEFAULT_PAID_LIMITS: Limits = { ai_daily: 60, exam_max_questions: 50, ai_exams: true, practice_sets: true };
export const DEFAULT_RULES: LocationRules = {
  enforce: true,
  home_radius_miles: 100,
  home_change_days: 30,
  away_max_days: 30,
  away_default_days: 14,
  away_passes_per_90_days: 3,
  session_timeout_seconds: 120
};

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : d);
// deno-lint-ignore no-explicit-any
const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

export function normalizeLimits(v: unknown, d: Limits): Limits {
  const o = obj(v);
  return {
    ai_daily: num(o.ai_daily, d.ai_daily),
    exam_max_questions: num(o.exam_max_questions, d.exam_max_questions),
    ai_exams: bool(o.ai_exams, d.ai_exams),
    practice_sets: bool(o.practice_sets, d.practice_sets)
  };
}

export function normalizeRules(v: unknown): LocationRules {
  const o = obj(v);
  const d = DEFAULT_RULES;
  return {
    enforce: bool(o.enforce, d.enforce),
    home_radius_miles: num(o.home_radius_miles, d.home_radius_miles),
    home_change_days: num(o.home_change_days, d.home_change_days),
    away_max_days: num(o.away_max_days, d.away_max_days),
    away_default_days: num(o.away_default_days, d.away_default_days),
    away_passes_per_90_days: num(o.away_passes_per_90_days, d.away_passes_per_90_days),
    session_timeout_seconds: num(o.session_timeout_seconds, d.session_timeout_seconds)
  };
}

// ---------------------------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------------------------
export type TimeLike = Date | number | string;
export function toMs(t: TimeLike | null | undefined): number | null {
  if (t === null || t === undefined || t === "") return null;
  const ms = t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 86_400_000;

// ---------------------------------------------------------------------------------------------
// JWT payload + fresh email code (OTP) check
// ---------------------------------------------------------------------------------------------
export type AmrEntry = { method: string; timestamp?: number } | string;
// deno-lint-ignore no-explicit-any
export type JwtPayload = { sub?: string; email?: string; amr?: AmrEntry[]; iat?: number; exp?: number; [k: string]: any };

/** Decodes a JWT's payload without verifying it. Only use on tokens already checked by auth.getUser(). */
export function decodeJwtPayload(token: string): JwtPayload {
  const part = (token || "").split(".")[1];
  if (!part) return {};
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** True when the sign-in includes an email code (amr method "otp") verified within the last `minutes`. */
export function recentOtp(payload: JwtPayload | null | undefined, minutes: number, now: TimeLike = Date.now()): boolean {
  const amr = Array.isArray(payload?.amr) ? payload!.amr! : [];
  const nowMs = toMs(now) ?? Date.now();
  return amr.some((e) => {
    if (!e || typeof e !== "object" || e.method !== "otp") return false;
    const ts = Number(e.timestamp);
    if (!Number.isFinite(ts)) return false;
    const ms = ts < 1e12 ? ts * 1000 : ts; // Supabase stores seconds
    return ms <= nowMs + 60_000 && nowMs - ms <= minutes * 60_000;
  });
}

// ---------------------------------------------------------------------------------------------
// IP addresses and geolocation
// ---------------------------------------------------------------------------------------------
function cleanIp(raw: string | null | undefined): string | null {
  let ip = (raw || "").trim().replace(/^"|"$/g, "");
  if (!ip) return null;
  const bracket = ip.match(/^\[([0-9a-fA-F:.]+)\](?::\d+)?$/); // [::1]:443
  if (bracket) ip = bracket[1];
  const v4port = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/); // 1.2.3.4:5678
  if (v4port) ip = v4port[1];
  if (!/^[0-9a-fA-F:.]{2,45}$/.test(ip)) return null;
  return ip.toLowerCase();
}

/** The caller's public IP: first x-forwarded-for entry, then cf-connecting-ip, then x-real-ip. */
export function clientIp(req: { headers: Headers }): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = cleanIp(xff.split(",")[0]);
    if (first) return first;
  }
  return cleanIp(req.headers.get("cf-connecting-ip")) || cleanIp(req.headers.get("x-real-ip"));
}

/** Private, loopback, link-local and carrier-grade NAT addresses can't be geolocated. */
export function isPrivateIp(ip: string | null | undefined): boolean {
  if (!ip) return true;
  let a = ip.toLowerCase();
  const mapped = a.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) a = mapped[1];
  const v4 = a.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [o1, o2] = [Number(v4[1]), Number(v4[2])];
    return o1 === 10 || o1 === 127 || o1 === 0 || (o1 === 169 && o2 === 254) || (o1 === 172 && o2 >= 16 && o2 <= 31) ||
      (o1 === 192 && o2 === 168) || (o1 === 100 && o2 >= 64 && o2 <= 127) || o1 >= 224;
  }
  if (a === "::1" || a === "::") return true;
  return /^f[cd]/.test(a) || /^fe[89ab]/.test(a); // fc00::/7 unique local, fe80::/10 link-local
}

export type Geo = { city: string | null; region: string | null; country: string | null; lat: number; lon: number };
export type LatLon = { lat: number; lon: number };

/** Turns an ipinfo.io JSON reply into a Geo (null when it has no usable coordinates). */
export function parseIpinfo(j: unknown): Geo | null {
  const o = obj(j);
  if (o.bogon || typeof o.loc !== "string") return null;
  const [lat, lon] = o.loc.split(",").map((x: string) => Number(x));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return { city: s(o.city), region: s(o.region), country: s(o.country), lat, lon };
}

export const hasCoords = (p: { lat?: unknown; lon?: unknown } | null | undefined): p is LatLon =>
  !!p && typeof p.lat === "number" && typeof p.lon === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lon);

/** Great-circle distance in miles (haversine). */
export function milesBetween(a: LatLon, b: LatLon): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------------------------------------------------------------------------------------------
// Home location + Travel mode decision
// ---------------------------------------------------------------------------------------------
export type LocationRecord = {
  home_lat: number | null;
  home_lon: number | null;
  home_city: string | null;
  home_region: string | null;
  home_country?: string | null;
  home_set_at: string | null;
  away_lat: number | null;
  away_lon: number | null;
  away_city: string | null;
  away_region: string | null;
  away_until: string | null;
  away_history: string[] | null;
};

export type LocationState = "home" | "away" | "outside" | "unset" | "unknown";
/** Same shape as LocationInfo in lib/session.ts, plus `ok` (may this device play paid content). */
export type LocationInfo = {
  state: LocationState;
  ok: boolean;
  city: string | null;
  region: string | null;
  home_city: string | null;
  home_region: string | null;
  away_city: string | null;
  away_region: string | null;
  away_until: string | null;
  enforce: boolean;
  distance_miles: number | null;
  home_set_now?: boolean;
  can_change_home_after: string | null;
  away_passes_left: number;
};

/** Travel passes used in the last 90 days (timestamps), oldest first. */
export function recentAwayPasses(rec: Pick<LocationRecord, "away_history"> | null, now: TimeLike = Date.now()): number[] {
  const nowMs = toMs(now) ?? Date.now();
  return (rec?.away_history || [])
    .map((t) => toMs(t))
    .filter((ms): ms is number => ms !== null && nowMs - ms < 90 * DAY && ms <= nowMs + 60_000)
    .sort((a, b) => a - b);
}

export function awayPassesLeft(rec: Pick<LocationRecord, "away_history"> | null, rules: LocationRules, now: TimeLike = Date.now()): number {
  return Math.max(0, rules.away_passes_per_90_days - recentAwayPasses(rec, now).length);
}

/** When the next Travel pass frees up (null if one is available now). */
export function nextAwayPassAt(rec: Pick<LocationRecord, "away_history"> | null, rules: LocationRules, now: TimeLike = Date.now()): string | null {
  const used = recentAwayPasses(rec, now);
  if (used.length < rules.away_passes_per_90_days) return null;
  const freeing = used[used.length - rules.away_passes_per_90_days];
  return iso(freeing + 90 * DAY);
}

/** When the home location may next be moved (null = it can change now). */
export function canChangeHomeAfter(rec: Pick<LocationRecord, "home_set_at"> | null, rules: LocationRules, now: TimeLike = Date.now()): string | null {
  const setAt = toMs(rec?.home_set_at);
  if (setAt === null) return null;
  const after = setAt + rules.home_change_days * DAY;
  return after > (toMs(now) ?? Date.now()) ? iso(after) : null;
}

export const hasHome = (rec: LocationRecord | null | undefined): rec is LocationRecord =>
  !!rec && hasCoords({ lat: rec.home_lat, lon: rec.home_lon });

export function awayActive(rec: LocationRecord | null | undefined, now: TimeLike = Date.now()): boolean {
  const until = toMs(rec?.away_until);
  return until !== null && until > (toMs(now) ?? Date.now());
}

/**
 * Decides whether this device's location passes the home-area rule.
 * - no coordinates for the device → "unknown", allowed (fail open)
 * - no home yet → "unset", allowed (the first paid-content device sets it)
 * - within home radius → "home"; within radius of an active Travel mode location → "away"
 * - otherwise "outside" (blocked unless rules.enforce is false). Admins are always allowed.
 */
export function locationDecision(
  rec: LocationRecord | null | undefined,
  geo: Partial<Geo> | null | undefined,
  rules: LocationRules,
  now: TimeLike = Date.now(),
  opts: { admin?: boolean } = {}
): LocationInfo {
  const enforce = rules.enforce !== false && !opts.admin;
  const active = awayActive(rec, now);
  const info: LocationInfo = {
    state: "unknown",
    ok: true,
    city: geo?.city ?? null,
    region: geo?.region ?? null,
    home_city: rec?.home_city ?? null,
    home_region: rec?.home_region ?? null,
    away_city: active ? rec?.away_city ?? null : null,
    away_region: active ? rec?.away_region ?? null : null,
    away_until: active ? rec?.away_until ?? null : null,
    enforce,
    distance_miles: null,
    can_change_home_after: canChangeHomeAfter(rec ?? null, rules, now),
    away_passes_left: awayPassesLeft(rec ?? null, rules, now)
  };
  const here = geo && hasCoords(geo as LatLon) ? (geo as LatLon) : null;
  if (!here) return info; // unknown → fail open
  if (!hasHome(rec)) return { ...info, state: "unset" };
  const dHome = milesBetween(here, { lat: rec.home_lat!, lon: rec.home_lon! });
  info.distance_miles = Math.round(dHome);
  if (dHome <= rules.home_radius_miles) return { ...info, state: "home" };
  if (active && hasCoords({ lat: rec.away_lat, lon: rec.away_lon }) &&
      milesBetween(here, { lat: rec.away_lat!, lon: rec.away_lon! }) <= rules.home_radius_miles) {
    return { ...info, state: "away" };
  }
  return { ...info, state: "outside", ok: !enforce };
}

// ---------------------------------------------------------------------------------------------
// One device at a time
// ---------------------------------------------------------------------------------------------
export type SessionRow = {
  user_id?: string;
  session_id: string;
  device: string;
  ip?: string | null;
  city: string | null;
  region: string | null;
  country?: string | null;
  lat?: number | null;
  lon?: number | null;
  location_ok?: boolean;
  started_at?: string;
  last_seen: string;
};
export type Conflict = { device: string; city: string | null; region: string | null; last_seen: string };
export type ClaimDecision =
  | { action: "create" }
  | { action: "resume" }
  | { action: "replace_stale"; previous: Conflict }
  | { action: "takeover"; previous: Conflict }
  | { action: "conflict"; conflict: Conflict };

export const conflictOf = (row: SessionRow): Conflict => ({
  device: row.device || "another device",
  city: row.city ?? null,
  region: row.region ?? null,
  last_seen: row.last_seen
});

/** A session counts as active when its last heartbeat is within the timeout. */
export function isSessionActive(row: Pick<SessionRow, "last_seen"> | null | undefined, now: TimeLike, timeoutSec: number): boolean {
  const seen = toMs(row?.last_seen);
  if (seen === null) return false;
  return (toMs(now) ?? Date.now()) - seen <= timeoutSec * 1000;
}

/**
 * What a `claim` should do given the current row:
 * same session id → resume; no row → create; stale row → replace quietly;
 * active row on another device → conflict, or takeover when the user chose "Use it here instead".
 */
export function claimDecision(
  existing: SessionRow | null | undefined,
  requestSessionId: string | null | undefined,
  takeover: boolean,
  now: TimeLike,
  timeoutSec: number
): ClaimDecision {
  if (!existing) return { action: "create" };
  if (requestSessionId && existing.session_id === requestSessionId) return { action: "resume" };
  if (!isSessionActive(existing, now, timeoutSec)) return { action: "replace_stale", previous: conflictOf(existing) };
  if (takeover) return { action: "takeover", previous: conflictOf(existing) };
  return { action: "conflict", conflict: conflictOf(existing) };
}

export type SessionCheck<R = SessionRow> = { ok: true; row: R } | { ok: false; code: "no_session" | "session_replaced" };

/** Is the x-session-id this request sent the account's current device session? */
export function sessionCheck<R extends { session_id: string }>(row: R | null | undefined, sessionId: string | null | undefined): SessionCheck<R> {
  const sid = (sessionId || "").trim();
  if (!row || !sid) return { ok: false, code: "no_session" };
  if (row.session_id !== sid) return { ok: false, code: "session_replaced" };
  return { ok: true, row };
}

export const isUuid = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// ---------------------------------------------------------------------------------------------
// Lesson video URLs
// ---------------------------------------------------------------------------------------------
export type ParsedVideo =
  | { type: "youtube" | "vimeo" | "file"; url: string }
  | { type: "storage"; path: string }
  | null;

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set(["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"]);

/** "90", "90s", "1m30s", "1h2m3s" → seconds */
function startSeconds(t: string | null): number {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || !t) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

/**
 * Turns the stored lesson video link into something the player can use:
 * YouTube (watch, youtu.be, shorts, live, embed) → privacy-enhanced embed; Vimeo → player embed;
 * "storage:<path>" → a path in the course-media bucket (signed by the caller); http(s) → direct file.
 */
export function parseVideoUrl(raw: string | null | undefined): ParsedVideo {
  const s = (raw || "").trim();
  if (!s) return null;
  if (/^storage:/i.test(s)) {
    const path = s.slice(8).trim().replace(/^\/+/, "");
    return path ? { type: "storage", path } : null;
  }
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);

  // YouTube (any YouTube link without a valid video id gives no video rather than a broken "file")
  if (host === "youtu.be" || YT_HOSTS.has(host)) {
    let yt: string | null = null;
    if (host === "youtu.be") yt = parts[0] || null;
    else if (parts[0] === "watch") yt = u.searchParams.get("v");
    else if (["shorts", "live", "embed", "v", "e"].includes(parts[0])) yt = parts[1] || null;
    if (!yt || !YT_ID.test(yt)) return null;
    const start = startSeconds(u.searchParams.get("t") || u.searchParams.get("start"));
    return { type: "youtube", url: `https://www.youtube-nocookie.com/embed/${yt}${start > 0 ? `?start=${start}` : ""}` };
  }

  // Vimeo
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const idx = parts.findIndex((p) => /^\d{5,}$/.test(p));
    if (idx < 0) return null;
    const id = parts[idx];
    const next = parts[idx + 1];
    const hash = u.searchParams.get("h") || (next && /^[0-9a-f]{6,}$/i.test(next) ? next : null);
    return { type: "vimeo", url: `https://player.vimeo.com/video/${id}${hash ? `?h=${encodeURIComponent(hash)}` : ""}` };
  }

  return { type: "file", url: u.toString() };
}

// ---------------------------------------------------------------------------------------------
// Tutor: when to cross-check a state's own rule on the web, and how to list sources
// ---------------------------------------------------------------------------------------------
export const STATES = ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","District of Columbia","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"];

const STATE_SENSITIVE = new RegExp(
  "\\b(licen[cs]\\w*|board|liens?|notices?|bond\\w*|insurance|insured|workers'?\\s*comp\\w*|workman'?s\\s*comp\\w*|permit\\w*|" +
  "adopt\\w*|editions?|amend\\w*|states?|reciproc\\w*|exam\\s+requirements?|experience|continuing\\s+education|ce\\s+hours?)\\b",
  "i"
);
const STATE_NAMES = new RegExp(`\\b(${STATES.map((s) => s.replace(/ /g, "\\s+")).join("|")})\\b`, "i");

/** True when the answer may depend on the student's state, so the tutor should confirm it on official sites. */
export function needsStateCheck(question: string, facts: { state: string | null; status: string }[] = []): boolean {
  const q = question || "";
  if (STATE_SENSITIVE.test(q) || STATE_NAMES.test(q)) return true;
  return facts.some((f) => !!f.state || f.status === "unverified");
}

/**
 * Study-card and Q&A sites written by the public. Their answers are often wrong (the knowledge base audit found
 * 75 errors in popular flashcard sets), so the tutor never cites them.
 */
export const UNRELIABLE_DOMAINS = [
  "quizlet.com", "brainscape.com", "cram.com", "studystack.com", "chegg.com", "coursehero.com", "studocu.com",
  "brainly.com", "quora.com", "reddit.com", "answers.com", "scribd.com", "gauthmath.com", "numerade.com"
];

/** Anthropic server-side web search, localized to the student's state, skipping unreliable study sites. */
export function webSearchTool(state: string) {
  return {
    type: "web_search_20250305" as const,
    name: "web_search" as const,
    max_uses: 3,
    blocked_domains: UNRELIABLE_DOMAINS,
    user_location: { type: "approximate" as const, region: state, country: "US" }
  };
}

// ---------------------------------------------------------------------------------------------
// Tutor: which model answers (fast for quick lookups and voice, strongest for reasoning)
// ---------------------------------------------------------------------------------------------
const REASONING = /\b(calculat\w*|comput\w*|how\s+(many|much|big|far|long|deep|wide)|size|sizing|sized|load\s+calc\w*|voltage\s+drop|ampacity|derat\w*|box\s+fill|conduit\s+fill|fill|btu\w*|cfm|gpm|psi|tonnage|percent|%|ratio|formula|solve|work\s+out|step[\s-]by[\s-]step|explain|why|compare|difference|versus|vs\.?|scenario|walk\s+me\s+through|break\s+down)\b/i;
const MATHY = /\d+(\.\d+)?\s*(x|×|\*|\/|÷|\+|-)\s*\d|\d+(\.\d+)?\s*(v|volts?|amps?|a|w|watts?|kw|kva|hp|ft|feet|in|inches|sq\s*ft|cu\s*ft|yd|yards?|gal|gallons?|lbs?|btu|cfm|gpm|psi|%)\b/i;

export type TutorRoute = "fast" | "main";

/**
 * Quick definitions and lookups go to the fast model; calculations, explanations, photos, follow-ups that build on
 * a long conversation, and state-rule checks go to the strongest model. Voice uses the fast model unless the
 * question needs real reasoning, so Bro starts talking quickly.
 */
export function routeTutor(o: { question: string; voice?: boolean; image?: boolean; webSearch?: boolean; turns?: number }): TutorRoute {
  const q = (o.question || "").trim();
  if (o.image || o.webSearch) return "main";
  if (MATHY.test(q) || REASONING.test(q)) return "main";
  if ((o.turns || 1) > 6) return "main";
  if (o.voice) return "fast";
  const words = q.split(/\s+/).filter(Boolean).length;
  const sentences = q.split(/[.?!]+/).filter((s) => s.trim()).length;
  return words <= 22 && sentences <= 2 ? "fast" : "main";
}

// ---------------------------------------------------------------------------------------------
// Tutor: exact arithmetic. The model hands math to this calculator instead of doing it in its head.
// ---------------------------------------------------------------------------------------------
export const CALC_TOOL = {
  name: "calculate",
  description: "Exact calculator. Use it for every arithmetic step beyond the trivial (voltage drop, ampacity adjustments, box or conduit fill, load calcs, BTU/CFM/GPM, areas, volumes, slopes, percentages, offsets). Pass one expression per call. Supports + - * / ^ ( ), sqrt(), round(x, digits), ceil(), floor(), abs(), min(), max(), pi. Use plain numbers (no units or commas).",
  input_schema: {
    type: "object",
    properties: {
      expression: { type: "string", description: "e.g. (2 * 12.9 * 16 * 150) / 6530" },
      label: { type: "string", description: "What this computes, e.g. 'voltage drop in volts'" }
    },
    required: ["expression"]
  }
} as const;

const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, ceil: Math.ceil, floor: Math.floor,
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a),
  round: (x, d = 0) => { const f = 10 ** Math.max(0, Math.min(10, Math.trunc(d))); return Math.round((x + Number.EPSILON) * f) / f; }
};

/** Safely evaluates an arithmetic expression (no code execution). Throws a plain-words Error when it can't. */
export function evaluateExpression(input: string): number {
  const src = String(input || "").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").trim();
  if (!src) throw new Error("Empty expression");
  if (src.length > 300) throw new Error("Expression too long");
  const toks = src.match(/\d+(\.\d+)?(e[+-]?\d+)?|\.\d+|[a-z_]+|[-+*/^(),%]/gi);
  if (!toks || toks.join("") !== src.replace(/\s+/g, "")) throw new Error("Only numbers, + - * / ^ ( ) and sqrt, round, ceil, floor, abs, min, max, pi are allowed");
  let i = 0;
  const peek = () => toks[i];
  const take = (t?: string) => { const v = toks[i]; if (t && v !== t) throw new Error(`Expected "${t}"`); i++; return v; };
  function expr(): number { let v = term(); while (peek() === "+" || peek() === "-") v = take() === "+" ? v + term() : v - term(); return v; }
  function term(): number {
    let v = unary();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = take(), r = unary();
      if (op === "*") v *= r;
      else if (op === "%") v %= r;
      else { if (r === 0) throw new Error("Division by zero"); v /= r; }
    }
    return v;
  }
  // Unary minus binds looser than ^ (so -3^2 = -9), and exponents may be negative (2^-1 = 0.5)
  function unary(): number { if (peek() === "-") { take(); return -unary(); } if (peek() === "+") { take(); return unary(); } return power(); }
  function power(): number { const b = atom(); if (peek() === "^") { take(); return b ** unary(); } return b; }
  function atom(): number {
    const t = take();
    if (t === undefined) throw new Error("Unexpected end");
    if (t === "(") { const v = expr(); take(")"); return v; }
    if (/^(\d|\.)/.test(t)) return Number(t);
    const name = t.toLowerCase();
    if (name === "pi") return Math.PI;
    const fn = FUNCS[name];
    if (!fn) throw new Error(`Unknown name "${t}"`);
    take("(");
    const args = [expr()];
    while (peek() === ",") { take(); args.push(expr()); }
    take(")");
    return fn(...args);
  }
  const v = expr();
  if (i !== toks.length) throw new Error(`Unexpected "${toks[i]}"`);
  if (!Number.isFinite(v)) throw new Error("Result isn't a finite number");
  return v;
}

/** Runs the calculator for a tool call and returns the text handed back to the model. */
export function runCalculator(input: { expression?: unknown; label?: unknown }): { text: string; isError: boolean } {
  try {
    const v = evaluateExpression(String(input?.expression ?? ""));
    const exact = Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(12)));
    return { text: `${input?.label ? `${String(input.label).slice(0, 80)}: ` : ""}${exact}`, isError: false };
  } catch (e) {
    return { text: `Couldn't calculate: ${(e as Error).message}`, isError: true };
  }
}

export type Source = { title: string; url: string };

function normUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    return x.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

/**
 * Pulls web sources out of a finished Claude message: cited pages first (web_search_result_location
 * citations); if nothing was cited, the search results themselves. Deduped, at most `max`.
 */
// deno-lint-ignore no-explicit-any
export function collectSources(blocks: any[], max = 5): Source[] {
  const cited: Source[] = [];
  const found: Source[] = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (b?.type === "text" && Array.isArray(b.citations)) {
      for (const c of b.citations) {
        if (c?.type === "web_search_result_location" && typeof c.url === "string") cited.push({ title: c.title || c.url, url: c.url });
      }
    } else if (b?.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) {
        if (r?.type === "web_search_result" && typeof r.url === "string") found.push({ title: r.title || r.url, url: r.url });
      }
    }
  }
  return dedupeSources(cited.length ? cited : found, max);
}

export function dedupeSources(list: Source[], max = 5): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of list) {
    if (!/^https?:\/\//i.test(s.url)) continue;
    const k = normUrl(s.url);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ title: (s.title || s.url).replace(/\s+/g, " ").trim().slice(0, 140), url: s.url });
    if (out.length >= max) break;
  }
  return out;
}

export function formatSources(list: Source[]): string {
  if (!list.length) return "";
  return `\n\nSources:\n${list.map((s) => `- ${s.title} — ${s.url}`).join("\n")}`;
}

// ---------------------------------------------------------------------------------------------
// AI output validation
// ---------------------------------------------------------------------------------------------
export type PracticeQuestion = { t: string; topic: string; q: string; c: string[]; a: number; ref: string; why: string };
export type QuizItem = { q: string; c: string[]; a: number; why: string };

// deno-lint-ignore no-explicit-any
function choicesOf(x: any): string[] | null {
  const c = Array.isArray(x?.choices) ? x.choices : Array.isArray(x?.c) ? x.c : null;
  if (!c || c.length !== 4) return null;
  const out = c.map((v: unknown) => String(v ?? "").trim());
  return out.every((v: string) => v.length > 0) ? out : null;
}
// deno-lint-ignore no-explicit-any
function answerOf(x: any): number | null {
  const a = Number(x?.answer ?? x?.a);
  return Number.isInteger(a) && a >= 0 && a < 4 ? a : null;
}

/** Keeps well-formed multiple-choice questions; `t` is "law" for Business & Law items, else the trade. */
export function validateQuestions(arr: unknown, opts: { trade: string; part: string }): PracticeQuestion[] {
  const list = Array.isArray(arr) ? arr : [];
  const out: PracticeQuestion[] = [];
  for (const x of list) {
    const q = typeof x?.q === "string" ? x.q.trim() : "";
    const c = choicesOf(x);
    const a = answerOf(x);
    if (!q || !c || a === null) continue;
    const section = String(x.section ?? x.part ?? x.t ?? "").toLowerCase();
    const t = opts.part === "law" ? "law" : opts.part === "trade" ? opts.trade : section === "law" ? "law" : opts.trade;
    out.push({
      t,
      topic: String(x.topic || "General").slice(0, 40),
      q: q.slice(0, 800),
      c: c.map((v) => v.slice(0, 300)),
      a,
      ref: String(x.ref || "Verify in reference").slice(0, 80),
      why: String(x.why || "").slice(0, 600)
    });
  }
  return out;
}

/**
 * The server's secret Supabase key. Prefers the new SUPABASE_SECRET_KEYS ({"default": "sb_secret_..."}), which keeps
 * working after Supabase retires the legacy keys at the end of 2026, and falls back to SUPABASE_SERVICE_ROLE_KEY.
 */
export function pickServiceKey(secretKeysJson: string | undefined | null, legacy: string | undefined | null): string {
  if (secretKeysJson) {
    try {
      const o = JSON.parse(secretKeysJson);
      const k = o && typeof o === "object" ? (o.default ?? Object.values(o)[0]) : null;
      if (typeof k === "string" && k.trim()) return k.trim();
    } catch { /* fall back to the legacy key */ }
  }
  return (legacy || "").trim();
}

export type TermPair = { k: string; v: string };

/** Keeps well-formed term/meaning pairs: trims, drops blanks, repeats and avoided terms, caps lengths. */
export function validatePairs(arr: unknown, opts: { max: number; avoid?: string[]; kMax?: number; vMax?: number }): TermPair[] {
  const list = Array.isArray(arr) ? arr : [];
  const seen = new Set((opts.avoid || []).map((x) => String(x).trim().toLowerCase()));
  const out: TermPair[] = [];
  for (const x of list) {
    const k = String(x?.k ?? x?.term ?? "").replace(/\s+/g, " ").trim();
    const v = String(x?.v ?? x?.definition ?? x?.meaning ?? "").replace(/\s+/g, " ").trim();
    if (!k || !v || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push({ k: k.slice(0, opts.kMax ?? 40), v: v.slice(0, opts.vMax ?? 160) });
    if (out.length >= opts.max) break;
  }
  return out;
}

export function validateQuiz(arr: unknown, max = 5): QuizItem[] {
  const list = Array.isArray(arr) ? arr : [];
  const out: QuizItem[] = [];
  for (const x of list) {
    const q = typeof x?.q === "string" ? x.q.trim() : "";
    const c = choicesOf(x);
    const a = answerOf(x);
    if (!q || !c || a === null) continue;
    out.push({ q: q.slice(0, 600), c: c.map((v) => v.slice(0, 240)), a, why: String(x.why || "").slice(0, 500) });
    if (out.length >= max) break;
  }
  return out;
}

/** A same-site path for redirects ("/course/?id=1"); anything else falls back. Blocks "//evil.com". */
export function safePath(p: unknown, fallback: string): string {
  if (typeof p !== "string") return fallback;
  const s = p.trim();
  const hasControlOrSpace = /\s/.test(s) || [...s].some((ch) => ch.charCodeAt(0) < 32);
  if (!s.startsWith("/") || s.startsWith("//") || s.includes("\\") || s.length > 300 || hasControlOrSpace) return fallback;
  return s;
}

export function clampInt(v: unknown, min: number, max: number, d: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
}

// ---------------------------------------------------------------------------------------------
// Knowledge library: turning documents into searchable passages
// ---------------------------------------------------------------------------------------------
export type Passage = { seq: number; ref: string | null; text: string };

const HEADING = /^(#{1,6}\s+.+|(chapter|article|section|part|subpart|appendix|table|rule)\s+[\w.\-()]+.*|\d{1,4}(\.\d+)+(\([a-z0-9]+\))*\s+[A-Z][^.]{2,80}|[A-Z0-9][A-Z0-9 ,&'()\/.-]{3,80})$/i;

function isHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 100) return false;
  if (/[.;,:]$/.test(t) && !/^#/.test(t)) return false;
  if (/^#{1,6}\s/.test(t)) return true;
  if (/^(chapter|article|section|part|subpart|appendix|rule)\s+[\w.\-()]+/i.test(t)) return true;
  if (/^\d{1,4}(\.\d+)+(\([a-z0-9]+\))*\s+[A-Z]/.test(t) && t.split(/\s+/).length <= 14) return true;
  // ALL CAPS lines that look like titles
  return t === t.toUpperCase() && /[A-Z]{3}/.test(t) && t.split(/\s+/).length <= 12 && HEADING.test(t);
}

function sentences(p: string): string[] {
  return p.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.map((s) => s.trim()).filter(Boolean) || [p];
}

/**
 * Splits a document into passages of about `target` characters, on paragraph and sentence boundaries, never more
 * than `max`. Each passage remembers the nearest heading above it (used as its citation), and starts with the last
 * sentence of the passage before it so a rule split across two passages can still be found.
 */
export function chunkText(raw: string, o: { target?: number; max?: number; overlap?: boolean } = {}): Passage[] {
  const target = o.target ?? 1000, max = o.max ?? 3500, overlap = o.overlap ?? true;
  const text = String(raw || "").replace(/\r\n?/g, "\n").replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return [];
  const out: Passage[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  let bufHeading: string | null = null;
  let carry = "";
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) {
      const withCarry = carry && overlap ? `${carry} ${body}` : body;
      out.push({ seq: out.length, ref: bufHeading, text: withCarry.slice(0, max) });
      const last = sentences(body).pop() || "";
      carry = last.length <= 300 ? last : "";
    }
    buf = [];
  };
  const size = () => buf.reduce((n, s) => n + s.length + 1, 0);
  for (const block of text.split(/\n\s*\n|\n(?=#{1,6}\s)/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (isHeading(lines[0])) {
      flush();
      carry = "";
      heading = lines[0].replace(/^#{1,6}\s+/, "").slice(0, 140);
      lines.shift();
      if (!lines.length) { bufHeading = heading; continue; }
    }
    if (!buf.length) bufHeading = heading;
    const para = lines.join(" ");
    if (para.length > target * 1.5) {
      // A long paragraph: split by sentences
      for (const s of sentences(para)) {
        if (size() + s.length > target && buf.length) { flush(); bufHeading = heading; }
        buf.push(s.length > max ? s.slice(0, max) : s);
      }
      continue;
    }
    if (size() + para.length > target && buf.length) { flush(); bufHeading = heading; }
    buf.push(para);
  }
  flush();
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", deg: "°", sect: "§", frac12: "½", frac14: "¼", frac34: "¾", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", times: "×" };

/** Readable text from a web page: drops scripts, styles, menus and footers, keeps headings and paragraphs. */
export function htmlToText(html: string): { title: string; text: string } {
  const src = String(html || "");
  const title = (src.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
  let s = src
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(head|script|style|noscript|svg|nav|header|footer|form|iframe|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n, inner) => `\n\n${"#".repeat(Number(n))} ${inner.replace(/<[^>]+>/g, " ").trim()}\n\n`)
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|tr|table|ul|ol|blockquote|pre)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<(td|th)[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  s = s.replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  const text = s.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text };
}

// ---------------------------------------------------------------------------------------------
// Command center: how each student is doing, and who needs help
// ---------------------------------------------------------------------------------------------
export type StudentRow = {
  id: string; email: string | null; full_name: string | null; state: string | null; trade: string | null;
  created_at: string; last_sign_in_at: string | null; role?: string | null; paid: boolean; enrolled: number;
  // deno-lint-ignore no-explicit-any
  progress: any; progress_updated_at: string | null;
};
export type StudentSummary = {
  id: string; name: string; email: string; state: string; trade: string; paid: boolean; role: string;
  joined: string; last_active: string | null; days_inactive: number | null;
  answered: number; accuracy: number | null; mock_exams: number; last_mock: number | null;
  exam_date: string | null; days_to_exam: number | null;
  weakest: { topic: string; pct: number; attempts: number }[];
  risk: "high" | "medium" | "low" | "new";
  reasons: string[];
};

export function summarizeStudent(r: StudentRow, now = Date.now()): StudentSummary {
  const p = r.progress && typeof r.progress === "object" ? r.progress : {};
  const trade = String(p.trade || r.trade || "gc");
  const stats = (p.stats && typeof p.stats === "object" ? p.stats[trade] : null) || {};
  let c = 0, a = 0;
  const topics: { topic: string; pct: number; attempts: number }[] = [];
  for (const [topic, v] of Object.entries(stats as Record<string, { c?: number; a?: number }>)) {
    const tc = Number(v?.c) || 0, ta = Number(v?.a) || 0;
    c += tc; a += ta;
    if (ta >= 4) topics.push({ topic, pct: Math.round((tc / ta) * 100), attempts: ta });
  }
  topics.sort((x, y) => x.pct - y.pct || y.attempts - x.attempts);
  const hist = Array.isArray(p.hist) ? p.hist : [];
  const mocks = hist.filter((h: { kind?: string }) => h?.kind === "Mock exam");
  const lastMockDetail = mocks.length ? String(mocks.reduce((x: { at?: number }, y: { at?: number }) => ((y?.at || 0) > (x?.at || 0) ? y : x))?.detail || "") : "";
  const mockPct = lastMockDetail.match(/(\d{1,3})\s*%/);
  const days: string[] = Array.isArray(p.days) ? p.days.filter((d: unknown) => typeof d === "string") : [];
  const lastDay = days.length ? Math.max(...days.map((d) => new Date(`${d}T12:00:00Z`).getTime()).filter(Number.isFinite)) : 0;
  const lastHist = hist.length ? Math.max(...hist.map((h: { at?: number }) => Number(h?.at) || 0)) : 0;
  const candidates = [r.last_sign_in_at ? Date.parse(r.last_sign_in_at) : 0, r.progress_updated_at ? Date.parse(r.progress_updated_at) : 0, lastDay, lastHist].filter((x) => x > 0);
  const lastActive = candidates.length ? Math.max(...candidates) : 0;
  const examDate = typeof p.examDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.examDate) ? p.examDate : null;
  const daysToExam = examDate ? Math.ceil((Date.parse(`${examDate}T14:00:00Z`) - now) / DAY) : null;
  const daysInactive = lastActive ? Math.floor((now - lastActive) / DAY) : null;
  const accuracy = a ? Math.round((c / a) * 100) : null;
  const lastMock = mockPct ? Number(mockPct[1]) : null;
  const joinedDays = Math.floor((now - Date.parse(r.created_at)) / DAY);

  const reasons: string[] = [];
  let risk: StudentSummary["risk"] = "low";
  const soon = daysToExam !== null && daysToExam >= 0 && daysToExam <= 30;
  if (!a && !mocks.length) {
    risk = joinedDays >= 7 ? "medium" : "new";
    reasons.push(joinedDays >= 7 ? `hasn't started practicing (joined ${joinedDays} days ago)` : "just joined");
    if (soon) { risk = "high"; reasons.push(`exam in ${daysToExam} days`); }
  } else {
    if (soon && accuracy !== null && accuracy < 70) reasons.push(`${accuracy}% correct with the exam in ${daysToExam} days`);
    if (soon && a < 150) reasons.push(`only ${a} practice questions with the exam in ${daysToExam} days`);
    if (soon && lastMock !== null && lastMock < 70) reasons.push(`last mock exam ${lastMock}%`);
    if (reasons.length) risk = "high";
    if (daysInactive !== null && daysInactive >= 10 && (r.paid || (daysToExam !== null && daysToExam >= 0 && daysToExam <= 60))) {
      reasons.push(`inactive for ${daysInactive} days`);
      risk = risk === "high" || (daysToExam !== null && daysToExam >= 0 && daysToExam <= 30) ? "high" : "medium";
    }
    if (risk === "low" && accuracy !== null && accuracy < 65 && a >= 50) { risk = "medium"; reasons.push(`${accuracy}% correct overall`); }
    if (risk === "low" && topics.length && topics[0].pct < 55) reasons.push(`weak on ${topics[0].topic} (${topics[0].pct}%)`);
  }
  return {
    id: r.id, name: (r.full_name || "").trim() || (r.email || "").split("@")[0] || "Student", email: r.email || "", state: String(p.state || r.state || ""),
    trade, paid: !!r.paid, role: r.role || "student", joined: r.created_at, last_active: lastActive ? new Date(lastActive).toISOString() : null,
    days_inactive: daysInactive, answered: a, accuracy, mock_exams: mocks.length, last_mock: lastMock, exam_date: examDate, days_to_exam: daysToExam,
    weakest: topics.slice(0, 3), risk, reasons
  };
}

export type Segment = "all" | "at_risk" | "inactive" | "exam_soon" | "paid" | "free" | "new" | "top";

/** Students in a segment, most urgent first. Staff accounts are left out. */
export function segmentStudents(rows: StudentSummary[], segment: Segment, o: { trade?: string; state?: string; search?: string } = {}): StudentSummary[] {
  const q = (o.search || "").trim().toLowerCase();
  let list = rows.filter((s) => s.role === "student"
    && (!o.trade || s.trade === o.trade) && (!o.state || s.state === o.state)
    && (!q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)));
  const rank = { high: 0, medium: 1, new: 2, low: 3 } as const;
  switch (segment) {
    case "at_risk": list = list.filter((s) => s.risk === "high" || s.risk === "medium").sort((x, y) => rank[x.risk] - rank[y.risk] || (x.days_to_exam ?? 999) - (y.days_to_exam ?? 999)); break;
    case "inactive": list = list.filter((s) => s.days_inactive === null || s.days_inactive >= 7).sort((x, y) => (y.days_inactive ?? 9999) - (x.days_inactive ?? 9999)); break;
    case "exam_soon": list = list.filter((s) => s.days_to_exam !== null && s.days_to_exam >= 0 && s.days_to_exam <= 30).sort((x, y) => (x.days_to_exam ?? 0) - (y.days_to_exam ?? 0)); break;
    case "paid": list = list.filter((s) => s.paid); break;
    case "free": list = list.filter((s) => !s.paid); break;
    case "new": list = list.filter((s) => Date.now() - Date.parse(s.joined) <= 7 * DAY).sort((x, y) => Date.parse(y.joined) - Date.parse(x.joined)); break;
    case "top": list = list.filter((s) => s.accuracy !== null && s.answered >= 30).sort((x, y) => (y.accuracy ?? 0) - (x.accuracy ?? 0)); break;
  }
  return list;
}

// deno-lint-ignore no-explicit-any
type Msg = { role: "user" | "assistant"; content: any[] };

/**
 * The command center's conversation as the client sends it back: only text, tool calls and tool results survive,
 * the oldest turns are dropped to stay under the size limit, old tool results are shortened, and every tool call
 * keeps its result (the API rejects a call without one).
 */
export function cleanHistory(raw: unknown, o: { maxMessages?: number; maxChars?: number } = {}): Msg[] {
  const maxMessages = o.maxMessages ?? 40, maxChars = o.maxChars ?? 120_000;
  const out: Msg[] = [];
  for (const m of Array.isArray(raw) ? raw : []) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : Array.isArray(m.content) ? m.content : [];
    // deno-lint-ignore no-explicit-any
    const clean: any[] = [];
    for (const b of blocks) {
      if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) clean.push({ type: "text", text: b.text.slice(0, 8000) });
      else if (m.role === "assistant" && b?.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") clean.push({ type: "tool_use", id: b.id.slice(0, 100), name: b.name.slice(0, 60), input: b.input && typeof b.input === "object" ? b.input : {} });
      else if (m.role === "user" && b?.type === "tool_result" && typeof b.tool_use_id === "string") clean.push({ type: "tool_result", tool_use_id: b.tool_use_id.slice(0, 100), content: typeof b.content === "string" ? b.content.slice(0, 12000) : JSON.stringify(b.content ?? "").slice(0, 12000), ...(b.is_error ? { is_error: true } : {}) });
    }
    if (!clean.length) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content.push(...clean); // merge same-role turns
    else out.push({ role: m.role, content: clean });
  }
  // Every tool_use must be answered in the very next user turn; drop unanswered calls (and orphan results)
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    if (m.role !== "assistant") continue;
    const next = out[i + 1];
    const answered = new Set((next?.role === "user" ? next.content : []).filter((b) => b.type === "tool_result").map((b) => b.tool_use_id));
    m.content = m.content.filter((b) => b.type !== "tool_use" || answered.has(b.id));
  }
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    if (m.role !== "user") continue;
    const prev = out[i - 1];
    const asked = new Set((prev?.role === "assistant" ? prev.content : []).filter((b) => b.type === "tool_use").map((b) => b.id));
    m.content = m.content.filter((b) => b.type !== "tool_result" || asked.has(b.tool_use_id));
  }
  let list = out.filter((m) => m.content.length);
  // Re-merge in case filtering left two turns from the same side next to each other
  list = list.reduce<Msg[]>((acc, m) => { const p = acc[acc.length - 1]; if (p && p.role === m.role) p.content.push(...m.content); else acc.push(m); return acc; }, []);
  // Shorten tool results except in the last few turns
  list.forEach((m, i) => { if (i < list.length - 4) for (const b of m.content) if (b.type === "tool_result" && b.content.length > 1500) b.content = b.content.slice(0, 1500) + " …(shortened)"; });
  // Size limits: drop from the front, then make sure it starts with a plain user message
  const size = () => JSON.stringify(list).length;
  while (list.length > maxMessages || (list.length > 1 && size() > maxChars)) list.shift();
  while (list.length && (list[0].role !== "user" || list[0].content.some((b) => b.type === "tool_result"))) list.shift();
  return list;
}

// ---------------------------------------------------------------------------------------------
// Automations: when each job is due, and the study nudges students get
// ---------------------------------------------------------------------------------------------
export type AutomationKind = "weekly_digest" | "at_risk_alert" | "inactive_nudge" | "exam_countdown" | "new_signup_alert" | "knowledge_research";

export function localParts(at: number, tz: string): { ymd: string; weekday: number; hour: number } {
  let zone = tz;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); } catch { zone = "America/Chicago"; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" })
    .formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { ymd: `${parts.year}-${parts.month}-${parts.day}`, weekday, hour: Number(parts.hour) % 24 };
}

/**
 * Whether an automation should run now: weekly and daily jobs once per local day after their hour; signup alerts
 * hourly; the research desk every few hours (`every_hours`, default 6).
 */
export function isDue(kind: AutomationKind, config: { weekday?: number; hour?: number; tz?: string; every_hours?: number }, lastRunAt: string | null, now = Date.now()): boolean {
  const tz = config.tz || "America/Chicago";
  const last = lastRunAt ? Date.parse(lastRunAt) : 0;
  if (kind === "new_signup_alert") return !last || now - last >= 55 * 60_000;
  if (kind === "knowledge_research") {
    const every = Math.max(1, Math.min(48, Number(config.every_hours) || 6));
    return !last || now - last >= every * 3600_000 - 5 * 60_000;
  }
  const here = localParts(now, tz);
  const hour = Number.isFinite(Number(config.hour)) ? Number(config.hour) : 8;
  if (here.hour < hour) return false;
  if (kind === "weekly_digest" && here.weekday !== (Number.isFinite(Number(config.weekday)) ? Number(config.weekday) : 1)) return false;
  return !last || localParts(last, tz).ymd !== here.ymd;
}

/** The exam countdown message for a student, or null when today isn't a countdown day. */
export function countdownNote(days: number | null, weakest?: string): { title: string; body: string; link: string } | null {
  switch (days) {
    case 14: return { title: "Two weeks to your exam", body: "Take a full-length mock exam this week to see where you stand. Your missed questions go straight into Smart Review.", link: "/learn/#exam" };
    case 7: return { title: "One week to go", body: weakest ? `Spend 20 minutes a day on ${weakest}, your toughest topic right now, then take one more mock exam.` : "Spend 20 minutes a day on your weakest topic, then take one more mock exam.", link: "/learn/#review" };
    case 3: return { title: "3 days out", body: "Tab your code books where the tables are, and clear your Smart Review list. Know where answers live, not just the answers.", link: "/learn/#review" };
    case 1: return { title: "Exam tomorrow. You've got this.", body: "Light review only. Sleep well, bring your ID and your allowed books, and read every answer choice before you pick.", link: "/learn/" };
    default: return null;
  }
}

/** A friendly nudge for a student who's gone quiet. */
export function nudgeNote(s: { name: string; days_to_exam: number | null; weakest: { topic: string }[]; days_inactive: number | null }): { title: string; body: string; link: string } {
  const first = s.name.split(/\s+/)[0] || "there";
  const topic = s.weakest[0]?.topic;
  const exam = s.days_to_exam !== null && s.days_to_exam >= 0 ? `Your exam is in ${s.days_to_exam} day${s.days_to_exam === 1 ? "" : "s"}. ` : "";
  return {
    title: s.days_to_exam !== null && s.days_to_exam >= 0 && s.days_to_exam <= 30 ? `${first}, ${s.days_to_exam} days to go: 10 minutes today?` : `${first}, pick up where you left off`,
    body: `${exam}A quick 10-question Smart Review${topic ? ` on ${topic}` : ""} keeps it fresh.`,
    link: "/learn/#review"
  };
}

/** The letter a model picked in a multiple-choice answer ("ANSWER: C" on the last line), as an index 0-3. */
export function pickFromAnswer(text: string): number | null {
  const m = [...String(text || "").matchAll(/ANSWER\s*[:\-]\s*\(?([A-D])\)?/gi)].pop();
  if (m) return "ABCD".indexOf(m[1].toUpperCase());
  const tail = String(text || "").trim().slice(-40).match(/\b([A-D])[.)]?\s*$/);
  return tail ? "ABCD".indexOf(tail[1]) : null;
}

/**
 * One line describing a failed AI call, for logs and for staff ("404 not_found_error: model: claude-x").
 * Works with the Anthropic SDK's errors (status + error body) and plain errors.
 */
// deno-lint-ignore no-explicit-any
export function describeAiError(e: any): string {
  const status = Number(e?.status) || 0;
  const body = e?.error?.error || e?.error || {};
  const type = typeof body?.type === "string" && body.type !== "error" ? body.type : (e?.name && e.name !== "Error" ? e.name : "");
  const msg = String(body?.message || e?.message || "unknown error").replace(/\s+/g, " ").trim().slice(0, 220);
  return `${status ? `${status} ` : ""}${type ? `${type}: ` : ""}${msg}`;
}

/** Whether a failed AI call is worth retrying after a short pause (busy, overloaded, rate limited, network). */
// deno-lint-ignore no-explicit-any
export const retryableAiError = (e: any) => [408, 409, 429, 500, 502, 503, 504, 529].includes(Number(e?.status)) || /network|timeout|socket|ECONNRESET|terminated/i.test(String(e?.message || ""));
