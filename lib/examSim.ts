// Exam-day simulation: picking questions the way a real exam spreads them across topics, the exam format
// (questions, time limit, passing score; from the school's verified formats or the student's own bulletin),
// saving an exam in progress so a refresh or a closed app doesn't lose it, and the pacing report.
import type { Question, TradeKey } from "@/lib/data";

export type Section = "trade" | "law" | "mix";
/** An exam format an instructor verified from the testing company's candidate bulletin. */
export type ExamFormat = { id: string; name: string; trade: TradeKey | "all"; state: string | null; part: Section; questions: number; minutes: number; pass_pct: number; notes?: string };
export type ExamSetup = { name: string; questions: number; minutes: number; passPct: number; verified: boolean; notes?: string };

/** Typical open-book pace when no verified format exists: about 2.4 minutes a question, rounded to 5 minutes. */
export const DEFAULT_PACE_SECS = 144;
export const defaultMinutes = (n: number) => Math.max(5, Math.round((n * DEFAULT_PACE_SECS) / 60 / 5) * 5);

/** The school's verified format for this trade, state and section: the student's state first, then national. */
export function formatFor(formats: ExamFormat[] | undefined, trade: string, state: string, part: Section): ExamFormat | null {
  const list = (formats || []).filter((f) => f && f.questions > 0 && f.minutes > 0 && (f.trade === trade || f.trade === "all") && f.part === part);
  return list.find((f) => f.state === state && f.trade === trade) || list.find((f) => f.state === state) || list.find((f) => !f.state && f.trade === trade) || list.find((f) => !f.state) || null;
}

/** Validates admin-entered formats (site setting "exam_formats"). */
// deno-lint-ignore no-explicit-any
export function cleanFormats(raw: any): ExamFormat[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((f, i) => ({
    id: String(f?.id || `f${i}`),
    name: String(f?.name || "").slice(0, 80),
    trade: (["gc", "elec", "plumb", "hvac", "all"].includes(f?.trade) ? f.trade : "all") as ExamFormat["trade"],
    state: typeof f?.state === "string" && f.state ? f.state : null,
    part: (["trade", "law", "mix"].includes(f?.part) ? f.part : "trade") as Section,
    questions: Math.max(5, Math.min(250, Math.round(Number(f?.questions) || 0))),
    minutes: Math.max(5, Math.min(600, Math.round(Number(f?.minutes) || 0))),
    pass_pct: Math.max(50, Math.min(100, Math.round(Number(f?.pass_pct) || 70))),
    notes: typeof f?.notes === "string" ? f.notes.slice(0, 300) : undefined
  })).filter((f) => f.name && Number(f.questions) > 0);
}

const shuffled = <T,>(a: T[]): T[] => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Picks `n` questions spread across topics in proportion to how much of the bank each topic is (like an exam
 * outline), never the same question twice, then shuffles them. Every topic with questions gets at least one
 * when there's room.
 */
export function examPick(pool: Question[], n: number): Question[] {
  const seen = new Set<string>();
  const unique = pool.filter((q) => { const k = norm(q.q); if (seen.has(k)) return false; seen.add(k); return true; });
  if (unique.length <= n) return shuffled(unique);
  const byTopic = new Map<string, Question[]>();
  for (const q of shuffled(unique)) { const l = byTopic.get(q.topic) || []; l.push(q); byTopic.set(q.topic, l); }
  const topics = shuffled([...byTopic.keys()]);
  const quota = new Map<string, number>(topics.map((t) => [t, 0]));
  if (topics.length >= n) {
    // More topics than questions: one question from each of n different topics
    topics.slice(0, n).forEach((t) => quota.set(t, 1));
  } else {
    // One from every topic, then the rest in proportion to topic size (largest remainder), within what each has
    topics.forEach((t) => quota.set(t, 1));
    let left = n - topics.length;
    const extra = unique.length - topics.length;
    const share = topics.map((t) => ({ t, exact: extra > 0 ? ((byTopic.get(t)!.length - 1) / extra) * left : 0 }));
    for (const x of share) {
      const add = Math.min(byTopic.get(x.t)!.length - 1, Math.floor(x.exact));
      quota.set(x.t, quota.get(x.t)! + add); left -= add;
    }
    const order = share.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)));
    for (let k = 0; left > 0 && k < order.length * 50; k++) {
      const t = order[k % order.length].t;
      if (quota.get(t)! < byTopic.get(t)!.length) { quota.set(t, quota.get(t)! + 1); left--; }
    }
  }
  const out: Question[] = [];
  for (const t of topics) out.push(...byTopic.get(t)!.slice(0, quota.get(t)));
  return shuffled(out).slice(0, n);
}

