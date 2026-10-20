// Bro's research desk, the parts with no I/O: which topics to study next, spotting questions the knowledge base
// couldn't answer well, reading the model's JSON, merging the writer's claims with the independent checker's
// verdicts, and the text of the library document a finished study becomes. Kept apart so it can be unit-tested.

export type Trade = "gc" | "elec" | "plumb" | "hvac";
export type Verdict = "confirmed" | "corrected" | "disputed" | "unclear";

/** One finding from a study: what the writer claimed and what the checker found. */
export type Claim = {
  claim: string;
  source_url: string | null;
  source_title: string | null;
  quote?: string | null;
  verdict: Verdict;
  correction?: string | null;
  note?: string | null;
  /** Built-in fact ids this finding disagrees with (the built-in fact may be out of date) */
  conflicts: string[];
  official: boolean;
  /** Published to the library */
  kept: boolean;
};

// ---------------------------------------------------------------------------------------------------------------
// Topics: what an exam candidate in each trade needs to know about their state, researched one at a time
// ---------------------------------------------------------------------------------------------------------------
export const STATE_TOPICS: Record<Trade, string[]> = {
  gc: [
    "{state} general contractor licensing: the license classes, the project dollar amount that requires a license, and the experience required",
    "{state} contractor license exams: which tests are required (trade and business & law), the testing company, number of questions, time limit, passing score and allowed reference books",
    "{state} contractor bond, insurance and financial statement requirements for a license",
    "{state} mechanic's lien law for contractors: preliminary notice requirements and lien filing deadlines",
    "{state} contractor license renewal period and continuing education requirements",
    "{state} residential and commercial building code editions currently adopted statewide (IRC and IBC) and when they took effect",
    "{state} workers' compensation coverage requirements for contractors and subcontractors",
    "{state} prompt payment and retainage rules for construction contracts",
    "{state} home improvement or residential contractor contract requirements and consumer protections"
  ],
  elec: [
    "{state} electrical license classes (apprentice, journeyman, master, contractor) and the experience hours each requires",
    "{state} National Electrical Code (NEC) edition currently adopted statewide and its effective date",
    "{state} electrical license exam: testing company, number of questions, time limit, passing score and allowed references",
    "{state} electrical license renewal period and continuing education hours"
  ],
  plumb: [
    "{state} plumbing code adopted statewide (IPC or UPC), the edition and its effective date",
    "{state} plumbing license classes and the experience each requires",
    "{state} plumbing license exam: testing company, format, passing score and allowed references",
    "{state} backflow prevention and cross-connection tester certification requirements"
  ],
  hvac: [
    "{state} mechanical code and fuel gas code editions adopted statewide and their effective dates",
    "{state} HVAC or mechanical contractor license classes and experience requirements",
    "{state} HVAC or mechanical license exam: testing company, format, passing score and allowed references",
    "{state} refrigerant and HVAC technician rules beyond EPA Section 608, if any"
  ]
};

/** Rule changes every candidate in a trade should know about, wherever they live. */
export const NATIONAL_TOPICS: { trade: Trade; topic: string }[] = [
  { trade: "gc", topic: "Recent OSHA construction safety rule changes (29 CFR 1926) in the last two years that matter for contractor exams" },
  { trade: "elec", topic: "Key changes in the 2026 National Electrical Code that are likely to show up on electrical exams" },
  { trade: "plumb", topic: "Key changes in the 2024 International Plumbing Code compared with the 2021 edition" },
  { trade: "hvac", topic: "EPA refrigerant rule changes under the AIM Act (HFC phasedown and technology transitions) that HVAC technicians need to know" },
  { trade: "gc", topic: "Key changes in the 2024 International Building Code and International Residential Code that affect contractors" }
];

export const researchKey = (topic: string, trade: string | null, state: string | null) =>
  `${(trade || "").toLowerCase()}|${(state || "").toLowerCase()}|${topic.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 200)}`;

export type GapRow = { id: string; question: string; trade: string | null; state: string | null; hits: number };
export type ResearchPick = { topic: string; trade: Trade | null; state: string | null; origin: "gap" | "schedule"; gap_id?: string };

