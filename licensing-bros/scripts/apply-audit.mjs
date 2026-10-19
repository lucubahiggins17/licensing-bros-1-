// Applies independent-audit results (knowledge/audits/*.json) to the built knowledge base files.
// Run after build-kb.mjs:  node scripts/apply-audit.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const KB = path.join(ROOT, "supabase/functions/_shared/kb.json");
const QF = path.join(ROOT, "lib/kb-questions.json");
const kb = JSON.parse(fs.readFileSync(KB, "utf8"));
let qs = JSON.parse(fs.readFileSync(QF, "utf8"));
const dir = path.join(ROOT, "knowledge/audits");
const log = { qFix: 0, qRemove: 0, fFix: 0, fUnverify: 0, fRemove: 0, skipped: [] };
const removeQ = new Set(), removeF = new Set();

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  for (const it of r.questions || []) {
    const q = qs[it.i];
    if (!q) { log.skipped.push(`${file} q${it.i}`); continue; }
    if (it.action === "remove") { removeQ.add(it.i); log.qRemove++; continue; }
    const next = { ...q, ...(it.fixed || {}) };
    const ok = Array.isArray(next.c) && next.c.length === 4 && Number.isInteger(next.a) && next.a >= 0 && next.a <= 3;
    if (!ok) { removeQ.add(it.i); log.qRemove++; log.skipped.push(`${file} q${it.i} invalid fix, removed`); continue; }
    qs[it.i] = { ...next, ref: String(next.ref).slice(0, 60) }; log.qFix++;
  }
  for (const it of r.facts || []) {
    const f = kb.facts.find((x) => x.id === it.id);
    if (!f) { log.skipped.push(`${file} ${it.id}`); continue; }
    if (it.action === "remove") { removeF.add(it.id); log.fRemove++; continue; }
    Object.assign(f, it.fixed || {});
    if (it.action === "unverify") { f.status = "unverified"; f.note = f.note || it.reason || "Flagged in review"; log.fUnverify++; }
    else log.fFix++;
    f.reviewed = it.reason || "fixed in review";
  }
}
qs = qs.filter((_, i) => !removeQ.has(i));
kb.facts = kb.facts.filter((f) => !removeF.has(f.id));
fs.writeFileSync(KB, JSON.stringify(kb));
fs.writeFileSync(QF, JSON.stringify(qs));
console.log(JSON.stringify({ ...log, skipped: log.skipped.length, facts: kb.facts.length, questions: qs.length }, null, 1));
if (log.skipped.length) console.log(log.skipped.join("\n"));
