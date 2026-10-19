import { BANK, PAIRS, Pair, Question, TradeKey } from "@/lib/data";

export type TopicStat = { c: number; a: number };
export type Session = { kind: string; detail: string; trade: TradeKey; state: string; at: number };
/** A question the student got wrong, scheduled for Smart Review (box 0 = due now, then 1/3/7/14 days). */
export type Missed = { q: Question; box: number; due: number; misses: number; at: number; trade: TradeKey };

export type Progress = {
  state: string;
  trade: TradeKey;
  examDate: string;
  stats: Partial<Record<TradeKey, Record<string, TopicStat>>>;
  hist: Session[];
  cards: Record<string, { box: number; due: number }>;
  extraPairs: Pair[];
  extraBank: Question[];
  best: Record<string, number>;
  // Smart Review + motivation
  missed: Record<string, Missed>;
  /** Local dates (YYYY-MM-DD) with any study activity */
  days: string[];
  xp: number;
  answered: number;
  exams: number;
  bestStreak: number;
  /** badge id → time earned */
  badges: Record<string, number>;
  /** Questions answered per local date (last 60 days), for the daily goal */
  daily: Record<string, number>;
};

export const EMPTY: Progress = {
  state: "Tennessee", trade: "gc", examDate: "", stats: {}, hist: [], cards: {}, extraPairs: [], extraBank: [], best: {},
  missed: {}, days: [], xp: 0, answered: 0, exams: 0, bestStreak: 0, badges: {}, daily: {}
};