// ---------------------------------------------------------------------------------------------
// An exam in progress, saved on the device. The clock keeps running while the app is closed, like test day.
// ---------------------------------------------------------------------------------------------
export type SimRun = {
  v: 1;
  qs: Question[];
  ans: (number | null)[];
  flags: boolean[];
  struck: number[][];
  spent: number[];
  i: number;
  /** When the clock started (ms); null until the candidate starts after the tutorial */
  t0: number | null;
  /** Seconds allowed; 0 = untimed */
  limit: number;
  passPct: number;
  name: string;
  verified: boolean;
  src: "bank" | "sets" | "ai";
  label: string;
  leaves: number;
};
const KEY = "lb.exam.run.v1";

export function saveRun(r: SimRun | null) {
  try { r ? localStorage.setItem(KEY, JSON.stringify(r)) : localStorage.removeItem(KEY); } catch { /* storage full or blocked */ }
}
export function loadRun(now = Date.now()): SimRun | null {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || "null") as SimRun | null;
    if (!r || r.v !== 1 || !Array.isArray(r.qs) || !r.qs.length || r.ans?.length !== r.qs.length) return null;
    // Abandoned long ago (two hours past the time limit, or a day for untimed): drop it
    if (r.t0 && now - r.t0 > (r.limit ? r.limit * 1000 + 2 * 3600e3 : 24 * 3600e3)) { saveRun(null); return null; }
    return r;
  } catch { return null; }
}

export const timeLeft = (r: Pick<SimRun, "t0" | "limit">, now = Date.now()) =>
  !r.limit ? Infinity : r.t0 === null ? r.limit : Math.max(0, r.limit - Math.floor((now - r.t0) / 1000));

/** Warnings like a testing center's: 30, 10, 5 and 1 minute(s) left. Returns the one just crossed, if any. */
export function warningCrossed(prevLeft: number, left: number): number | null {
  for (const m of [30, 10, 5, 1]) if (prevLeft > m * 60 && left <= m * 60) return m;
  return null;
}

export type Pace = { avg: number; allowed: number; slowest: { topic: string; avg: number }[]; unanswered: number; flaggedLeft: number };
/** How the candidate used their time: seconds per question against the allowed pace, and the slowest topics. */
export function paceReport(r: Pick<SimRun, "qs" | "ans" | "flags" | "spent" | "limit">): Pace {
  const n = r.qs.length || 1;
  const total = r.spent.reduce((a, b) => a + (b || 0), 0);
  const by = new Map<string, { s: number; n: number }>();
  r.qs.forEach((q, i) => { const t = by.get(q.topic) || { s: 0, n: 0 }; t.s += r.spent[i] || 0; t.n++; by.set(q.topic, t); });
  return {
    avg: Math.round(total / n),
    allowed: r.limit ? Math.round(r.limit / n) : 0,
    slowest: [...by].map(([topic, v]) => ({ topic, avg: Math.round(v.s / v.n) })).sort((a, b) => b.avg - a.avg).slice(0, 3),
    unanswered: r.ans.filter((a) => a === null).length,
    flaggedLeft: r.flags.filter(Boolean).length
  };
}

export const fmtClock = (secs: number) => {
  if (!Number.isFinite(secs)) return "--:--";
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};
