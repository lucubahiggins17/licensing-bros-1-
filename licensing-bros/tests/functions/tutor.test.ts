// Tutor state cross-check heuristic, web sources, prompt options, and AI output validation.
import { strict as assert } from "node:assert";
import {
  collectSources,
  formatSources,
  needsStateCheck,
  pickServiceKey,
  safePath,
  validatePairs,
  validateQuestions,
  validateQuiz,
  webSearchTool
} from "../../supabase/functions/_shared/logic.ts";
import { tutorSystem } from "../../supabase/functions/_shared/common.ts";

Deno.test("needsStateCheck: state-sensitive questions", () => {
  for (const q of [
    "Do I need a license for a $30,000 job?",
    "How long do I have to file a mechanic's lien?",
    "What's the notice of commencement deadline?",
    "How much is the contractor bond?",
    "Do I need workers comp with 3 employees?",
    "Does my state require a permit for a water heater swap?",
    "Which NEC edition did they adopt?",
    "Is there reciprocity with Georgia?",
    "How many years of experience do I need?",
    "How many continuing education hours?",
    "What's the rule in North Carolina?",
    "general liability insurance minimum"
  ]) assert.equal(needsStateCheck(q), true, q);
});

Deno.test("needsStateCheck: settled model-code questions don't search", () => {
  for (const q of [
    "What size conductor for a 30 amp circuit?",
    "Minimum stair riser height in the IRC?",
    "How far apart should guardrail posts be under OSHA?",
    "Explain the trap arm table"
  ]) assert.equal(needsStateCheck(q), false, q);
});

Deno.test("needsStateCheck: state-specific or unverified facts trigger a search", () => {
  assert.equal(needsStateCheck("explain retainage", [{ state: "Tennessee", status: "verified" }]), true);
  assert.equal(needsStateCheck("explain retainage", [{ state: null, status: "unverified" }]), true);
  assert.equal(needsStateCheck("explain retainage", [{ state: null, status: "verified" }]), false);
});

Deno.test("webSearchTool: localized to the student's state, 3 uses max", () => {
  assert.deepEqual(webSearchTool("Tennessee"), {
    type: "web_search_20250305", name: "web_search", max_uses: 3,
    user_location: { type: "approximate", region: "Tennessee", country: "US" }
  });
});

Deno.test("collectSources: cited pages first, deduped, max 5", () => {
  const content = [
    { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "tn contractor license threshold" } },
    { type: "web_search_tool_result", tool_use_id: "s1", content: [
      { type: "web_search_result", url: "https://www.tn.gov/commerce/regboards/contractors.html", title: "Contractors - TN.gov", encrypted_content: "x" },
      { type: "web_search_result", url: "https://example.com/blog", title: "Some blog", encrypted_content: "x" }
    ] },
    { type: "text", text: "In Tennessee, ", citations: null },
    { type: "text", text: "a license is required at $25,000.", citations: [
      { type: "web_search_result_location", url: "https://www.tn.gov/commerce/regboards/contractors.html", title: "Contractors - TN.gov", cited_text: "...", encrypted_index: "x" },
      { type: "web_search_result_location", url: "https://www.tn.gov/commerce/regboards/contractors.html#faq", title: "Contractors - TN.gov", cited_text: "...", encrypted_index: "x" }
    ] }
  ];
  const s = collectSources(content);
  assert.deepEqual(s, [{ title: "Contractors - TN.gov", url: "https://www.tn.gov/commerce/regboards/contractors.html" }]);
  assert.equal(formatSources(s), "\n\nSources:\n- Contractors - TN.gov — https://www.tn.gov/commerce/regboards/contractors.html");
});

Deno.test("collectSources: falls back to search results when nothing was cited; never more than 5", () => {
  const results = Array.from({ length: 8 }, (_, i) => ({ type: "web_search_result", url: `https://site${i}.gov/page`, title: `Page ${i}`, encrypted_content: "x" }));
  const s = collectSources([{ type: "web_search_tool_result", tool_use_id: "a", content: results }, { type: "text", text: "Answer." }]);
  assert.equal(s.length, 5);
  assert.equal(s[0].url, "https://site0.gov/page");
  assert.deepEqual(collectSources([{ type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "unavailable" } }]), []);
  assert.equal(formatSources([]), "");
});

Deno.test("tutorSystem: context, voice mode and state check", () => {
  const plain = tutorSystem("Tennessee", "General Contractor", "IBC", "", {});
  assert.ok(plain.includes('"Try this:"'));
  assert.ok(!plain.includes("STUDENT IS ASKING ABOUT:"));
  assert.ok(!plain.includes("web_search"));

  const full = tutorSystem("Tennessee", "General Contractor", "IBC", "[f1] fact", { voice: true, context: "Lesson: Lien law basics", webSearch: true });
  assert.ok(full.includes("STUDENT IS ASKING ABOUT:\nLesson: Lien law basics"));
  assert.ok(full.includes("VOICE MODE"));
  assert.ok(full.includes("120 words"));
  assert.ok(!full.includes('starting "Try this:"'));
  assert.ok(full.includes("web_search"));
  assert.ok(full.includes('"In Tennessee, ..."'));
  assert.ok(full.includes(".gov"));
});

