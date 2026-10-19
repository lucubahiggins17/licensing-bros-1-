// Small formatting helpers for the admin control center.

/** Cents → "$1,234" or "$1,234.50" (never "Free"; revenue can be $0). */
export function usd(cents: number | null | undefined): string {
  const c = Number(cents) || 0;
  return (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
}

export const num = (n: number | null | undefined) => (Number(n) || 0).toLocaleString("en-US");

export const plural = (n: number, one: string, many = one + "s") => `${num(n)} ${n === 1 ? one : many}`;

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "just now", "5 min ago", "3 hours ago", "in 2 days" */
export function relTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const diff = Date.now() - t;
  const future = diff < 0;
  const s = Math.abs(diff) / 1000;
  const say = (v: number, u: string) => (future ? `in ${v} ${u}${v === 1 ? "" : "s"}` : `${v} ${u}${v === 1 ? "" : "s"} ago`);
  if (s < 60) return future ? "in a moment" : "just now";
  if (s < 3600) return future ? `in ${Math.round(s / 60)} min` : `${Math.round(s / 60)} min ago`;
  if (s < 86400) return say(Math.round(s / 3600), "hour");
  if (s < 86400 * 30) return say(Math.round(s / 86400), "day");
  return fmtDate(iso);
}

/** ISO timestamp → value for <input type="datetime-local"> in the viewer's own time zone. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** <input type="datetime-local"> value (local time) → ISO string, or null if empty/invalid. */
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function slugify(s: string): string {
  return (s || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function timeZoneName(): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value || "your time";
  } catch { return "your time"; }
}

/** Turns any thrown value or Supabase error into plain words for the owner. */
export function errMsg(e: any, fallback = "Something went wrong. Try again."): string {
  if (e?.name === "AbortError") return "Stopped.";
  const m = String(e?.message || e?.error_description || e?.error || (typeof e === "string" ? e : "") || "");
  if (!m) return fallback;
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(m)) return "You're offline or the server didn't answer. Check your connection and try again.";
  if (/admins only|permission denied|row-level security|violates row-level/i.test(m)) return "Only admins can do that. Sign in with your admin account.";
  if (/duplicate key|23505/i.test(m)) return "That already exists. Use a different value.";
  if (/jwt|token is expired|invalid claim/i.test(m)) return "Your sign-in expired. Sign in again.";
  if (/not configured/i.test(m)) return "The site isn't connected to its database yet.";
  return m;
}

/** Await a Supabase query and throw its error, so callers can use try/catch. */
export async function q<T = any>(p: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}