const DAY_MS = 864e5;
const isObj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date, e.g. "2026-10-19" */
export function localDay(ts: number = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function longestRun(days: string[]): number {
  const sorted = Array.from(new Set(days)).sort();
  let best = 0, run = 0, prev = 0;
  for (const d of sorted) {
    const t = new Date(d + "T12:00").getTime();
    run = prev && Math.round((t - prev) / DAY_MS) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

export function normalize(d: any): Progress {
  const raw = isObj(d) ? d : {};
  const p = { ...EMPTY, ...raw } as Progress;
  for (const k of ["stats", "cards", "best", "missed", "badges", "daily"] as const) if (!isObj(p[k])) (p as any)[k] = {};
  for (const k of ["hist", "extraPairs", "extraBank", "days"] as const) if (!Array.isArray(p[k])) (p as any)[k] = [];
  // Records saved before streaks/XP existed: fill them in from the student's real history
  let c = 0, a = 0;
  Object.values(p.stats).forEach((s) => Object.values(s || {}).forEach((t: any) => { c += Number(t?.c) || 0; a += Number(t?.a) || 0; }));
  if (!p.days.length && p.hist.length) p.days = Array.from(new Set(p.hist.map((h) => localDay(h.at)))).sort();
  if (num(raw.answered) === null) p.answered = a;
  if (num(raw.exams) === null) p.exams = p.hist.filter((h) => h.kind === "Mock exam").length;
  if (num(raw.xp) === null) p.xp = a * XP.attempt + c * XP.correct + p.exams * XP.exam;
  if (num(raw.bestStreak) === null) p.bestStreak = longestRun(p.days);
  return p;
}

export type Part = "trade" | "law" | "mix";

export function pool(p: Progress, part: Part): Question[] {
  const tr = BANK.filter((b) => b.t === p.trade);
  const ex = p.extraBank.filter((b) => b.t === p.trade);
  const law = BANK.filter((b) => b.t === "law");
  return part === "trade" ? [...tr, ...ex] : part === "law" ? law : [...tr, ...ex, ...law];
}

const SHARED_GC = ["Markup", "Margin", "Mechanic's lien", "Change order"];
export function pairsFor(p: Progress): Pair[] {
  return [
    ...PAIRS.filter((x) => x.t === p.trade || (p.trade !== "gc" && x.t === "gc" && SHARED_GC.includes(x.k))),
    ...p.extraPairs.filter((x) => x.t === p.trade)
  ];
}

export function readiness(p: Progress): number | null {
  const s = p.stats[p.trade] || {};
  let c = 0, a = 0;
  const ts = Object.keys(s);
  ts.forEach((k) => { c += s[k].c; a += s[k].a; });
  if (!a) return null;
  const all = new Set(pool(p, "mix").map((b) => b.topic));
  const cov = Math.min(1, ts.length / Math.max(1, all.size));
  return Math.round(100 * (c / a) * (0.55 + 0.45 * cov) * Math.min(1, 0.5 + a / 80));
}

export function daysLeft(examDate: string): number | null {
  if (!examDate) return null;
  return Math.ceil((new Date(examDate + "T09:00").getTime() - Date.now()) / DAY_MS);
}

// ---------------------------------------------------------------------------------------------
// Motivation: daily streak, XP and badges
// ---------------------------------------------------------------------------------------------
export const XP = { attempt: 2, correct: 10, exam: 50 } as const;

/** Consecutive study days ending today (or yesterday, so the streak survives until tonight). */
export function streak(p: Progress): number {
  const set = new Set(p.days);
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  if (!set.has(localDay(d.getTime()))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(localDay(d.getTime()))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
export const studiedToday = (p: Progress) => p.days.includes(localDay());

/** Marks today as a study day. */
export function touch(p: Progress): Progress {
  const today = localDay();
  if (p.days[p.days.length - 1] === today) return p;
  const next = { ...p, days: [...p.days.filter((d) => d !== today), today].slice(-400) };
  const s = streak(next);
  return s > next.bestStreak ? { ...next, bestStreak: s } : next;
}

export type BadgeDef = { id: string; name: string; desc: string; goal: number; progress: (p: Progress) => number };
export const BADGES: BadgeDef[] = [
  { id: "first_exam", name: "First exam", desc: "Finish a timed mock exam", goal: 1, progress: (p) => p.exams },
  { id: "streak_7", name: "7-day streak", desc: "Study 7 days in a row", goal: 7, progress: (p) => Math.max(p.bestStreak, streak(p)) },
  { id: "q_100", name: "100 questions", desc: "Answer 100 practice questions", goal: 100, progress: (p) => p.answered },
  { id: "ready_70", name: "Readiness 70+", desc: "Reach a readiness score of 70", goal: 70, progress: (p) => readiness(p) ?? 0 },
  { id: "ready_85", name: "Readiness 85+", desc: "Reach a readiness score of 85", goal: 85, progress: (p) => readiness(p) ?? 0 }
];

/** Awards any badge the student has reached. Returns the same object when nothing changed. */
export function withBadges(p: Progress): Progress {
  let badges = p.badges;
  for (const b of BADGES) {
    if (badges[b.id] || b.progress(p) < b.goal) continue;
    if (badges === p.badges) badges = { ...badges };
    badges[b.id] = Date.now();
  }
  return badges === p.badges ? p : { ...p, badges };
}

export function withRecord(p: Progress, topic: string, ok: boolean): Progress {
  const stats = { ...p.stats };
  const s = { ...(stats[p.trade] || {}) };
  const t = s[topic] ? { ...s[topic] } : { c: 0, a: 0 };
  t.a++; if (ok) t.c++;
  s[topic] = t; stats[p.trade] = s;
  return touch({ ...p, stats, daily: bumpDaily(p.daily), answered: p.answered + 1, xp: p.xp + XP.attempt + (ok ? XP.correct : 0) });
}

function bumpDaily(d: Record<string, number>): Record<string, number> {
  const today = localDay();
  const next: Record<string, number> = { ...d, [today]: (d[today] || 0) + 1 };
  const keys = Object.keys(next).sort();
  if (keys.length > 60) keys.slice(0, keys.length - 60).forEach((k) => delete next[k]);
  return next;
}

export function withSession(p: Progress, kind: string, detail: string): Progress {
  return touch({ ...p, hist: [{ kind, detail, trade: p.trade, state: p.state, at: Date.now() }, ...p.hist].slice(0, 30) });
}

/** A finished mock exam: +50 XP. */
export const withExamDone = (p: Progress): Progress => ({ ...p, exams: p.exams + 1, xp: p.xp + XP.exam });

// ---------------------------------------------------------------------------------------------
// Smart Review: missed questions come back on a 1/3/7/14-day schedule; weak topics fill the rest
// ---------------------------------------------------------------------------------------------
export const REVIEW_DAYS = [1, 3, 7, 14];

/** Stable key for a question (FNV-1a hash of its text). */
export function qKey(text: string): string {
  const s = text.toLowerCase().replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return "q" + (h >>> 0).toString(36);
}

function capMissed(m: Record<string, Missed>): Record<string, Missed> {
  const keys = Object.keys(m);
  if (keys.length <= 400) return m;
  return Object.fromEntries(keys.sort((a, b) => m[b].at - m[a].at).slice(0, 400).map((k) => [k, m[k]]));
}

/** Updates the review schedule for one answered question. */
export function withReviewResult(p: Progress, q: Question, ok: boolean): Progress {
  const k = qKey(q.q);
  const cur = p.missed[k];
  const now = Date.now();
  if (!ok) {
    const { t, topic, q: text, c, a, ref, why, src } = q;
    const item: Missed = { q: { t, topic, q: text, c, a, ref, why, src }, box: 0, due: now, misses: (cur?.misses || 0) + 1, at: now, trade: cur?.trade || p.trade };
    return { ...p, missed: capMissed({ ...p.missed, [k]: item }) };
  }
  if (!cur || cur.due > now) return p; // not scheduled, or answered early: keep the schedule
  if (cur.box >= REVIEW_DAYS.length) {   // passed the 14-day check: mastered
    const missed = { ...p.missed };
    delete missed[k];
    return { ...p, missed };
  }
  const box = cur.box + 1;
  return { ...p, missed: { ...p.missed, [k]: { ...cur, box, due: now + REVIEW_DAYS[box - 1] * DAY_MS, at: now } } };
}

/** Records an answered question: topic stats, XP, streak and the review schedule. */
export const withAnswer = (p: Progress, q: Question, ok: boolean): Progress => withReviewResult(withRecord(p, q.topic, ok), q, ok);

export function dueMissed(p: Progress, now = Date.now()): Missed[] {
  return Object.values(p.missed)
    .filter((m) => m.trade === p.trade && m.due <= now)
    .sort((a, b) => a.due - b.due || b.misses - a.misses);
}
export const scheduledMissed = (p: Progress) => Object.values(p.missed).filter((m) => m.trade === p.trade);

export function weakTopics(p: Progress, n = 3): { topic: string; pct: number; a: number }[] {
  return Object.entries(p.stats[p.trade] || {})
    .filter(([, v]) => v.a > 0)
    .map(([topic, v]) => ({ topic, pct: Math.round((100 * v.c) / v.a), a: v.a }))
    .filter((t) => t.pct < 90)
    .sort((x, y) => x.pct - y.pct || y.a - x.a)
    .slice(0, n);
}

export type ReviewWhy = "missed" | "weak" | "new" | "mix";
export type ReviewItem = { q: Question; why: ReviewWhy; pct?: number };

/** An adaptive session: due misses first, then the weakest topics, then topics not tried yet. */
export function buildReview(p: Progress, size = 10): ReviewItem[] {
  const items: ReviewItem[] = [];
  const used = new Set<string>();
  const add = (q: Question, why: ReviewWhy, pct?: number) => {
    const k = qKey(q.q);
    if (used.has(k) || items.length >= size) return;
    used.add(k);
    items.push({ q, why, pct });
  };
  const due = dueMissed(p);
  due.slice(0, 7).forEach((m) => add(m.q, "missed"));
  const all = pool(p, "mix");
  const lists = weakTopics(p, 3).map((w) => shuffle(all.filter((q) => q.topic === w.topic)).map((q) => ({ q, pct: w.pct })));
  for (let i = 0; items.length < size && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length) add(l[i].q, "weak", l[i].pct);
  }
  due.forEach((m) => add(m.q, "missed"));
  const tried = new Set(Object.keys(p.stats[p.trade] || {}));
  shuffle(all.filter((q) => !tried.has(q.topic))).forEach((q) => add(q, "new"));
  shuffle(all).forEach((q) => add(q, "mix"));
  return shuffle(items);
}

/** Background for the tutor when a student asks about one question. */
export function questionContext(q: Question, picked?: number | null): string {
  const L = "ABCD";
  return [
    "Practice exam question the student is reviewing:",
    q.q,
    "Choices: " + q.c.map((c, k) => `${L[k]}) ${c}`).join("; "),
    `Correct answer: ${L[q.a]}) ${q.c[q.a]}`,
    picked === undefined ? "" : `Student picked: ${picked === null ? "nothing (skipped)" : `${L[picked]}) ${q.c[picked]}`}`,
    q.ref ? `Reference: ${q.ref}` : "",
    q.why ? `Explanation on file: ${q.why}` : ""
  ].filter(Boolean).join("\n");
}

export const shuffle = <T,>(a: T[]): T[] => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
};

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** A one-line summary of how the student is doing, sent with tutor questions so Bro can tailor its help. */
export function coachNote(p: Progress): string {
  const s = p.stats[p.trade] || {};
  let c = 0, a = 0;
  const topics: { t: string; pct: number; a: number }[] = [];
  for (const [t, v] of Object.entries(s)) { c += v.c; a += v.a; if (v.a >= 4) topics.push({ t, pct: Math.round((v.c / v.a) * 100), a: v.a }); }
  topics.sort((x, y) => x.pct - y.pct);
  const parts: string[] = [];
  const left = daysLeft(p.examDate);
  if (left !== null && left >= 0) parts.push(`Exam in ${left} day${left === 1 ? "" : "s"}.`);
  if (a) parts.push(`${a} practice questions, ${Math.round((c / a) * 100)}% correct.`);
  if (topics.length) parts.push(`Weakest: ${topics.slice(0, 3).map((x) => `${x.t} ${x.pct}%`).join(", ")}.`);
  const mock = [...p.hist].reverse().find((h) => h.kind === "Mock exam");
  if (mock) parts.push(`Last mock exam: ${mock.detail.split("·")[0].trim()}.`);
  return parts.join(" ").slice(0, 400);
}

// ---------------------------------------------------------------------------------------------
// Today's plan: a proactive daily coach built from the student's own record
// ---------------------------------------------------------------------------------------------
export type PlanStep = { key: "review" | "weak" | "exam" | "new" | "tutor" | "start"; tab: "review" | "exam" | "tutor"; title: string; detail: string; ask?: string };
export type Plan = { goal: number; done: number; due: number; streak: number; studiedToday: boolean; daysLeft: number | null; headline: string; steps: PlanStep[] };

/** Daily question goal: more as the exam gets closer. */
export function dailyGoal(examDate: string): number {
  const d = daysLeft(examDate);
  if (d === null || d < 0) return 20;
  if (d <= 7) return 40;
  if (d <= 30) return 30;
  return 20;
}

export function todayPlan(p: Progress, now = Date.now()): Plan {
  const goal = dailyGoal(p.examDate);
  const done = p.daily[localDay(now)] || 0;
  const due = dueMissed(p, now).length;
  const weak = weakTopics(p, 2);
  const left = daysLeft(p.examDate);
  const st = streak(p);
  const steps: PlanStep[] = [];
  const answered = Object.values(p.stats[p.trade] || {}).reduce((n, t) => n + t.a, 0);

  if (!answered) {
    steps.push({ key: "start", tab: "review", title: "Answer your first 10 questions", detail: "Smart Review mixes topics so Bro can see where you stand." });
    steps.push({ key: "exam", tab: "exam", title: "Take a short mock exam", detail: "Timed, like test day. It sets your first readiness score." });
    steps.push({ key: "tutor", tab: "tutor", title: "Ask Bro how your exam works", detail: `What's on the ${p.state} exam, and how to study for it.`, ask: `How does the ${p.state} contractor exam work for my trade, and how should I study for it?` });
  } else {
    if (due > 0) steps.push({ key: "review", tab: "review", title: `Clear ${due} review question${due === 1 ? "" : "s"}`, detail: "Questions you missed are due again. Get them right to push them out." });
    if (weak[0]) steps.push({ key: "weak", tab: "review", title: `Drill ${weak[0].topic}`, detail: `You're at ${weak[0].pct}% here. Smart Review pulls extra questions from it.` });
    const lastMock = p.hist.find((h) => h.kind === "Mock exam");
    const mockStale = !lastMock || now - lastMock.at > 3 * 864e5;
    if (mockStale && (left === null || left <= 21 || answered >= 40)) steps.push({ key: "exam", tab: "exam", title: "Take a timed mock exam", detail: lastMock ? "It's been a few days. See if your score moved." : "Get a real score under exam conditions." });
    const explain = weak[1] || weak[0];
    if (explain) steps.push({ key: "tutor", tab: "tutor", title: `Have Bro teach ${explain.topic}`, detail: "A quick lesson with the code section and a worked example.", ask: `Teach me ${explain.topic} for my exam. Keep it short, cite the code section, and finish with one practice question.` });
    if (steps.length < 2) steps.push({ key: "new", tab: "review", title: "Mix in new topics", detail: "Cover more of the exam outline to raise your readiness." });
  }

  let headline: string;
  if (left !== null && left === 0) headline = "Exam day. Quick review, then go get it.";
  else if (done >= goal) headline = "Today's goal done. Anything extra is a bonus.";
  else if (left !== null && left > 0 && left <= 7) headline = `${left} day${left === 1 ? "" : "s"} to go. Every question counts now.`;
  else if (done > 0) headline = `${goal - done} more to hit today's goal.`;
  else if (st > 0) headline = `Keep your ${st}-day streak going.`;
  else headline = "Here's your plan for today.";

  return { goal, done, due, streak: st, studiedToday: studiedToday(p), daysLeft: left, headline, steps: steps.slice(0, 3) };
}