Deno.test("validateQuestions: keeps good items, tags Business & Law as law", () => {
  const raw = [
    { section: "law", q: "Which form elects S corp status?", choices: ["1120", "2553", "8832", "SS-4"], answer: 1, topic: "Business", ref: "IRS Form 2553", why: "2553 is the election." },
    { section: "trade", q: "Max riser height (IRC)?", choices: ["7 in", "7.75 in", "8 in", "8.25 in"], answer: "1", topic: "Stairs", ref: "IRC R311.7.5.1", why: "" },
    { q: "Three choices only", choices: ["a", "b", "c"], answer: 0 },
    { q: "Bad answer index", choices: ["a", "b", "c", "d"], answer: 4 },
    { q: "", choices: ["a", "b", "c", "d"], answer: 0 },
    null
  ];
  const mix = validateQuestions(raw, { trade: "gc", part: "mix" });
  assert.equal(mix.length, 2);
  assert.equal(mix[0].t, "law");
  assert.equal(mix[1].t, "gc");
  assert.equal(mix[1].a, 1);
  assert.deepEqual(Object.keys(mix[0]).sort(), ["a", "c", "q", "ref", "t", "topic", "why"]);
  assert.ok(validateQuestions(raw, { trade: "elec", part: "law" }).every((q) => q.t === "law"));
  assert.ok(validateQuestions(raw, { trade: "elec", part: "trade" }).every((q) => q.t === "elec"));
  assert.deepEqual(validateQuestions("not an array", { trade: "gc", part: "mix" }), []);
});

Deno.test("validateQuiz: QuizItem shape, at most 5", () => {
  const item = { q: "What does GFCI protect against?", c: ["Shock", "Overload", "Arc", "Surge"], a: 0, why: "Ground faults." };
  const quiz = validateQuiz(Array(7).fill(item));
  assert.equal(quiz.length, 5);
  assert.deepEqual(quiz[0], item);
  assert.deepEqual(validateQuiz([{ q: "x", c: ["a", "b"], a: 0 }]), []);
});

Deno.test("validatePairs: trims, dedupes, skips avoided terms, caps count and length", () => {
  const raw = [
    { k: "  Retainage ", v: "Part of each payment held  back until the job is done." },
    { k: "retainage", v: "duplicate, different case" },
    { k: "Change order", v: "" },
    { term: "Lien waiver", definition: "Gives up lien rights for a payment." },
    { k: "Bid bond", v: "Guarantees the bidder signs the contract." },
    { k: "Performance bond", v: "x".repeat(400) },
    "junk",
    null
  ];
  const out = validatePairs(raw, { max: 10, avoid: ["Bid bond"], vMax: 220 });
  assert.deepEqual(out.map((x) => x.k), ["Retainage", "Lien waiver", "Performance bond"]);
  assert.equal(out[0].v, "Part of each payment held back until the job is done.");
  assert.equal(out[2].v.length, 220);
  assert.equal(validatePairs(raw, { max: 1 }).length, 1);
  assert.deepEqual(validatePairs({ k: "a", v: "b" }, { max: 5 }), []);
});

Deno.test("pairsPrompt: topic and national wording", async () => {
  const { pairsPrompt } = await import("../../supabase/functions/_shared/common.ts");
  const p = pairsPrompt(12, "any U.S. state (national model codes and federal rules only; skip state-specific rules)", "Electrical", "NEC 2023", [], "", "box fill");
  assert.ok(p.includes("12 term/definition pairs"));
  assert.ok(p.includes('topic "box fill"'));
  assert.ok(p.includes("in any U.S. state"));
  assert.ok(p.includes("Avoid these terms: none"));
});

Deno.test("pickServiceKey: new secret keys first, legacy key as fallback", () => {
  assert.equal(pickServiceKey('{"default":"sb_secret_abc","automations":"sb_secret_x"}', "eyJlegacy"), "sb_secret_abc");
  assert.equal(pickServiceKey('{"other":"sb_secret_only"}', "eyJlegacy"), "sb_secret_only");
  assert.equal(pickServiceKey(undefined, "eyJlegacy"), "eyJlegacy");
  assert.equal(pickServiceKey("not json", "eyJlegacy"), "eyJlegacy");
  assert.equal(pickServiceKey('{"default":""}', "eyJlegacy"), "eyJlegacy");
  assert.equal(pickServiceKey(null, null), "");
});

Deno.test("safePath: same-site paths only", () => {
  assert.equal(safePath("/course/?id=1&paid=1", "/x"), "/course/?id=1&paid=1");
  for (const bad of ["//evil.com", "https://evil.com", "javascript:alert(1)", "/\\evil.com", "", 42, null, "/a b"]) {
    assert.equal(safePath(bad, "/fallback"), "/fallback", String(bad));
  }
});
