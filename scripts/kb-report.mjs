// Writes knowledge/kb.csv and KNOWLEDGE_BASE.md from the current knowledge base. Run: node scripts/kb-report.mjs
import fs from "node:fs";
import path from "node:path";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const kb = JSON.parse(fs.readFileSync(path.join(ROOT, "supabase/functions/_shared/kb.json"), "utf8"));
const qs = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/kb-questions.json"), "utf8"));
const F = kb.facts;
const cell = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
fs.writeFileSync(path.join(ROOT, "knowledge/kb.csv"), ["id,status,trade,topic,state,fact,source,note,review", ...F.map((f) => [f.id, f.status, f.trade, f.topic, f.state || "", f.fact, f.source, f.note, f.reviewed || ""].map(cell).join(","))].join("\n"));
const count = (arr, fn) => arr.reduce((m, x) => ((m[fn(x)] = (m[fn(x)] || 0) + 1), m), {});
const st = count(F, (f) => f.status), tr = count(F, (f) => f.trade), qt = count(qs, (q) => q.t);
const topics = Object.entries(count(F, (f) => `${f.trade === "law" ? "Business & Law" : "General contractor"} · ${f.topic}`)).sort();
const md = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const corrected = F.filter((f) => f.status === "corrected");
const unverified = F.filter((f) => f.status === "unverified");
const out = `# Licensing Bro's knowledge base

Generated ${kb.generated}. **${F.length} facts** (${st.verified || 0} verified, ${st.corrected || 0} corrected, ${st.unverified || 0} flagged as unconfirmed) and **${qs.length} new practice questions** (${qt.law || 0} Business & Law, shown to every trade; ${qt.gc || 0} General Contractor).

## Where it came from
Seven student-made NASCLA study sets (about 2,000 flashcards on OSHA safety, building codes, construction practice and contractor business law) were used only as a map of which topics the exam covers. Nothing was copied. Each card's underlying fact was checked against the actual source (OSHA 29 CFR 1926/1904, IBC 2021, IRC 2021, ADA 2010 Standards, IRS, DOL, USCIS, EPA and FAR rules, AIA A201, and accounting and contract-law fundamentals), then rewritten in original wording. A second, independent review then rechecked every question and every verified or corrected fact, and changed ${F.filter((f) => f.reviewed).length} facts and several questions.

- **verified**: confirmed correct as written.
- **corrected**: the flashcard's answer was wrong or outdated; the fact states the correct rule, and the note says what the card claimed.
- **unverified**: plausible but not confirmed (state-specific, edition-dependent or manufacturer guidance). The tutor uses these only with a "confirm in your reference book" warning, and they are never turned into practice questions.

Figures that change every year (OSHA penalty maximums, payroll tax wage bases, inflation-indexed limits) are dated in the fact, and practice questions avoid them.

## How the app uses it
- **AI tutor**: before answering, it looks up the most relevant facts for the student's question, trade and state (\`supabase/functions/_shared/kb.ts\`) and builds the answer on them, citing their source.
- **AI-written exams and flashcards**: the generator is handed a random spread of checked facts and must build most questions on them.
- **Verified question bank**: the ${qs.length} questions in \`lib/kb-questions.json\` are added to the built-in bank, so they work offline.
- State-specific facts (currently Georgia lien, licensing and tax rules) only appear for students who pick that state.

## Coverage by topic
| Topic | Facts |
|---|---|
${topics.map(([k, v]) => `| ${md(k)} | ${v} |`).join("\n")}

## Wrong or outdated answers found in the flashcards (${corrected.length})
These are worth knowing as a selling point: the free study sets your competitors' students use contain these errors.

| ID | Correct rule | What the card got wrong |
|---|---|---|
${corrected.map((f) => `| ${f.id} | ${md(f.fact)} | ${md(f.note)} |`).join("\n")}

## Flagged for review (${unverified.length})
Have a licensed reviewer (or the state bulletin) confirm these, then change \`status\` to \`verified\` for that ID in \`supabase/functions/_shared/kb.json\` (or in the CSV, then copy back) and run \`node scripts/kb-report.mjs\`.

| ID | State | Fact | Why it's flagged |
|---|---|---|---|
${unverified.map((f) => `| ${f.id} | ${f.state || "—"} | ${md(f.fact)} | ${md(f.note)} |`).join("\n")}

## Adding or fixing content
- The live files are \`supabase/functions/_shared/kb.json\` (facts) and \`lib/kb-questions.json\` (questions). Small fixes: edit them directly.
- New material: put the new batch files in \`knowledge/rounds/<name>-batches/\`, combine them into one round file, get it reviewed (\`knowledge/audits/\` shows the format), then run \`node scripts/append-kb.mjs knowledge/rounds/<round>.json knowledge/audits/<result>.json\`. Existing IDs never change.
- Then run \`node scripts/kb-report.mjs\` to refresh this report and the CSV.
- Commit and push. The GitHub workflow redeploys the tutor with the new facts and builds a new APK with the new questions.
- History: round 1 came from \`knowledge/batches\` via \`scripts/build-kb.mjs\` + \`scripts/apply-audit.mjs\`; don't re-run those, or later rounds would be lost.

\`knowledge/kb.csv\` opens in Excel or Google Sheets if you'd rather review everything in a spreadsheet.
`;
fs.writeFileSync(path.join(ROOT, "KNOWLEDGE_BASE.md"), out);
console.log("report written", F.length, qs.length, corrected.length, unverified.length);
