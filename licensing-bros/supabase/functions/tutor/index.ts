// AI tutor: streams the answer back as plain text.
// Knowledge-base grounding, plan-based daily limits, optional context and voice mode, and a state
// cross-check with Anthropic web search when the answer can differ by state (sources appended at the end).
import {
  anthropic,
  cleanContext,
  collectSources,
  cors,
  dedupeSources,
  formatSources,
  handler,
  HttpError,
  isAdmin,
  MODEL,
  needsStateCheck,
  planLimits,
  readBody,
  requireActiveSession,
  requireUser,
  type Source,
  tutorSystem,
  useAiCredit,
  webSearchTool
} from "../_shared/common.ts";
import { formatFacts, searchFacts } from "../_shared/kb.ts";

type Turn = { role: "user" | "assistant"; content: string };
const INTERRUPTED = "\n\n[The answer was interrupted. Try again.]";

Deno.serve(handler(async (req) => {
  const { user } = await requireUser(req);
  const body = await readBody(req);
  const { state, trade, tradeName, refs } = cleanContext(body.state, body.trade);

  const raw: Turn[] = Array.isArray(body.messages) ? body.messages : [];
  const turns = raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-16)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }));
  while (turns.length && turns[0].role !== "user") turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== "user") throw new HttpError(400, "bad_request", "Ask a question first.");

  // Signed in on the current device (location is not checked for the tutor)
  await requireActiveSession(req, user.id);
  const [admin, limits] = await Promise.all([isAdmin(user.id), planLimits(user.id)]);
  const client = anthropic(); // 503 before counting usage when the AI isn't configured
  await useAiCredit(user.id, limits, admin);

  // deno-lint-ignore no-explicit-any
  const messages: any[] = turns.map((t) => ({ role: t.role, content: t.content }));
  const img = body.image;
  if (img && typeof img.data === "string" && /^image\/(jpeg|png|webp|gif)$/.test(img.mediaType) && img.data.length < 6_000_000) {
    const last = messages[messages.length - 1];
    last.content = [
      { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } },
      { type: "text", text: last.content }
    ];
  }

  const context = typeof body.context === "string" ? body.context.trim().slice(0, 6000) : "";
  const voice = body.voice === true;

  // Checked facts for this question (plus the previous one, for follow-ups like "why?") and the context
  const question = turns.filter((t) => t.role === "user").slice(-2).map((t) => t.content).join(" ");
  const facts = searchFacts(`${question} ${context.slice(0, 1500)}`, { trade, state, limit: 10 });
  const webSearch = needsStateCheck(`${question} ${context}`, facts);
  const system = tutorSystem(state, tradeName, refs, formatFacts(facts), { voice, context, webSearch });
  const tools = webSearch ? [webSearchTool(state)] : null;
  const maxTokens = voice ? 600 : webSearch ? 1800 : 1200;

  const enc = new TextEncoder();
  let current: { abort(): void } | null = null;
  let cancelled = false;

  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      let emitted = false;
      const sources: Source[] = [];
      const send = (t: string) => {
        if (cancelled || !t) return;
        controller.enqueue(enc.encode(t));
        emitted = true;
      };

      // Streams one answer; continues when a server tool pauses the turn. Only text reaches the client.
      const run = async (useTools: boolean) => {
        let msgs = messages;
        for (let round = 0; round < 3 && !cancelled; round++) {
          const s = client.messages.stream({
            model: MODEL(),
            max_tokens: maxTokens,
            system,
            messages: msgs,
            ...(useTools && tools ? { tools } : {})
          });
          current = s;
          for await (const ev of s) {
            if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") send(ev.delta.text);
          }
          const final = await s.finalMessage();
          sources.push(...collectSources(final.content as unknown[], 10));
          if (final.stop_reason !== "pause_turn") break;
          msgs = [...msgs, { role: "assistant", content: final.content }];
        }
      };

      try {
        await run(!!tools);
      } catch (e) {
        if (!cancelled) {
          if (tools && !emitted) {
            // e.g. web search not enabled for this API key: answer without it
            console.warn("tutor: retrying without web search", (e as Error)?.message);
            try { await run(false); } catch { send(INTERRUPTED); }
          } else {
            console.error("tutor stream", (e as Error)?.message);
            send(INTERRUPTED);
          }
        }
      }
      // Voice replies are read aloud, so links are left out there
      if (!voice && sources.length) send(formatSources(dedupeSources(sources, 5)));
      try { controller.close(); } catch { /* already closed */ }
    },
    cancel() {
      cancelled = true;
      try { current?.abort(); } catch { /* already closed */ }
    }
  });

  return new Response(out, { headers: { ...cors, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}));
