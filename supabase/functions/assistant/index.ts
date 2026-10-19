// Bro Command: the AI command center for admins and instructors. Streams newline-delimited JSON events:
//   {t:"text", d}                       reply text as it's written
//   {t:"tool", name, label, status}     a lookup or draft running ("start" / "done" / "error")
//   {t:"card", card}                    results to show (students, stats, created drafts)
//   {t:"action", action}                something that waits for Confirm (announcement, email, class…)
//   {t:"done", history}                 conversation to send back next time
// Body: {action:"chat", message, history?, tz?, voice?} | {action:"confirm"|"cancel", id, tz?}
import { adminClient, anthropic, cors, handler, HttpError, json, MODEL, readBody, requireUser, staffRole } from "../_shared/common.ts";
import { allStudents, commandSystem, type Role, type ToolCtx, toolByName, toolDefs } from "../_shared/assistant.ts";
import { cleanHistory } from "../_shared/logic.ts";

const CACHE = { type: "ephemeral" } as const;

function validTz(tz: unknown): string {
  const t = typeof tz === "string" ? tz.trim() : "";
  try { if (t) { new Intl.DateTimeFormat("en-US", { timeZone: t }); return t; } } catch { /* fall through */ }
  return "America/Chicago";
}

Deno.serve(handler(async (req) => {
  const { user } = await requireUser(req);
  const role = await staffRole(user.id);
  if (!role) throw new HttpError(403, "forbidden", "The command center is for admins and instructors.");
  const body = await readBody(req);
  const db = adminClient();
  const { data: prof } = await db.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const ctx: ToolCtx = { userId: user.id, role: role as Role, name: prof?.full_name || (user.email || "there").split("@")[0], tz: validTz(body.tz) };
  const action = String(body.action || "chat");

  // ---------------------------------------------------------------- confirm / cancel a prepared action
  if (action === "confirm" || action === "cancel") {
    const id = String(body.id || "");
    const { data: row } = await db.from("assistant_actions").select("*").eq("id", id).eq("created_by", user.id).maybeSingle();
    if (!row) throw new HttpError(404, "not_found", "That action isn't available anymore.");
    if (row.status !== "pending") return json({ ok: row.status === "done", status: row.status, message: row.result?.message || `Already ${row.status}.` });
    if (Date.now() - Date.parse(row.created_at) > 24 * 3600_000) {
      await db.from("assistant_actions").update({ status: "cancelled", decided_at: new Date().toISOString(), result: { message: "Expired" } }).eq("id", id);
      throw new HttpError(410, "expired", "That action is more than a day old. Ask again and I'll prepare it fresh.");
    }
    if (action === "cancel") {
      await db.from("assistant_actions").update({ status: "cancelled", decided_at: new Date().toISOString(), result: { message: "Cancelled" } }).eq("id", id);
      return json({ ok: true, status: "cancelled", message: "Cancelled. Nothing was sent or changed." });
    }
    const tool = toolByName(row.kind);
    if (!tool?.execute || (tool.adminOnly && role !== "admin")) throw new HttpError(403, "forbidden", "You can't do that one.");
    // Claim it first so a double tap can't run it twice
    const { data: claimed } = await db.from("assistant_actions").update({ status: "done", decided_at: new Date().toISOString() }).eq("id", id).eq("status", "pending").select("id");
    if (!claimed?.length) return json({ ok: false, status: "done", message: "That action already ran." });
    try {
      const message = await tool.execute(row.payload, ctx);
      await db.from("assistant_actions").update({ result: { message } }).eq("id", id);
      return json({ ok: true, status: "done", message });
    } catch (e) {
      const message = e instanceof HttpError ? e.message : "Something went wrong carrying that out.";
      await db.from("assistant_actions").update({ status: "failed", result: { message } }).eq("id", id);
      return json({ ok: false, status: "failed", message });
    }
  }

  // ---------------------------------------------------------------- morning briefing (no AI; fast)
  if (action === "brief") {
    const all = (await allStudents()).filter((x) => x.role === "student");
    const now = Date.now();
    const risky = all.filter((x) => x.risk === "high");
    const soon = all.filter((x) => x.days_to_exam !== null && x.days_to_exam >= 0 && x.days_to_exam <= 7);
    const fresh = all.filter((x) => now - Date.parse(x.joined) <= 864e5);
    const quiet = all.filter((x) => x.paid && x.days_inactive !== null && x.days_inactive >= 7);
    const { data: lives } = await db.from("lives").select("title, starts_at, status").neq("status", "ended")
      .gte("starts_at", new Date(now - 3 * 3600_000).toISOString()).lte("starts_at", new Date(now + 36 * 3600_000).toISOString()).order("starts_at").limit(3);
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: ctx.tz, hour: "numeric", hourCycle: "h23" }).format(new Date()));
    const first = ctx.name.split(/\s+/)[0];
    const suggestions: string[] = [];
    if (risky.length) suggestions.push(`Show me the ${risky.length} at-risk student${risky.length === 1 ? "" : "s"} and draft each a study plan`);
    if (soon.length) suggestions.push(`Remind the ${soon.length} student${soon.length === 1 ? "" : "s"} with an exam this week to take a mock exam`);
    if (quiet.length) suggestions.push(`Nudge the ${quiet.length} paid student${quiet.length === 1 ? "" : "s"} who haven't studied in a week`);
    if (!lives?.length) suggestions.push("Plan a live class on the toughest topic and schedule it");
    return json({
      greeting: `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, ${first}.`,
      items: [
        { label: "At risk", value: risky.length },
        { label: "Exams this week", value: soon.length },
        { label: "New today", value: fresh.length },
        { label: "Paid & quiet 7+ days", value: quiet.length }
      ],
      // deno-lint-ignore no-explicit-any
      classes: ((lives || []) as any[]).map((l) => `${l.title} · ${l.status === "live" ? "LIVE NOW" : new Date(l.starts_at).toLocaleString("en-US", { timeZone: ctx.tz, weekday: "short", hour: "numeric", minute: "2-digit" })}`),
      suggestions: suggestions.slice(0, 3)
    });
  }

  // ---------------------------------------------------------------- chat
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
  if (!message) throw new HttpError(400, "bad_request", "Ask me something.");
  const client = anthropic();
  const voice = body.voice === true;
  const nowLocal = new Date().toLocaleString("en-US", { timeZone: ctx.tz, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  const system = [{ type: "text", text: commandSystem(ctx, nowLocal, voice), cache_control: CACHE }];
  const tools = toolDefs(ctx.role);
  // deno-lint-ignore no-explicit-any
  (tools[tools.length - 1] as any).cache_control = CACHE;
  // deno-lint-ignore no-explicit-any
  let history: any[] = [...cleanHistory(body.history), { role: "user", content: [{ type: "text", text: message }] }];

  const enc = new TextEncoder();
  let cancelled = false;
  let current: { abort(): void } | null = null;
  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (ev: unknown) => { if (!cancelled) controller.enqueue(enc.encode(JSON.stringify(ev) + "\n")); };
      try {
        for (let round = 0; round < 8 && !cancelled; round++) {
          const s = client.messages.stream({ model: MODEL(), max_tokens: voice ? 700 : 1600, system: system as never, tools: tools as never, messages: history });
          current = s;
          for await (const ev of s) {
            if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") emit({ t: "text", d: ev.delta.text });
          }
          const final = await s.finalMessage();
          history = [...history, { role: "assistant", content: final.content }];
          if (final.stop_reason !== "tool_use") break;
          // deno-lint-ignore no-explicit-any
          const calls = (final.content as any[]).filter((b) => b.type === "tool_use");
          // deno-lint-ignore no-explicit-any
          const results: any[] = [];
          for (const c of calls) {
            const tool = toolByName(c.name);
            if (!tool || (tool.adminOnly && ctx.role !== "admin")) {
              results.push({ type: "tool_result", tool_use_id: c.id, content: "That tool isn't available to this person.", is_error: true });
              continue;
            }
            emit({ t: "tool", id: c.id, name: c.name, label: tool.label, status: "start" });
            try {
              if (tool.mode === "confirm") {
                const prep = await tool.prepare!(c.input || {}, ctx);
                const { data: row, error } = await db.from("assistant_actions").insert({ created_by: user.id, kind: tool.name, summary: prep.summary, payload: prep.payload }).select("id").single();
                if (error || !row) throw new HttpError(500, "server_error", "Couldn't save the action. Run the latest schema.sql in Supabase.");
                emit({ t: "tool", id: c.id, name: c.name, label: tool.label, status: "done" });
                emit({ t: "action", action: { id: row.id, kind: tool.name, summary: prep.summary, details: prep.details } });
                results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify({ status: "waiting_for_confirmation", summary: prep.summary, note: "Not done yet. It runs only when the person taps Confirm on the card." }) });
              } else {
                const r = await tool.run!(c.input || {}, ctx);
                emit({ t: "tool", id: c.id, name: c.name, label: tool.label, status: "done" });
                if (r.card) emit({ t: "card", card: r.card });
                results.push({ type: "tool_result", tool_use_id: c.id, content: r.text.slice(0, 12000) });
              }
            } catch (e) {
              const msg = e instanceof HttpError ? e.message : "That didn't work. Try again.";
              console.warn("assistant tool", c.name, (e as Error)?.message);
              emit({ t: "tool", id: c.id, name: c.name, label: tool.label, status: "error" });
              results.push({ type: "tool_result", tool_use_id: c.id, content: msg, is_error: true });
            }
          }
          history = [...history, { role: "user", content: results }];
          emit({ t: "text", d: "\n\n" });
        }
        emit({ t: "done", history: cleanHistory(history) });
      } catch (e) {
        console.error("assistant", (e as Error)?.message);
        const status = (e as { status?: number })?.status;
        emit({ t: "error", message: status === 429 || status === 529 ? "The AI is busy right now. Try again in a minute." : "Something interrupted me. Try again." });
      }
      try { controller.close(); } catch { /* already closed */ }
    },
    cancel() { cancelled = true; try { current?.abort(); } catch { /* closed */ } }
  });
  return new Response(out, { headers: { ...cors, "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}));
