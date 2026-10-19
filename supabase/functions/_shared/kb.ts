// Licensing Bro's knowledge base: verified facts the AI looks up before answering or writing questions.
// Facts live in kb.json (generated; see KNOWLEDGE_BASE.md). Retrieval is a small keyword scorer, which is
// fast, free, and good enough for a few thousand short facts.
import kbData from "./kb.json" with { type: "json" };

export type Fact = {
  id: string;
  topic: string;
  trade: "gc" | "law" | "elec" | "plumb" | "hvac";
  state: string | null;
  source: string;
  fact: string;
  status: "verified" | "corrected" | "unverified";
  note: string;
  keywords: string[];
};

const FACTS: Fact[] = (kbData as { facts: Fact[] }).facts;

const STOP = new Set(("a an and are as at be but by can do does for from how i if in into is it its me my of on or our so " +
  "than that the their them then there these they this to up was we what when where which who why will with you your " +
  "about should must need needs required require explain tell quiz give show many much").split(" "));

/** Light stemming so "trenches", "trenching" and "trench" match. */
function stem(w: string): string {
  if (w.length <= 4 || /\d/.test(w)) return w;
  for (const suf of ["ations", "ation", "ings", "ing", "ers", "ies", "es", "ed", "s"]) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) return suf === "ies" ? w.slice(0, -3) + "y" : w.slice(0, -suf.length);
  }
  return w;
}

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9.%/ ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
}

/** Everyday words students use → the terms the codes and facts use (applied to questions only). */
const SYNONYMS: Record<string, string[]> = {
  die: ["fatality", "death"], dies: ["fatality", "death"], died: ["fatality"], killed: ["fatality"], death: ["fatality"], dead: ["fatality"],
  hurt: ["injury", "injured"], injured: ["injury"], hospital: ["hospitalization", "inpatient"],
  call: ["report", "notify"], tell: ["report", "notify"], fast: ["within", "hours"], quickly: ["within"],
  guys: ["employees", "workers"], crew: ["employees", "workers"], workers: ["employees"], worker: ["employee"], boss: ["employer"],
  house: ["dwelling", "residential"], home: ["dwelling", "residential"], homes: ["dwelling"],
  jobsite: ["construction"], site: ["construction"],
  stairs: ["stairway", "riser", "tread"], steps: ["stairway", "riser", "tread"],
  hole: ["excavation", "opening"], ditch: ["trench", "excavation"], trench: ["excavation"], dig: ["excavation"],
  deep: ["depth"], tall: ["height"], high: ["height"], height: ["high"],
  railing: ["guardrail", "handrail"], rail: ["guardrail", "handrail"],
  pay: ["payment", "wages"], paid: ["payment"], paycheck: ["wages", "payroll"], fired: ["termination"], quit: ["termination"],
  hire: ["employment", "hired"], hiring: ["employment"], taxes: ["tax"], money: ["payment"],
  waiver: ["release"], lien: ["mechanic"], bid: ["bidder", "bidding"], cost: ["estimate", "price"], markup: ["margin"],
  wire: ["conductor"], wires: ["conductor"], breaker: ["overcurrent"], ground: ["grounding"], outlet: ["receptacle"], outlets: ["receptacle"],
  pipe: ["piping"], drain: ["drainage"], vent: ["venting"], ac: ["air", "conditioning", "hvac"], freon: ["refrigerant"],
  ladder: ["ladders"], scaffolding: ["scaffold"], hardhat: ["head", "protection"], glasses: ["eye", "protection"],
  license: ["licensing", "licensure"], permit: ["permits"], insurance: ["coverage", "policy"]
};

function expand(q: string[]): { w: string; weight: number }[] {
  const out = new Map<string, number>();
  for (const w of q) out.set(w, 1);
  for (const w of q) for (const syn of SYNONYMS[w] || []) for (const t of tokens(syn)) if (!out.has(t)) out.set(t, 0.7);
  return [...out].map(([w, weight]) => ({ w, weight }));
}

// Precompute a searchable bag of words per fact
const INDEX = FACTS.map((f) => ({
  f,
  kw: new Set(f.keywords.flatMap((k) => tokens(k))),
  body: new Set(tokens(`${f.fact} ${f.topic} ${f.source}`))
}));

