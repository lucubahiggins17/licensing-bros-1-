// Bro's research desk: topic planning, gap detection, reading model replies, and the publish-only-what-checks-out rule.
import { strict as assert } from "node:assert";
import {
  coverage, gapKey, gapReason, gapWorthy, isOfficialSource, mergeVerdicts, NATIONAL_TOPICS, parseJsonBlock, planResearch,
  readClaims, researchDocText, researchKey, researchTitle, scrubQuestion, STATE_TOPICS
} from "../../supabase/functions/_shared/researchLogic.ts";
import { checkerPrompts, writerPrompts } from "../../supabase/functions/_shared/research.ts";
import { isDue } from "../../supabase/functions/_shared/logic.ts";

Deno.test("planResearch: most-asked gaps first, then where students are, skipping anything studied recently", () => {
  const gaps = [
    { id: "g1", question: "What's the Georgia lien notice deadline?", trade: "gc", state: "Georgia", hits: 2 },
    { id: "g2", question: "Which NEC edition does Ohio use?", trade: "elec", state: "Ohio", hits: 9 }
  ];
  const students = [
    ...Array.from({ length: 5 }, () => ({ state: "Texas", trade: "elec" })),
    ...Array.from({ length: 2 }, () => ({ state: "Tennessee", trade: "gc" })),
    { state: null, trade: "gc" }
  ];
  const recent = new Set([researchKey(STATE_TOPICS.elec[0].replace("{state}", "Texas"), "elec", "Texas")]);
  const p = planResearch({ n: 5, gaps, students, recent });
  assert.equal(p.length, 5);
  assert.deepEqual(p.slice(0, 2).map((x) => x.gap_id), ["g2", "g1"]);
  assert.equal(p[0].origin, "gap");
  // Texas electrical (most students) comes before Tennessee GC, and its first topic was studied recently so it's skipped
  const texas = p.filter((x) => x.state === "Texas");
  assert.ok(texas.length >= 1);
  assert.ok(!texas.some((x) => x.topic === STATE_TOPICS.elec[0].replace("{state}", "Texas")));
  assert.ok(p.findIndex((x) => x.state === "Texas") < p.findIndex((x) => x.state === "Tennessee"));
  assert.ok(p.every((x) => !x.topic.includes("{state}")));
  // No duplicates
  assert.equal(new Set(p.map((x) => researchKey(x.topic, x.trade, x.state))).size, p.length);
});

Deno.test("planResearch: nobody signed up yet studies Tennessee GC; gaps can wait; national topics get mixed in", () => {
  const p = planResearch({ n: 6, gaps: [{ id: "g", question: "q about something long enough", trade: "gc", state: null, hits: 1 }], students: [], recent: new Set(), gapsFirst: false });
  assert.equal(p.length, 6);
  assert.ok(!p.some((x) => x.origin === "gap"));
  assert.ok(p.some((x) => x.state === "Tennessee" && x.trade === "gc"));
  assert.ok(p.some((x) => x.state === null && NATIONAL_TOPICS.some((t) => t.topic === x.topic)));
  assert.equal(planResearch({ n: 0, gaps: [], students: [], recent: new Set() }).length, 0);
});

Deno.test("gap detection: real exam questions with thin notes, never small talk", () => {
  assert.equal(gapWorthy("thanks!"), false);
  assert.equal(gapWorthy("why?"), false);
  assert.equal(gapWorthy("What is the retainage limit on private jobs in Georgia?"), true);
  assert.ok(coverage("minimum burial depth for PVC conduit under a driveway", ["Table 300.5 minimum cover: PVC under driveways 18 inches"]) >= 0.5);
  assert.ok(coverage("Georgia retainage limit private construction", ["Ladders must extend 3 feet above the landing"]) < 0.4);
  const fact = (f: string, state: string | null = null) => ({ fact: f, state });
  // State question with no fact for the student's state and nothing in the library
  assert.equal(gapReason({ question: "What is the license threshold in Georgia for contractors?", facts: [fact("Tennessee requires a license at $25,000", "Tennessee")], library: [], state: "Georgia", stateSensitive: true }), "state");
  // Well covered: no gap
  assert.equal(gapReason({ question: "How far must a ladder extend above the landing?", facts: [fact("Portable ladders must extend at least 3 feet above the upper landing surface")], library: [], state: "Ohio", stateSensitive: false }), null);
  // Thin coverage
  assert.equal(gapReason({ question: "What does the solar photovoltaic rapid shutdown requirement cover?", facts: [fact("Ladders must extend 3 feet")], library: [], state: "Ohio", stateSensitive: false }), "weak");
  assert.equal(gapReason({ question: "ok", facts: [], library: [], state: "Ohio", stateSensitive: false }), null);
});

