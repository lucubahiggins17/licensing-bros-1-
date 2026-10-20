// Bro's research desk: studies one topic at a time on the open web and teaches the knowledge library what it
// learned, but only what a second, independent check could confirm from an official source.
//   1. Writer: searches official sources (boards, statutes, code publishers, OSHA/EPA, testing companies) and lists
//      specific findings, each with the page it came from.
//   2. Checker: a fresh model call that never saw the writer's reasoning re-checks every finding with its own
//      searches, corrects wrong numbers, and compares each one with the school's built-in facts and library.
//   3. Confirmed findings from official sources become a library document the tutor uses right away. Disputed
//      findings, anything that contradicts a built-in fact, and everything when "review first" is on wait for an admin.
// Topics come from questions students asked that the knowledge base couldn't answer well (logged by the tutor,
// with nothing that identifies the student), then from state topics for the states and trades students study.
import { adminClient, anthropic, FAST_MODEL, MODEL } from "./common.ts";
import { streamAnswer } from "./answer.ts";
import { formatFacts, searchFacts } from "./kb.ts";
import { embedPending, saveLibraryDocument, searchLibrary } from "./library.ts";
import { UNRELIABLE_DOMAINS } from "./logic.ts";
import {
  type Claim, finalText, gapKey, mergeVerdicts, parseJsonBlock, planResearch, readClaims, researchDocText, researchKey,
  type ResearchPick, researchTitle, scrubQuestion
} from "./researchLogic.ts";

export type ResearchRow = {
  id: string; topic: string; trade: string | null; state: string | null; origin: "schedule" | "gap" | "staff";
  gap_id: string | null; status: string; claims: Claim[]; summary: string | null; doc_id: string | null;
  flags: number; tokens: number; error: string | null; requested_by: string | null; created_at: string;
  started_at: string | null; finished_at: string | null;
};
export type ResearchOptions = { reviewFirst?: boolean };

const TRADE_NAMES: Record<string, string> = { gc: "general contractor", elec: "electrical", plumb: "plumbing", hvac: "HVAC / mechanical", law: "business and law" };
const STALE_MS = 15 * 60_000;
const DAY = 864e5;

/** Keeps work going after the response is sent (Supabase Edge Runtime), or just lets it run elsewhere. */
export function background(p: Promise<unknown>) {
  const safe = p.catch((e) => console.error("research", (e as Error)?.message));
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(safe);
}

/** Records a question the tutor couldn't answer well from its notes. No user id is kept. Never throws. */
export async function logGap(question: string, trade: string | null, state: string | null, reason: "weak" | "state") {
  try {
    const q = scrubQuestion(question);
    if (q.length < 12) return;
    const { error } = await adminClient().rpc("kb_log_gap", { p_key: gapKey(q, trade, state), p_question: q, p_trade: trade, p_state: state, p_reason: reason });
    if (error && !/kb_log_gap|does not exist|schema cache/i.test(error.message || "")) console.warn("kb_log_gap", error.message);
  } catch { /* the tutor never waits on this */ }
}

function webSearch(state: string | null, maxUses: number) {
  return {
    type: "web_search_20250305" as const,
    name: "web_search" as const,
    max_uses: maxUses,
    blocked_domains: UNRELIABLE_DOMAINS,
    ...(state ? { user_location: { type: "approximate" as const, region: state, country: "US" } } : {})
  };
}

async function ask(model: string, system: string, prompt: string, state: string | null, maxUses: number) {
  return await streamAnswer({
    client: anthropic(), model, maxTokens: 3000, send: () => {}, maxRounds: 6,
    system: [{ type: "text", text: system }],
    messages: [{ role: "user", content: prompt }],
    tools: [webSearch(state, maxUses)]
  });
}

