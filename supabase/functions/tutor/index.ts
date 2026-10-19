// AI tutor: streams the answer back as plain text.
// Knowledge-base grounding, plan-based daily limits, optional context and voice mode, smart model routing (fast model
// for quick lookups and voice, strongest model for reasoning), an exact calculator tool for code math, prompt caching,
// and a state cross-check with Anthropic web search when the answer can differ by state (sources appended at the end).
import {
  anthropic,
  CALC_TOOL,
  cleanContext,
  cors,
  dedupeSources,
  FAST_MODEL,
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
  routeTutor,
  ROUTING_ON,
  type Source,
  tutorParts,
  useAiCredit,
  webSearchTool
} from "../_shared/common.ts";
import { formatFacts, searchFacts } from "../_shared/kb.ts";
import { searchLibrary } from "../_shared/library.ts";
import { streamAnswer } from "../_shared/answer.ts";

type Turn = { role: "user" | "assistant"; content: string };
const INTERRUPTED = "\n\n[The answer was interrupted. Try again.]";
const CACHE = { type: "ephemeral" } as const;

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

  // Signed in on the current device (location is not checked for the tutor); checks run side by side
  const [, admin, limits] = await Promise.all([requireActiveSession(req, user.id), isAdmin(user.id), planLimits(user.id)]);
  const client = anthropic(); // 503 before counting usage when the AI isn't configured
  await useAiCredit(user.id, limits, admin);

  const context = typeof body.context === "string" ? body.context.trim().slice(0, 6000) : "";
  const voice = body.voice === true;
  const img = body.image;
  const hasImage = !!(img && typeof img.data === "string" && /^image\/(jpeg|png|webp|gif)$/.test(img.mediaType) && img.data.length < 6_000_000);

  // Checked facts for this question (plus the previous one, for follow-ups like "why?") and the context,
  // plus passages from the site's own knowledge library (uploaded documents), when it has any
  const question = turns.filter((t) => t.role === "user").slice(-2).map((t) => t.content).join(" ");
  const lookup = `${question} ${context.slice(0, 1500)}`;
  const [facts, library] = await Promise.all([
    Promise.resolve(searchFacts(lookup, { trade, state, limit: 12 })),
    searchLibrary(lookup, { trade, state, limit: 6 }).catch(() => [])
  ]);
  const webSearch = needsStateCheck(`${question} ${context}`, facts);
  const lastQuestion = turns[turns.length - 1].content;
  const route = ROUTING_ON() ? routeTutor({ question: lastQuestion, voice, image: hasImage, webSearch, turns: turns.length }) : "main";
  const notesText = [formatFacts(facts), library.map((p) => `[${p.ref}] ${p.text}`).join("\n")].filter(Boolean).join("\n");
  const { system, notes } = tutorParts(state, tradeName, refs, notesText, { voice, context, webSearch, calculator: true });
  const maxTokens = voice ? 600 : webSearch ? 1800 : 1400;

  // Messages: earlier turns as-is (cached), the latest question carries the notes and any photo
  // deno-lint-ignore no-explicit-any
  const messages: any[] = turns.map((t) => ({ role: t.role, content: t.content }));
  // deno-lint-ignore no-explicit-any
  const lastContent: any[] = [];
  if (hasImage) lastContent.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
  if (notes) lastContent.push({ type: "text", text: notes });
  lastContent.push({ type: "text", text: lastQuestion });
  messages[messages.length - 1] = { role: "user", content: lastContent };
  if (messages.length >= 3) {
    // Cache the conversation so far, so follow-up questions start answering sooner
    const prev = messages[messages.length - 2];
    prev.content = [{ type: "text", text: prev.content, cache_control: CACHE }];
  }
  const systemBlocks = [{ type: "text", text: system, cache_control: CACHE }];

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
      const run = async (model: string, useWeb: boolean) => {
        const r = await streamAnswer({
          client, model, maxTokens, send,
          // deno-lint-ignore no-explicit-any
          system: systemBlocks as any,
          messages,
          tools: [...(useWeb ? [webSearchTool(state)] : []), CALC_TOOL],
          cancelled: () => cancelled,
          onStream: (s) => { current = s; }
        });
        sources.push(...r.sources);
      };

      const primary = route === "fast" ? FAST_MODEL() : MODEL();
      try {
        await run(primary, webSearch);
      } catch (e) {
        if (!cancelled) {
          if (!emitted) {
            // e.g. web search not enabled for this API key, or the fast model isn't available: answer without them
            console.warn("tutor: retrying on the main model without web search", (e as Error)?.message);
            try { await run(MODEL(), false); } catch { send(INTERRUPTED); }
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

  return new Response(out, {
    headers: { ...cors, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-tutor-route": route }
  });
}));
