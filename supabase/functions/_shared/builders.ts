// AI builders shared by the admin builder screens (generate function) and the command center (assistant function):
// practice tests and game decks grounded in the verified knowledge base plus the site's own library.
import { aiError, anthropic, cleanContext, examPrompt, MODEL, pairsPrompt, parseJSON, validatePairs, validateQuestions } from "./common.ts";
import { formatFacts, sampleFacts } from "./kb.ts";
import { searchLibrary } from "./library.ts";

export async function askModel(model: string, prompt: string, maxTokens: number, system?: string): Promise<string> {
  try {
    const msg = await anthropic().messages.create({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content: prompt }]
    });
    // deno-lint-ignore no-explicit-any
    return msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  } catch (e) {
    throw aiError(e);
  }
}

type BuildOpts = { trade?: unknown; state?: unknown; topic?: unknown; count: number };

function scope(o: BuildOpts) {
  const national = !(typeof o.state === "string" && o.state.trim());
  const ctx = cleanContext(o.state, o.trade);
  return {
    ...ctx,
    national,
    factState: national ? "__national__" : ctx.state,
    promptState: national ? "any U.S. state (national model codes and federal rules only; skip state-specific rules)" : ctx.state,
    topic: typeof o.topic === "string" ? o.topic.trim().slice(0, 80) : ""
  };
}

/** Checked facts plus matching passages from the site's library (for a topic), as prompt material. */
async function material(sc: ReturnType<typeof scope>, part: string, count: number): Promise<string> {
  const facts = formatFacts(sampleFacts({ trade: sc.trade, state: sc.factState, part, count, topic: sc.topic }));
  if (!sc.topic) return facts;
  const lib = await searchLibrary(sc.topic, { trade: sc.trade, state: sc.national ? undefined : sc.state, limit: 6 }).catch(() => []);
  return lib.length ? `${facts}\n${lib.map((p) => `[${p.ref}] ${p.text}`).join("\n")}` : facts;
}

export async function buildTest(o: BuildOpts & { part?: unknown }) {
  const sc = scope(o);
  const part = ["trade", "law", "mix"].includes(String(o.part)) ? String(o.part) : "mix";
  const count = Math.max(1, Math.min(50, Math.round(o.count) || 20));
  const facts = await material(sc, part, Math.min(80, count * 2));
  const text = await askModel(MODEL(), examPrompt(count, part, sc.promptState, sc.tradeName, sc.refs, facts, sc.topic), Math.min(16000, 600 + count * 340));
  const questions = validateQuestions(parseJSON(text), { trade: sc.trade, part }).slice(0, count);
  return { questions, trade: sc.trade, state: sc.national ? null : sc.state, part, topic: sc.topic };
}

export async function buildDeck(o: BuildOpts & { avoid?: string[] }) {
  const sc = scope(o);
  const count = Math.max(1, Math.min(40, Math.round(o.count) || 12));
  const avoid = (o.avoid || []).slice(0, 200).map((x) => String(x).slice(0, 60));
  const facts = await material(sc, "mix", Math.min(60, count * 3));
  const text = await askModel(MODEL(), pairsPrompt(count, sc.promptState, sc.tradeName, sc.refs, avoid, facts, sc.topic), Math.min(8000, 600 + count * 110));
  const pairs = validatePairs(parseJSON(text), { max: count, avoid, kMax: 60, vMax: 220 });
  return { pairs, trade: sc.trade, state: sc.national ? null : sc.state, topic: sc.topic };
}