Deno.test("scrubQuestion and gapKey: nothing personal kept; rewordings land on the same key", () => {
  const s = scrubQuestion("I'm bob@site.com, call 615-555-1212 — license 123456789 question   about bonds?");
  assert.ok(!s.includes("bob@") && !s.includes("555") && !s.includes("123456789"), s);
  assert.ok(s.includes("[email]") && s.includes("[phone]"));
  assert.ok(scrubQuestion("x".repeat(500)).length <= 240);
  assert.equal(gapKey("What is the Georgia lien notice deadline?", "gc", "Georgia"), gapKey("Georgia lien notice deadline — what is it", "gc", "Georgia"));
  assert.notEqual(gapKey("lien notice deadline", "gc", "Georgia"), gapKey("lien notice deadline", "gc", "Ohio"));
});

Deno.test("parseJsonBlock: tagged, fenced, or the last object in a chatty reply", () => {
  assert.deepEqual(parseJsonBlock(`Searching...\n<json>{"a": 1}</json>`), { a: 1 });
  assert.deepEqual(parseJsonBlock("Here you go:\n```json\n{\"b\": [1,2]}\n```"), { b: [1, 2] });
  assert.deepEqual(parseJsonBlock(`I found {some} things. {"claims": [{"claim": "x {y}"}]} done`), { claims: [{ claim: "x {y}" }] });
  assert.equal(parseJsonBlock("no json here"), null);
  assert.equal(parseJsonBlock(""), null);
});

Deno.test("isOfficialSource: government, code publishers and testing companies only", () => {
  for (const u of ["https://www.tn.gov/commerce/regboards/contractors.html", "https://www.ecfr.gov/current/title-29", "https://www.osha.gov/x", "https://codes.iccsafe.org/content/IBC2021P1", "https://www.nfpa.org/codes", "https://candidate.psiexams.com/bulletin", "https://www.legislature.ga.gov/x", "https://www.cslb.ca.gov/"]) assert.ok(isOfficialSource(u), u);
  for (const u of ["https://quizlet.com/123", "https://www.reddit.com/r/electricians", "https://someblog.com/nec", "not a url", null]) assert.ok(!isOfficialSource(u as string), String(u));
});

