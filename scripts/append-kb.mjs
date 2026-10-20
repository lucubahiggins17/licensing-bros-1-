// Appends a reviewed batch round to the knowledge base without disturbing existing IDs.
// Usage: node scripts/append-kb.mjs <round.json> [<audit-result.json>]
//   round.json   {facts:[{id(temp), topic, trade, state, source, fact, status, note, keywords}], questions:[...]}
//   audit-result {questions:[{i, action, fixed}], facts:[{id, action, fixed}], existing?:[{id, action, fixed}]}  (same shape as knowledge/audits;
//                "existing" corrects facts already in the knowledge base)
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const KB = path.join(ROOT, "supabase/functions/_shared/kb.json");
const QF = path.join(ROOT, "lib/kb-questions.json");
const [roundFile, auditFile] = process.argv.slice(2);
const round = JSON.parse(fs.readFileSync(roundFile, "utf8"));
const audit = auditFile ? JSON.parse(fs.readFileSync(auditFile, "utf8")) : { questions: [], facts: [] };
const kb = JSON.parse(fs.readFileSync(KB, "utf8"));
const qs = JSON.parse(fs.readFileSync(QF, "utf8"));

// 1) apply the audit to the round
const dropQ = new Set(), dropF = new Set();
for (const it of audit.questions || []) {
  if (it.action === "remove") { dropQ.add(it.i); continue; }
  if (round.questions[it.i]) Object.assign(round.questions[it.i], it.fixed || {});
}
for (const it of audit.facts || []) {
  const f = round.facts.find((x) => x.id === it.id);
  if (!f) continue;
  if (it.action === "remove") { dropF.add(it.id); continue; }
  Object.assign(f, it.fixed || {});
  if (it.action === "unverify") { f.status = "unverified"; f.note = f.note || it.reason; }
  f.reviewed = it.reason || "fixed in review";
}

// 1b) corrections the auditor found in facts already in the knowledge base
let fixedExisting = 0;
for (const it of audit.existing || []) {
  const f = kb.facts.find((x) => x.id === it.id);
  if (!f || it.action === "keep") continue;
  if (it.action === "fix" && it.fixed) {
    for (const k of ["fact", "source", "keywords", "topic"]) if (it.fixed[k] !== undefined) f[k] = it.fixed[k];
    f.status = "verified";
  }
  if (it.action === "unverify") { f.status = "unverified"; f.note = String(it.reason || f.note || "").slice(0, 400); }
  f.reviewed = String(it.reason || "corrected in review").slice(0, 400);
  fixedExisting++;
}

// 2) dedupe against the existing knowledge base
const norm = (s) => new Set(String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2));
const jac = (a, b) => { let i = 0; for (const w of a) if (b.has(w)) i++; return i / (a.size + b.size - i || 1); };
const existing = kb.facts.map((f) => ({ f, t: norm(f.fact) }));
const prefix = (t) => t.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase();
const counters = {};
for (const f of kb.facts) { const [p, n] = f.id.split("-"); counters[p] = Math.max(counters[p] || 0, Number(n)); }
// Same rule twice (same trade, same state or both national, nearly the same words AND the same numbers) is a duplicate.
// Nearly the same words with different numbers is a conflict: not added, listed for a person to check.
const nums = (s) => [...new Set((String(s || "").match(/\d[\d,]*(?:\.\d+)?(?:\/\d+)?/g) || []).map((n) => n.replace(/,/g, "")))].sort().join(" ");
let addedF = 0, skippedF = 0;
const conflicts = [];
for (const f of round.facts) {
  if (dropF.has(f.id)) continue;
  const t = norm(f.fact);
  const near = existing.find((e) => e.f.trade === f.trade && (e.f.state || null) === (f.state || null) && jac(e.t, t) > 0.7);
  if (near) {
    if (nums(near.f.fact) !== nums(f.fact)) conflicts.push({ new: f.fact, existing: `${near.f.id}: ${near.f.fact}` });
    skippedF++; continue;
  }
  const p = prefix(f.topic); counters[p] = (counters[p] || 0) + 1;
  const nf = { id: `${p}-${String(counters[p]).padStart(3, "0")}`, topic: f.topic, trade: f.trade, state: f.state || null, source: String(f.source || ""), fact: String(f.fact).trim(), status: f.status, note: String(f.note || ""), keywords: (f.keywords || []).map(String).slice(0, 10) };
  if (f.reviewed) nf.reviewed = f.reviewed;
  kb.facts.push(nf); existing.push({ f: nf, t }); addedF++;
}

// 3) questions: validate + dedupe
const qt = qs.map((q) => norm(q.q + " " + q.c[q.a]));
let addedQ = 0;
round.questions.forEach((q, i) => {
  if (dropQ.has(i)) return;
  const ok = ["gc", "law", "elec", "plumb", "hvac"].includes(q.t) && Array.isArray(q.c) && q.c.length === 4 && new Set(q.c.map((x) => String(x).trim().toLowerCase())).size === 4 && Number.isInteger(q.a) && q.a >= 0 && q.a <= 3 && q.ref && q.why;
  if (!ok) return;
  const t = norm(q.q + " " + q.c[q.a]);
  if (qt.some((x) => jac(x, t) > 0.75)) return;
  qs.push({ t: q.t, topic: q.topic, q: q.q.trim(), c: q.c.map((x) => String(x).trim()), a: q.a, ref: String(q.ref).slice(0, 60), why: String(q.why).trim() });
  qt.push(t); addedQ++;
});

kb.generated = new Date().toISOString().slice(0, 10);
fs.writeFileSync(KB, JSON.stringify(kb));
fs.writeFileSync(QF, JSON.stringify(qs));
if (conflicts.length) console.error(`${conflicts.length} new fact(s) disagree with an existing fact on a number; not added, check them:\n` + conflicts.map((c) => `- NEW: ${c.new}\n  HAVE ${c.existing}`).join("\n"));
console.log(JSON.stringify({ addedFacts: addedF, skippedDuplicateFacts: skippedF, numberConflicts: conflicts.length, fixedExistingFacts: fixedExisting, addedQuestions: addedQ, totalFacts: kb.facts.length, totalQuestions: qs.length }));