export function writerPrompts(row: Pick<ResearchRow, "topic" | "trade" | "state" | "origin">, today: string) {
  const trade = TRADE_NAMES[row.trade || "gc"] || "contractor";
  const system = `You are the research desk for Licensing Bro's, a school that prepares people for U.S. contractor licensing exams. You find the specific facts exam candidates need, from official sources only: state licensing boards, state statutes and administrative codes (.gov and legislature sites), the code publishers (ICC, NFPA, IAPMO), OSHA, EPA, eCFR, and the testing companies (PSI, Prometric, Pearson VUE). Never use study-card, forum or Q&A sites. Each finding is one specific, checkable sentence (a number, date, code edition, dollar threshold, deadline or requirement) with the exact page it came from and a short exact quote from that page. Leave out anything you can't find on an official page. Today is ${today}.`;
  const subject = row.origin === "gap"
    ? `A student studying for the ${row.state ? `${row.state} ` : ""}${trade} exam asked: "${row.topic}". Find the facts needed to answer it correctly.`
    : `Research this for ${row.state ? `${row.state} ` : ""}${trade} exam candidates: ${row.topic}.`;
  const prompt = `${subject}

Search the web, then reply with only JSON inside <json></json> tags, like this:
<json>{"summary": "Two plain sentences on what you found.", "claims": [{"claim": "One specific sentence.", "source_url": "https://...", "source_title": "Page title", "quote": "Short exact quote from that page"}]}</json>
Give 3 to 8 findings. Fewer is fine when official sources are thin.`;
  return { system, prompt };
}

export function checkerPrompts(row: Pick<ResearchRow, "topic" | "state">, claims: { claim: string; source_url: string | null; quote: string | null }[], known: string, today: string) {
  const system = `You are an independent fact checker for a contractor licensing exam prep school. You did not write the findings below. Check each one yourself with web searches against official sources: state licensing board pages, statutes and administrative codes, ICC/NFPA/IAPMO, OSHA, EPA, eCFR, and testing company candidate bulletins. Be strict.
- "confirmed": an official page you checked states it.
- "corrected": an official page shows a different value; give the corrected sentence in "correction".
- "disputed": official sources contradict it and you can't give a reliable correction.
- "unclear": you couldn't find an official page either way.
Also compare every finding with the school's existing facts listed below and put the ids of any it contradicts in "conflicts". Today is ${today}.`;
  const prompt = `Topic: ${row.topic}${row.state ? ` (${row.state})` : ""}

Findings to check:
${claims.map((c, i) => `${i}. ${c.claim}${c.source_url ? ` (writer's source: ${c.source_url}${c.quote ? `; quote: "${c.quote}"` : ""})` : ""}`).join("\n")}

The school's existing facts on this topic:
${known || "(none found)"}

Reply with only JSON inside <json></json> tags:
<json>{"verdicts": [{"i": 0, "verdict": "confirmed", "correction": "", "source_url": "https://official page you checked", "source_title": "Page title", "official": true, "conflicts": [], "note": "One short line"}]}</json>`;
  return { system, prompt };
}

/** Publishes a study's kept findings as a library document (replacing an earlier one). Returns the document id. */
export async function publishStudy(row: Pick<ResearchRow, "id" | "topic" | "trade" | "state" | "summary" | "doc_id">, claims: Claim[]): Promise<string | null> {
  const db = adminClient();
  if (row.doc_id) await db.from("kb_docs").delete().eq("id", row.doc_id);
  const kept = claims.filter((c) => c.kept);
  if (!kept.length) return null;
  const doc = await saveLibraryDocument(null, {
    title: researchTitle(row.topic),
    trade: row.trade,
    state: row.state,
    kind: "research",
    source_url: kept.find((c) => c.source_url)?.source_url || null
  }, researchDocText(row.topic, row.state, claims, new Date(), row.summary || ""));
  // Meaning search for the new passages (small documents finish in one go; the library's Index button covers the rest)
  await embedPending(doc.doc_id, 30).catch(() => null);
  return doc.doc_id;
}