Deno.test("mergeVerdicts: only confirmed or corrected findings from official sources that don't contradict built-in facts get published", () => {
  const found = readClaims({
    summary: "Georgia rules.",
    claims: [
      { claim: "Georgia requires a license for residential work over $2,500.", source_url: "https://sos.ga.gov/a", source_title: "GA SOS", quote: "..." },
      { claim: "Georgia retainage on private jobs is capped at 10% until half done.", source_url: "https://someblog.com/x", quote: "" },
      { claim: "Georgia lien deadline is 30 days.", source_url: "https://www.legis.ga.gov/x", quote: "" },
      { claim: "Georgia contractors need $1M liability insurance.", source_url: "https://sos.ga.gov/b", quote: "" },
      { claim: "Georgia allows reciprocity with every state.", source_url: "https://sos.ga.gov/c", quote: "" },
      { claim: "x" }, // too short: dropped
      { claim: "Georgia's NEC edition is the 2023 NEC with amendments.", source_url: "https://dca.ga.gov/nec", quote: "" }
    ]
  });
  assert.equal(found.claims.length, 6);
  const verdicts = { verdicts: [
    { i: 0, verdict: "confirmed", source_url: "https://sos.ga.gov/a" },
    { i: 1, verdict: "confirmed" },                                                            // blog only: held
    { i: 2, verdict: "corrected", correction: "Georgia's lien filing deadline is 90 days after the last work.", source_url: "https://www.legis.ga.gov/x" },
    { i: 3, verdict: "disputed", note: "No statewide insurance minimum found" },
    { i: 4, verdict: "unclear" },
    { i: 5, verdict: "confirmed", source_url: "https://dca.ga.gov/nec", conflicts: ["elec-ga-01", "made-up-id"] }
  ] };
  const m = mergeVerdicts(found.claims, verdicts, { knownFactIds: new Set(["elec-ga-01"]) });
  assert.deepEqual(m.claims.map((c) => c.kept), [true, false, true, false, false, false]);
  assert.equal(m.kept, 2);
  assert.equal(m.flags, 2); // the disputed one and the one that contradicts a built-in fact
  assert.deepEqual(m.claims[5].conflicts, ["elec-ga-01"]); // ids the checker made up are ignored
  assert.equal(m.claims[2].correction, "Georgia's lien filing deadline is 90 days after the last work.");
  // Review-first holds everything
  assert.equal(mergeVerdicts(found.claims, verdicts, { reviewFirst: true }).kept, 0);
  // A missing or garbled verdict counts as unclear
  assert.equal(mergeVerdicts(found.claims, { verdicts: [] }).kept, 0);

  const text = researchDocText("Georgia lien and license rules", "Georgia", m.claims, new Date("2026-10-19T12:00:00Z"), found.summary);
  assert.ok(text.startsWith("# Georgia lien and license rules"));
  assert.ok(text.includes("Researched by Bro's research desk on 2026-10-19 for Georgia"));
  assert.ok(text.includes("90 days after the last work") && !text.includes("is 30 days"), "uses the correction");
  assert.ok(!text.includes("$1M") && !text.includes("reciprocity") && !text.includes("10%"));
  assert.ok(text.includes("Source: GA SOS (https://sos.ga.gov/a). Checked 2026-10-19."));
  assert.ok(researchTitle("x ".repeat(200)).length <= 200);
});

Deno.test("prompts: the writer cites official pages only; the checker sees the built-in facts and is told it didn't write the findings", () => {
  const w = writerPrompts({ topic: "Is a license needed for a $30,000 remodel?", trade: "gc", state: "Georgia", origin: "gap" }, "2026-10-19");
  assert.ok(w.system.includes("official sources only") && w.system.includes("Never use study-card"));
  assert.ok(w.prompt.includes("A student studying for the Georgia general contractor exam asked"));
  assert.ok(w.prompt.includes("<json>"));
  const c = checkerPrompts({ topic: "Georgia liens", state: "Georgia" }, [{ claim: "Lien deadline is 90 days.", source_url: "https://x.gov", quote: "ninety" }], "[law-ga-03] (verified) Liens within 90 days", "2026-10-19");
  assert.ok(c.system.includes("You did not write the findings"));
  assert.ok(c.prompt.includes("0. Lien deadline is 90 days. (writer's source: https://x.gov; quote: \"ninety\")"));
  assert.ok(c.prompt.includes("[law-ga-03]"));
});

Deno.test("isDue: the research desk runs every few hours", () => {
  const now = Date.parse("2026-10-19T15:00:00Z");
  assert.equal(isDue("knowledge_research", { every_hours: 6 }, null, now), true);
  assert.equal(isDue("knowledge_research", { every_hours: 6 }, new Date(now - 2 * 3600e3).toISOString(), now), false);
  assert.equal(isDue("knowledge_research", { every_hours: 6 }, new Date(now - 6 * 3600e3 + 60e3).toISOString(), now), true); // a few minutes early is fine
  assert.equal(isDue("knowledge_research", {}, new Date(now - 5 * 3600e3).toISOString(), now), false); // default 6 hours
});

