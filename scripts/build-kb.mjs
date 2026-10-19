// Merges knowledge-base batches (knowledge/batches/*.json) into the files the app uses:
//   supabase/functions/_shared/kb.json  facts the AI tutor looks up
//   lib/kb-questions.json               verified practice questions added to the bank
//   knowledge/kb.csv                    spreadsheet for human review
// Run: node scripts/build-kb.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const BATCH_DIR = path.join(ROOT, "knowledge/batches");
const GC_TOPICS = ["Safety (OSHA)", "Building code (IBC)", "Residential code", "Site work & concrete", "Masonry", "Wood framing", "Steel & trusses", "Drywall & finishes", "Roofing", "Doors, windows & glazing", "Accessibility", "Fire protection", "Estimating", "Project management", "Plan reading", "Energy & environmental"];
const LAW_TOPICS = ["Business organization", "Business planning", "Estimating & bidding", "Contracts & liens", "Bonds & insurance", "Payroll & tax", "Labor law", "Financial management", "Project management", "Risk management", "Safety recordkeeping", "Environmental"];
const STATUS_RANK = { verified: 2, corrected: 2, unverified: 1 };

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2);
function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  let i = 0; for (const w of A) if (B.has(w)) i++;
  return i / (A.size + B.size - i || 1);
}

const facts = [], questions = [], problems = [];
for (const file of fs.readdirSync(BATCH_DIR).filter((f) => f.endsWith(".json")).sort()) {
  const d = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, file), "utf8"));
  for (const f of d.facts || []) facts.push({ ...f, _batch: file });
  for (const q of d.questions || []) questions.push({ ...q, _batch: file });
}

// --- facts: validate, dedupe, id ---
const keptFacts = [];
for (const f of facts) {
  const topics = f.trade === "law" ? LAW_TOPICS : GC_TOPICS;
  if (!["gc", "law"].includes(f.trade) || !f.fact || !STATUS_RANK[f.status]) { problems.push(`fact dropped (bad shape) in ${f._batch}: ${String(f.fact).slice(0, 60)}`); continue; }
  if (!topics.includes(f.topic)) f.topic = f.trade === "law" ? "Project management" : "Project management";
  const toks = norm(f.fact);
  const dup = keptFacts.find((k) => k.trade === f.trade && (k.state || null) === (f.state || null) && jaccard(k._toks, toks) > 0.7);
  if (dup) {
    if (STATUS_RANK[f.status] > STATUS_RANK[dup.status]) Object.assign(dup, f, { _toks: toks });
    continue;
  }
  keptFacts.push({ ...f, state: f.state || null, keywords: Array.isArray(f.keywords) ? f.keywords.map(String) : [], _toks: toks });
}
const counters = {};
const prefix = (t) => t.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase();
keptFacts.sort((a, b) => a.trade.localeCompare(b.trade) || a.topic.localeCompare(b.topic));
const outFacts = keptFacts.map((f) => {
  const p = prefix(f.topic); counters[p] = (counters[p] || 0) + 1;
  return { id: `${p}-${String(counters[p]).padStart(3, "0")}`, topic: f.topic, trade: f.trade, state: f.state, source: String(f.source || ""), fact: String(f.fact).trim(), status: f.status, note: String(f.note || ""), keywords: f.keywords.slice(0, 10) };
});

// --- questions: validate, dedupe ---
const keptQ = [];
for (const q of questions) {
  const ok = ["gc", "law"].includes(q.t) && typeof q.q === "string" && Array.isArray(q.c) && q.c.length === 4 &&
    new Set(q.c.map((x) => String(x).trim().toLowerCase())).size === 4 && Number.isInteger(q.a) && q.a >= 0 && q.a <= 3 && q.ref && q.why &&
    !q.c.some((x) => /all of the above|none of the above/i.test(String(x)));
  if (!ok) { problems.push(`question dropped (bad shape) in ${q._batch}: ${String(q.q).slice(0, 60)}`); continue; }
  const topics = q.t === "law" ? LAW_TOPICS : GC_TOPICS;
  const toks = norm(q.q + " " + q.c[q.a]);
  if (keptQ.some((k) => jaccard(k._toks, toks) > 0.75)) continue;
  keptQ.push({ t: q.t, topic: topics.includes(q.topic) ? q.topic : "Project management", q: q.q.trim(), c: q.c.map((x) => String(x).trim()), a: q.a, ref: String(q.ref).slice(0, 60), why: String(q.why).trim(), _toks: toks });
}
const outQ = keptQ.map(({ _toks, ...q }) => q);

fs.writeFileSync(path.join(ROOT, "supabase/functions/_shared/kb.json"), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), facts: outFacts }));
fs.writeFileSync(path.join(ROOT, "lib/kb-questions.json"), JSON.stringify(outQ));
const csvCell = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
fs.writeFileSync(path.join(ROOT, "knowledge/kb.csv"), ["id,status,trade,topic,state,fact,source,note", ...outFacts.map((f) => [f.id, f.status, f.trade, f.topic, f.state || "", f.fact, f.source, f.note].map(csvCell).join(","))].join("\n"));

const by = (arr, k) => arr.reduce((m, x) => ((m[x[k]] = (m[x[k]] || 0) + 1), m), {});
console.log(JSON.stringify({ facts_in: facts.length, facts_out: outFacts.length, status: by(outFacts, "status"), trade: by(outFacts, "trade"), questions_in: questions.length, questions_out: outQ.length, q_trade: by(outQ, "t"), problems: problems.length }, null, 1));
if (problems.length) console.log(problems.slice(0, 20).join("\n"));
