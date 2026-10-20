// Bro's research desk, for staff (admins and instructors):
//   list         {}                          -> {studies, gaps, stats, automation}
//   queue        {topic, trade?, state?}     -> {study}   (starts right away, finishes in the background)
//   research_gap {gap_id}                    -> {study}
//   dismiss_gap  {gap_id}                    -> {ok}
//   retry        {id}                        -> {study}
//   approve      {id, keep: number[]}        -> {study}   (admins: publish the chosen findings)
//   reject       {id}                        -> {ok}      (admins: discard the study and its library document)
import { adminClient, handler, HttpError, json, readBody, requireUser, staffRole } from "../_shared/common.ts";
import { STATES } from "../_shared/logic.ts";
import { approveStudy, background, queueStudies, researchOne, researchStats, type ResearchRow } from "../_shared/research.ts";

const TRADES = new Set(["gc", "elec", "plumb", "hvac", "law"]);
const PER_PERSON_DAY = 15;

async function options() {
  const { data } = await adminClient().from("automations").select("config").eq("kind", "knowledge_research").maybeSingle();
  return { reviewFirst: (data?.config as Record<string, unknown> | undefined)?.review_first === true };
}

Deno.serve(handler(async (req) => {
  const { user } = await requireUser(req);
  const role = await staffRole(user.id);
  if (!role) throw new HttpError(403, "forbidden", "Only admins and instructors can use the research desk.");
  const body = await readBody(req);
  const action = String(body.action || "list");
  const db = adminClient();
  const one = async (id: unknown) => {
    const { data } = await db.from("kb_research").select("*").eq("id", String(id || "")).maybeSingle();
    if (!data) throw new HttpError(404, "not_found", "That study doesn't exist.");
    return data as ResearchRow;
  };
  const allowance = async () => {
    const { count } = await db.from("kb_research").select("id", { count: "exact", head: true }).eq("requested_by", user.id).gte("created_at", new Date(Date.now() - 864e5).toISOString());
    if ((count ?? 0) >= PER_PERSON_DAY) throw new HttpError(429, "limit", `That's ${PER_PERSON_DAY} studies today. More tomorrow.`);
  };
  const start = async (row: ResearchRow) => { background(researchOne(row, await options())); return row; };

  if (action === "list") {
    const [studies, gaps, auto, stats] = await Promise.all([
      db.from("kb_research").select("*").order("created_at", { ascending: false }).limit(40),
      db.from("kb_gaps").select("*").eq("status", "open").order("hits", { ascending: false }).order("last_seen", { ascending: false }).limit(30),
      db.from("automations").select("enabled, config, last_run_at, last_result").eq("kind", "knowledge_research").maybeSingle(),
      researchStats().catch(() => null)
    ]);
    if (studies.error) throw new HttpError(500, "not_set_up", "The research desk isn't set up yet. In Supabase, open SQL Editor, paste all of supabase/schema.sql and click Run (safe to rerun).");
    return json({ studies: studies.data || [], gaps: gaps.data || [], automation: auto.data || null, stats, role });
  }

  if (action === "queue") {
    const topic = String(body.topic || "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (topic.length < 8) throw new HttpError(400, "bad_request", "Say what to research in a few words, like \"Georgia lien notice deadlines\".");
    const trade = TRADES.has(String(body.trade)) ? String(body.trade) : null;
    const state = STATES.includes(String(body.state)) ? String(body.state) : null;
    await allowance();
    const [row] = await queueStudies([{ topic, trade, state, origin: "staff" }], user.id);
    return json({ study: await start(row) });
  }

  if (action === "research_gap") {
    const { data: gap } = await db.from("kb_gaps").select("*").eq("id", String(body.gap_id || "")).maybeSingle();
    if (!gap) throw new HttpError(404, "not_found", "That question isn't on the list anymore.");
    await allowance();
    const [row] = await queueStudies([{ topic: gap.question, trade: gap.trade, state: gap.state, origin: "gap", gap_id: gap.id }], user.id);
    return json({ study: await start(row) });
  }

  if (action === "dismiss_gap") {
    await db.from("kb_gaps").update({ status: "dismissed" }).eq("id", String(body.gap_id || ""));
    return json({ ok: true });
  }

  if (action === "retry") {
    const row = await one(body.id);
    if (!["failed", "nothing"].includes(row.status)) throw new HttpError(400, "bad_request", "Only failed or empty studies can be retried.");
    await allowance();
    const { data } = await db.from("kb_research").update({ status: "queued", error: null, requested_by: user.id }).eq("id", row.id).select("*").single();
    return json({ study: await start(data as ResearchRow) });
  }

  if (action === "approve" || action === "reject") {
    if (role !== "admin") throw new HttpError(403, "forbidden", "Only admins can publish or discard research.");
    const row = await one(body.id);
    if (["queued", "running"].includes(row.status)) throw new HttpError(400, "bad_request", "That study is still running.");
    if (action === "reject") {
      if (row.doc_id) await db.from("kb_docs").delete().eq("id", row.doc_id);
      await db.from("kb_research").update({ status: "rejected", doc_id: null, reviewed_by: user.id, reviewed_at: new Date().toISOString() }).eq("id", row.id);
      return json({ ok: true });
    }
    const keep = Array.isArray(body.keep) ? body.keep.map(Number).filter((n: number) => Number.isInteger(n) && n >= 0 && n < (row.claims || []).length) : [];
    return json({ study: await approveStudy(row.id, keep, user.id) });
  }

  throw new HttpError(400, "bad_request", "Unknown action.");
}));