import { dropDuplicates, duplicateOf, numbersIn } from "../../supabase/functions/_shared/researchLogic.ts";
Deno.test("no duplicates: the same rule with the same numbers isn't published twice; a different number or state is new", () => {
  assert.deepEqual(numbersIn("A license is required for jobs of $25,000 or more, within 30 days"), ["25000", "30"]);
  const known = [
    { ref: "TN-LIC-01", text: "Tennessee requires a contractor license for projects of $25,000 or more.", state: "Tennessee" },
    { ref: "OSHA-12", text: "Portable ladders must extend at least 3 feet above the upper landing surface.", state: null }
  ];
  // Same rule, same number, same state
  assert.equal(duplicateOf("In Tennessee a contractor license is required for projects of $25,000 or more.", "Tennessee", known), "TN-LIC-01");
  // Different number: new information (or a change), not a duplicate
  assert.equal(duplicateOf("Tennessee requires a contractor license for projects of $50,000 or more.", "Tennessee", known), null);
  // Different state: not a duplicate of Tennessee's rule
  assert.equal(duplicateOf("Georgia requires a contractor license for projects of $25,000 or more.", "Georgia", known), null);
  // A state finding that just repeats the national rule is a duplicate
  assert.equal(duplicateOf("Portable ladders must extend at least 3 feet above the upper landing surface.", "Ohio", known), "OSHA-12");
  const claims = [
    { claim: "In Tennessee a contractor license is required for projects of $25,000 or more.", kept: true },
    { claim: "Tennessee contractor licenses renew every 2 years.", kept: true },
    { claim: "Not kept anyway.", kept: false }
  ].map((c) => ({ source_url: null, source_title: null, verdict: "confirmed" as const, conflicts: [], official: true, ...c }));
  const d = dropDuplicates(claims, "Tennessee", () => known);
  assert.equal(d.duplicates, 1);
  assert.equal(d.kept, 1);
  assert.equal(d.claims[0].duplicate, "TN-LIC-01");
  assert.equal(d.claims[0].kept, false);
  assert.equal(d.claims[1].kept, true);
});

import { describeAiError, retryableAiError } from "../../supabase/functions/_shared/logic.ts";
import { sttConfig, transcriptionRequest, transcriptionUrl, transcriptText } from "../../supabase/functions/_shared/voiceServer.ts";
Deno.test("describeAiError: staff see the real reason an answer failed", () => {
  const sdk = { status: 404, error: { type: "error", error: { type: "not_found_error", message: "model: claude-x" } }, message: "404 {...}" };
  assert.equal(describeAiError(sdk), "404 not_found_error: model: claude-x");
  assert.equal(describeAiError(new Error("socket hang up")), "socket hang up");
  assert.equal(describeAiError({ status: 529, error: { error: { type: "overloaded_error", message: "Overloaded" } } }), "529 overloaded_error: Overloaded");
  assert.equal(retryableAiError({ status: 529 }), true);
  assert.equal(retryableAiError({ status: 400 }), false);
  assert.equal(retryableAiError(new Error("network timeout")), true);
});

Deno.test("clear-voice listening: transcription settings, address and reply cleanup", () => {
  const env = (m: Record<string, string>) => (k: string) => m[k];
  assert.equal(sttConfig(env({})), null);
  // Same server as the studio voice by default, with its key
  assert.deepEqual(sttConfig(env({ VOICE_API_URL: "https://bro.trycloudflare.com/", VOICE_API_KEY: "k1" })), { base: "https://bro.trycloudflare.com", key: "k1", model: "whisper-1" });
  // Its own server: the studio voice key isn't sent there
  assert.deepEqual(sttConfig(env({ VOICE_API_URL: "https://a.example", VOICE_API_KEY: "k1", STT_API_URL: "https://api.openai.com/v1", STT_MODEL: "gpt-4o-mini-transcribe" })), { base: "https://api.openai.com/v1", key: "", model: "gpt-4o-mini-transcribe" });
  assert.equal(transcriptionUrl("https://x.example"), "https://x.example/v1/audio/transcriptions");
  assert.equal(transcriptionUrl("https://api.openai.com/v1"), "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(transcriptionUrl("https://x.example/v1/audio/speech"), "https://x.example/v1/audio/transcriptions");
  const req = transcriptionRequest({ base: "https://x", key: "k", model: "whisper-1" }, new Uint8Array([1, 2, 3]), "audio/webm;codecs=opus");
  const form = req.body as FormData;
  assert.equal((form.get("file") as File).name, "question.webm");
  assert.equal(form.get("model"), "whisper-1");
  assert.ok(String(form.get("prompt")).includes("GFCI"));
  assert.equal((req.headers as Record<string, string>).authorization, "Bearer k");
  assert.equal(transcriptText('{"text":"  How deep is a trench?  "}'), "How deep is a trench?");
  assert.equal(transcriptText("plain words here"), "plain words here");
  assert.equal(transcriptText('{"text":"Thanks for watching!"}'), "");
  assert.equal(transcriptText('{"text":"Contractor licensing exam prep with Bro. NEC, GFCI"}'), "");
});