/** Runs one queued study start to finish and records the result. Safe to call twice: only one call claims it. */
export async function researchOne(rowIn: ResearchRow, o: ResearchOptions = {}): Promise<ResearchRow | null> {
  const db = adminClient();
  const { data: claimed } = await db.from("kb_research").update({ status: "running", started_at: new Date().toISOString(), error: null })
    .eq("id", rowIn.id).eq("status", "queued").select("*");
  const row = (claimed?.[0] as ResearchRow | undefined);
  if (!row) return null;
  const today = new Date().toISOString().slice(0, 10);
  let tokens = 0;
  const finish = async (patch: Partial<ResearchRow>) => {
    const { data } = await db.from("kb_research").update({ ...patch, tokens, finished_at: new Date().toISOString() }).eq("id", row.id).select("*").single();
    if (row.gap_id) await db.from("kb_gaps").update({ status: patch.status === "failed" ? "open" : "researched" }).eq("id", row.gap_id);
    return (data as ResearchRow) || null;
  };
  try {
    // 1. Writer (fast model first; the main model if the fast one can't search)
    const w = writerPrompts(row, today);
    let written;
    try { written = await ask(FAST_MODEL(), w.system, w.prompt, row.state, 5); }
    catch { written = await ask(MODEL(), w.system, w.prompt, row.state, 5); }
    tokens += written.tokens;
    const found = readClaims(parseJsonBlock(written.text));
    // The writer must point at real pages it saw; fill a missing link from its cited sources when there's only one
    if (written.sources.length === 1) for (const c of found.claims) c.source_url ??= written.sources[0].url;
    if (!found.claims.length) return await finish({ status: "nothing", summary: found.summary || "No findings from official sources.", claims: [], flags: 0 });

    // 2. Independent check, with what the school already teaches on this topic
    const facts = searchFacts(row.topic, { trade: row.trade || "gc", state: row.state || "", limit: 10 });
    const lib = await searchLibrary(row.topic, { trade: row.trade || undefined, state: row.state || undefined, limit: 4 }).catch(() => []);
    const known = [formatFacts(facts), lib.map((p) => `[library: ${p.ref}] ${p.text.slice(0, 600)}`).join("\n")].filter(Boolean).join("\n");
    const c = checkerPrompts(row, found.claims, known, today);
    const checked = await ask(MODEL(), c.system, c.prompt, row.state, 6);
    tokens += checked.tokens;
    const verdicts = parseJsonBlock(checked.text);
    if (!verdicts) throw new Error("The checker's reply couldn't be read.");
    const merged = mergeVerdicts(found.claims, verdicts, { reviewFirst: o.reviewFirst, knownFactIds: new Set(facts.map((f) => f.id)) });

    // 3. Publish what passed; hold the rest for a person
    const docId = merged.kept ? await publishStudy({ ...row, summary: found.summary }, merged.claims) : null;
    const usable = merged.claims.some((x) => x.verdict === "confirmed" || x.verdict === "corrected");
    const status = merged.kept ? "published" : usable || merged.flags ? "review" : "nothing";
    return await finish({ status, summary: found.summary, claims: merged.claims, flags: merged.flags, doc_id: docId });
  } catch (e) {
    return await finish({ status: "failed", error: String((e as Error)?.message || e).slice(0, 300) });
  }
}

/** Adds studies to the queue. */
export async function queueStudies(picks: (ResearchPick | { topic: string; trade: string | null; state: string | null; origin: "staff" | "gap"; gap_id?: string })[], requestedBy: string | null = null): Promise<ResearchRow[]> {
  if (!picks.length) return [];
  const db = adminClient();
  const { data, error } = await db.from("kb_research").insert(picks.map((p) => ({
    topic: p.topic.slice(0, 300), trade: p.trade, state: p.state, origin: p.origin, gap_id: p.gap_id || null, requested_by: requestedBy
  }))).select("*");
  if (error) throw new Error(/kb_research|does not exist|schema cache/i.test(error.message) ? "The research desk isn't set up yet. Rerun supabase/schema.sql in Supabase." : error.message);
  const gapIds = picks.map((p) => p.gap_id).filter(Boolean) as string[];
  if (gapIds.length) await db.from("kb_gaps").update({ status: "queued" }).in("id", gapIds);
  return (data || []) as ResearchRow[];
}

/** Marks studies stuck in "running" (the function timed out) as failed so they can be retried. */
export async function clearStale(now = Date.now()) {
  await adminClient().from("kb_research").update({ status: "failed", error: "Timed out. Retry it, or it will be picked again later.", finished_at: new Date(now).toISOString() })
    .eq("status", "running").lt("started_at", new Date(now - STALE_MS).toISOString());
}