/**
 * The next topics to study: questions students asked that the knowledge base couldn't answer well come first
 * (most asked first), then state topics for the states and trades students actually study, most students first,
 * with a national rule-change topic mixed in every so often. Anything studied recently is skipped.
 */
export function planResearch(o: {
  n: number;
  gaps: GapRow[];
  students: { state: string | null; trade: string | null }[];
  recent: Set<string>;
  gapsFirst?: boolean;
  seed?: number;
}): ResearchPick[] {
  const out: ResearchPick[] = [];
  const n = Math.max(0, Math.min(10, o.n));
  const taken = new Set(o.recent);
  const add = (p: ResearchPick) => {
    const k = researchKey(p.topic, p.trade, p.state);
    if (taken.has(k) || out.length >= n) return;
    taken.add(k);
    out.push(p);
  };
  if (o.gapsFirst !== false) {
    for (const g of [...o.gaps].sort((a, b) => b.hits - a.hits)) {
      add({ topic: g.question, trade: isTrade(g.trade) ? g.trade : null, state: g.state || null, origin: "gap", gap_id: g.id });
    }
  }
  // Where students are: state × trade, weighted by how many study it (Tennessee general contractors if nobody yet)
  const weight = new Map<string, number>();
  for (const s of o.students) {
    if (!s.state || !isTrade(s.trade)) continue;
    const k = `${s.state}|${s.trade}`;
    weight.set(k, (weight.get(k) || 0) + 1);
  }
  if (!weight.size) weight.set("Tennessee|gc", 1);
  const combos = [...weight].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => {
    const [state, trade] = k.split("|");
    return { state, trade: trade as Trade };
  });
  // Round-robin: each combo's next not-yet-studied topic (most students first), then the one after, ...
  const seed = o.seed ?? 0;
  let national = seed % NATIONAL_TOPICS.length;
  const next = combos.map(() => 0);
  let progressed = true;
  while (out.length < n && progressed) {
    progressed = false;
    combos.forEach((c, ci) => {
      if (out.length >= n) return;
      const list = STATE_TOPICS[c.trade];
      while (next[ci] < list.length) {
        const topic = list[next[ci]++].replace("{state}", c.state);
        const before = out.length;
        add({ topic, trade: c.trade, state: c.state, origin: "schedule" });
        if (out.length > before) { progressed = true; break; }
      }
      // Every fourth pick, a national topic
      if (out.length && out.length % 4 === 0 && out.length < n) {
        for (let j = 0; j < NATIONAL_TOPICS.length; j++) {
          const t = NATIONAL_TOPICS[(national + j) % NATIONAL_TOPICS.length];
          const before = out.length;
          add({ topic: t.topic, trade: t.trade, state: null, origin: "schedule" });
          if (out.length > before) { national = (national + j + 1) % NATIONAL_TOPICS.length; break; }
        }
      }
    });
  }
  for (const t of NATIONAL_TOPICS) add({ topic: t.topic, trade: t.trade, state: null, origin: "schedule" });
  return out;
}

const isTrade = (t: unknown): t is Trade => t === "gc" || t === "elec" || t === "plumb" || t === "hvac";

// ---------------------------------------------------------------------------------------------------------------
// Knowledge gaps: tutor questions the built-in facts and the library didn't cover well
// ---------------------------------------------------------------------------------------------------------------
const STOP = new Set(("a an the and or but if then than so to of in on at by for with from into over under about as is are was were be been being do does did " +
  "have has had can could should would will shall may might must i me my we our you your he she it its they them their this that these those what which who whom " +
  "whose when where why how not no yes there here just also very really please thanks thank hi hello hey ok okay bro tell explain know need want get give").split(" "));