// Document frequency, so rare words (e.g. "retainage") count more than common ones (e.g. "contractor")
const DF = new Map<string, number>();
for (const d of INDEX) for (const w of new Set([...d.kw, ...d.body])) DF.set(w, (DF.get(w) || 0) + 1);
const idf = (w: string) => Math.log(1 + INDEX.length / (1 + (DF.get(w) || 0)));

/** Facts that apply to this student: their trade or Business & Law, and only their own state's state-specific facts. */
function applies(f: Fact, trade: string, state: string) {
  if (f.state && f.state !== state) return false;
  // Business & Law and OSHA jobsite safety apply to every trade; otherwise facts belong to their own trade's exam
  if (f.trade === "law" || f.topic === "Safety (OSHA)") return true;
  return f.trade === trade;
}

export function searchFacts(query: string, opts: { trade: string; state: string; limit?: number }): Fact[] {
  const raw = query.toLowerCase().replace(/[^a-z0-9.%/ ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
  const q = expand([...new Set([...raw, ...raw.map(stem)])]);
  if (!q.length) return [];
  const scored: { f: Fact; s: number }[] = [];
  for (const d of INDEX) {
    if (!applies(d.f, opts.trade, opts.state)) continue;
    let s = 0;
    for (const { w, weight } of q) {
      if (d.kw.has(w)) s += 3 * idf(w) * weight;
      else if (d.body.has(w)) s += idf(w) * weight;
    }
    if (s <= 0) continue;
    if (d.f.status === "unverified") s *= 0.6;
    if (d.f.state) s *= 1.2;
    scored.push({ f: d.f, s });
  }
  scored.sort((a, b) => b.s - a.s);
  // Skip near-duplicates so the limited slots cover more ground
  const picked: { f: Fact; t: Set<string> }[] = [];
  for (const { f } of scored) {
    const t = new Set(tokens(f.fact));
    const dup = picked.some((p) => { let i = 0; for (const w of t) if (p.t.has(w)) i++; return i / (t.size + p.t.size - i || 1) > 0.55; });
    if (!dup) picked.push({ f, t });
    if (picked.length >= (opts.limit ?? 10)) break;
  }
  return picked.map((p) => p.f);
}

const inPart = (f: Fact, part: string) => (part === "law" ? f.trade === "law" : part === "trade" ? f.trade !== "law" : true);

/**
 * A random spread of verified facts for a trade and exam section, used to ground AI-written questions.
 * With `topic`, facts about that topic come first (topic name, keywords, then keyword search).
 */
export function sampleFacts(opts: { trade: string; state: string; part: string; count: number; topic?: string }): Fact[] {
  const shuffle = <T>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const eligible = (f: Fact) => f.status !== "unverified" && applies(f, opts.trade, opts.state) && inPart(f, opts.part);
  const topic = (opts.topic || "").trim().toLowerCase();
  if (topic) {
    const words = tokens(topic);
    const onTopic = INDEX.filter((d) => eligible(d.f) && (
      d.f.topic.toLowerCase().includes(topic) || topic.includes(d.f.topic.toLowerCase()) ||
      (words.length > 0 && words.every((w) => d.kw.has(w) || d.body.has(w)))
    )).map((d) => d.f);
    const picked = new Map(shuffle(onTopic).slice(0, opts.count).map((f) => [f.id, f]));
    if (picked.size < opts.count) {
      for (const f of searchFacts(topic, { trade: opts.trade, state: opts.state, limit: opts.count * 2 })) {
        if (picked.size >= opts.count) break;
        if (eligible(f)) picked.set(f.id, f);
      }
    }
    if (picked.size > 0) return [...picked.values()];
  }
  return shuffle(FACTS.filter(eligible)).slice(0, opts.count);
}

export function formatFacts(facts: Fact[]): string {
  return facts.map((f) => `[${f.id}] (${f.status === "unverified" ? "UNVERIFIED — tell the student to confirm" : "verified"}) ${f.fact} — Source: ${f.source}${f.state ? ` (applies in ${f.state})` : ""}`).join("\n");
}

export const KB_SIZE = FACTS.length;

/** What the built-in knowledge base covers: facts by trade, verified share, and states with their own facts. */
export function kbStats() {
  const byTrade: Record<string, number> = {};
  const states = new Set<string>();
  let verified = 0;
  for (const f of FACTS) {
    byTrade[f.trade] = (byTrade[f.trade] || 0) + 1;
    if (f.status !== "unverified") verified++;
    if (f.state) states.add(f.state);
  }
  return { facts: FACTS.length, verified, byTrade, states: [...states].sort() };
}