/**
 * Picks and queues the next studies for the scheduled run (respecting the daily cap) and returns them.
 * The caller runs them (in the background, so the scheduler isn't kept waiting).
 */
export async function nextBatch(cfg: { per_run?: number; daily_cap?: number; gaps_first?: boolean }, now = Date.now()): Promise<{ rows: ResearchRow[]; note: string }> {
  const db = adminClient();
  await clearStale(now);
  const cap = Math.max(0, Math.min(48, Number(cfg.daily_cap ?? 4)));
  const perRun = Math.max(1, Math.min(4, Number(cfg.per_run ?? 1)));
  const { count } = await db.from("kb_research").select("id", { count: "exact", head: true }).neq("origin", "staff").gte("created_at", new Date(now - DAY).toISOString());
  const room = Math.min(perRun, cap - (count ?? 0));
  if (room <= 0) return { rows: [], note: `daily limit of ${cap} reached` };
  const [{ data: gaps }, { data: students }, { data: recent }] = await Promise.all([
    db.from("kb_gaps").select("id, question, trade, state, hits").eq("status", "open").order("hits", { ascending: false }).order("last_seen", { ascending: false }).limit(25),
    db.from("profiles").select("state, trade").limit(5000),
    db.from("kb_research").select("topic, trade, state").neq("status", "failed").gte("created_at", new Date(now - 120 * DAY).toISOString()).limit(5000)
  ]);
  const picks = planResearch({
    n: room,
    gaps: (gaps || []) as { id: string; question: string; trade: string | null; state: string | null; hits: number }[],
    students: (students || []) as { state: string | null; trade: string | null }[],
    recent: new Set(((recent || []) as { topic: string; trade: string | null; state: string | null }[]).map((r) => researchKey(r.topic, r.trade, r.state))),
    gapsFirst: cfg.gaps_first !== false,
    seed: Math.floor(now / DAY)
  });
  if (!picks.length) return { rows: [], note: "nothing new to study" };
  return { rows: await queueStudies(picks), note: "" };
}

/** Numbers for the admin screen and the weekly digest. */
export async function researchStats(now = Date.now()) {
  const db = adminClient();
  const since = new Date(now - 7 * DAY).toISOString();
  const [{ data: week }, { count: openGaps }, { count: review }, { count: total }] = await Promise.all([
    db.from("kb_research").select("status, claims, flags, tokens").gte("created_at", since).limit(1000),
    db.from("kb_gaps").select("id", { count: "exact", head: true }).eq("status", "open"),
    db.from("kb_research").select("id", { count: "exact", head: true }).eq("status", "review"),
    db.from("kb_research").select("id", { count: "exact", head: true }).eq("status", "published")
  ]);
  const rows = (week || []) as { status: string; claims: Claim[]; flags: number; tokens: number }[];
  return {
    studies_week: rows.length,
    learned_week: rows.reduce((n, r) => n + (Array.isArray(r.claims) ? r.claims.filter((c) => c.kept).length : 0), 0),
    flags_week: rows.reduce((n, r) => n + (r.flags || 0), 0),
    tokens_week: rows.reduce((n, r) => n + (r.tokens || 0), 0),
    open_gaps: openGaps ?? 0,
    waiting_review: review ?? 0,
    published_total: total ?? 0
  };
}

/** An admin's decision on a study: publish the chosen findings (by index), replacing any earlier document. */
export async function approveStudy(id: string, keep: number[], reviewer: string): Promise<ResearchRow> {
  const db = adminClient();
  const { data: row } = await db.from("kb_research").select("*").eq("id", id).maybeSingle();
  if (!row) throw new Error("That study doesn't exist.");
  const r = row as ResearchRow;
  const pick = new Set(keep.filter((i) => Number.isInteger(i)));
  const claims = (r.claims || []).map((c, i) => ({ ...c, kept: pick.has(i) }));
  const docId = await publishStudy(r, claims);
  const { data } = await db.from("kb_research").update({
    claims, doc_id: docId, status: docId ? "published" : "rejected", reviewed_by: reviewer, reviewed_at: new Date().toISOString(), flags: 0
  }).eq("id", id).select("*").single();
  return data as ResearchRow;
}

export { finalText };