export function contentWords(text: string): string[] {
  return [...new Set((text || "").toLowerCase().replace(/[^a-z0-9.%' ]+/g, " ").split(/\s+/).map((w) => w.replace(/^'+|'+$/g, "").replace(/\.$/, ""))
    .filter((w) => w.length > 2 && !STOP.has(w)))];
}

/** Share of a question's meaningful words found in the notes the tutor got (0 to 1). */
export function coverage(question: string, notes: string[]): number {
  const words = contentWords(question);
  if (!words.length) return 1;
  const hay = notes.join(" ").toLowerCase();
  const hit = words.filter((w) => hay.includes(w.length > 5 ? w.slice(0, w.length - 2) : w)).length;
  return hit / words.length;
}

/** Removes emails, phone numbers and long digit runs, so nothing personal is kept with a logged question. */
export function scrubQuestion(q: string): string {
  return (q || "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone]")
    .replace(/\b\d{7,}\b/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

/** Whether a question is worth logging as a gap: a real exam-content question, not small talk or a follow-up. */
export function gapWorthy(q: string): boolean {
  const t = (q || "").trim();
  if (t.length < 15 || t.length > 1200) return false;
  if (/^(thanks|thank you|ok|okay|cool|got it|why\??|how\??|what\??|really\??|yes|no)\b/i.test(t) && t.length < 40) return false;
  return contentWords(t).length >= 3;
}

/** Decides whether the tutor's notes for a question were thin enough to log a gap, and why. */
export function gapReason(o: { question: string; facts: { fact: string; state: string | null }[]; library: { text: string }[]; state: string; stateSensitive: boolean }): "weak" | "state" | null {
  if (!gapWorthy(o.question)) return null;
  if (o.stateSensitive && !o.facts.some((f) => f.state === o.state) && !o.library.length) return "state";
  const notes = [...o.facts.slice(0, 4).map((f) => f.fact), ...o.library.slice(0, 3).map((p) => p.text)];
  if (!notes.length) return "weak";
  return coverage(o.question, notes) < 0.4 ? "weak" : null;
}

export const gapKey = (q: string, trade: string | null, state: string | null) =>
  `${trade || ""}|${state || ""}|${contentWords(q).sort().join(" ").slice(0, 200)}`;

// ---------------------------------------------------------------------------------------------------------------
// Reading the models' answers
// ---------------------------------------------------------------------------------------------------------------
/** The JSON object in a reply: inside <json>…</json> if present, otherwise the last {...} block. */
// deno-lint-ignore no-explicit-any
export function parseJsonBlock(text: string): any | null {
  const t = text || "";
  const tagged = [...t.matchAll(/<json>([\s\S]*?)<\/json>/gi)].pop()?.[1];
  const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
  if (tagged) {
    const v = tryParse(tagged.trim().replace(/^```(?:json)?|```$/g, "").trim());
    if (v) return v;
  }
  const fenced = [...t.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].pop()?.[1];
  if (fenced) { const v = tryParse(fenced.trim()); if (v) return v; }
  // Last balanced {...}
  for (let end = t.lastIndexOf("}"); end > 0; end = t.lastIndexOf("}", end - 1)) {
    let depth = 0;
    for (let i = end; i >= 0; i--) {
      if (t[i] === "}") depth++;
      else if (t[i] === "{") { depth--; if (depth === 0) { const v = tryParse(t.slice(i, end + 1)); if (v) return v; break; } }
    }
  }
  return null;
}

const OFFICIAL = [
  /\.gov$/, /\.mil$/, /\.us$/, /(^|\.)state\.[a-z]{2}\.us$/,
  /(^|\.)ecfr\.gov$/, /(^|\.)osha\.gov$/, /(^|\.)epa\.gov$/, /(^|\.)nfpa\.org$/, /(^|\.)iccsafe\.org$/, /(^|\.)iapmo\.org$/,
  /(^|\.)psiexams\.com$/, /(^|\.)prometric\.com$/, /(^|\.)pearsonvue\.com$/, /(^|\.)nascla\.org$/, /(^|\.)ncarb\.org$/,
  /(^|\.)legislature\.[a-z.]+$/, /(^|\.)law\.cornell\.edu$/, /(^|\.)codes\.iccsafe\.org$/, /(^|\.)up\.codes$/
];
/** Government sites, code publishers, testing companies and official statute sites. */
export function isOfficialSource(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return OFFICIAL.some((r) => r.test(h));
  } catch { return false; }
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const cleanUrl = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  try { const u = new URL(v.trim()); return /^https?:$/.test(u.protocol) ? u.toString().slice(0, 600) : null; } catch { return null; }
};

/** The writer's findings, cleaned up: at most 10, each a sentence with a link. */
// deno-lint-ignore no-explicit-any
export function readClaims(raw: any): { summary: string; claims: { claim: string; source_url: string | null; source_title: string | null; quote: string | null }[] } {
  const list = Array.isArray(raw?.claims) ? raw.claims : [];
  return {
    summary: clip(raw?.summary, 600),
    // deno-lint-ignore no-explicit-any
    claims: list.map((c: any) => ({ claim: clip(c?.claim, 500), source_url: cleanUrl(c?.source_url), source_title: clip(c?.source_title, 160) || null, quote: clip(c?.quote, 400) || null }))
      .filter((c: { claim: string }) => c.claim.length >= 12)
      .slice(0, 10)
  };
}

/**
 * Combines the writer's findings with the checker's verdicts. A finding is published only when the checker
 * confirmed it (or corrected it) from an official source and it doesn't disagree with a built-in fact;
 * everything else waits for a person. `reviewFirst` holds everything for a person.
 */
export function mergeVerdicts(
  claims: { claim: string; source_url: string | null; source_title: string | null; quote: string | null }[],
  // deno-lint-ignore no-explicit-any
  rawVerdicts: any,
  o: { reviewFirst?: boolean; knownFactIds?: Set<string> } = {}
): { claims: Claim[]; kept: number; flags: number } {
  // deno-lint-ignore no-explicit-any
  const list: any[] = Array.isArray(rawVerdicts?.verdicts) ? rawVerdicts.verdicts : Array.isArray(rawVerdicts) ? rawVerdicts : [];
  const out: Claim[] = claims.map((c, i) => {
    const v = list.find((x) => Number(x?.i) === i) || list[i] || {};
    const verdict: Verdict = ["confirmed", "corrected", "disputed", "unclear"].includes(v?.verdict) ? v.verdict : "unclear";
    const url = cleanUrl(v?.source_url) || c.source_url;
    const conflicts = (Array.isArray(v?.conflicts) ? v.conflicts : []).map((x: unknown) => String(x).trim()).filter((x: string) => /^[A-Za-z0-9_.-]{1,40}$/.test(x) && (!o.knownFactIds || o.knownFactIds.has(x))).slice(0, 5);
    const correction = verdict === "corrected" ? clip(v?.correction, 500) || null : null;
    const official = isOfficialSource(url) || (v?.official === true && !!url);
    const publishable = (verdict === "confirmed" || (verdict === "corrected" && !!correction)) && official && !conflicts.length;
    return {
      claim: c.claim,
      source_url: url,
      source_title: clip(v?.source_title, 160) || c.source_title,
      quote: c.quote,
      verdict,
      correction,
      note: clip(v?.note, 400) || null,
      conflicts,
      official,
      kept: publishable && !o.reviewFirst
    };
  });
  const kept = out.filter((c) => c.kept).length;
  const flags = out.filter((c) => c.verdict === "disputed" || c.conflicts.length > 0).length;
  return { claims: out, kept, flags };
}

/** What a finding says once checked: the correction when the checker fixed it. */
export const finalText = (c: Pick<Claim, "claim" | "verdict" | "correction">) => (c.verdict === "corrected" && c.correction ? c.correction : c.claim);

/** The library document for a finished study: one section per published finding, each with its source. */
export function researchDocText(topic: string, state: string | null, claims: Claim[], when: Date, summary = ""): string {
  const date = when.toISOString().slice(0, 10);
  const lines = [
    `# ${topic}`,
    "",
    `Researched by Bro's research desk on ${date}${state ? ` for ${state}` : ""}. Every finding below was checked against an official source by a second, independent review. Rules change: confirm against the source before relying on it for a job.`,
    ...(summary ? ["", summary] : [])
  ];
  for (const c of claims.filter((x) => x.kept)) {
    const text = finalText(c);
    lines.push("", `## ${text.split(/(?<=[.;:])\s/)[0].slice(0, 110)}`, "", text, "", `Source: ${c.source_title || "official source"}${c.source_url ? ` (${c.source_url})` : ""}. Checked ${date}.`);
  }
  return lines.join("\n");
}

/** Title for the library document. */
export const researchTitle = (topic: string) => `Bro's research: ${topic.replace(/\s+/g, " ").trim()}`.slice(0, 200);
