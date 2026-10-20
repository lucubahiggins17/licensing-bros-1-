// Streams one tutor answer from the Messages API. Text goes to `send` as it arrives. The loop continues when a server
// tool (web search) pauses the turn, or when the model asks the calculator; server-side web search sources are
// collected for the "Sources:" list. Kept apart from the HTTP handler so it can be tested against a fake API.
import { collectSources, runCalculator, type Source } from "./logic.ts";

export type StreamClient = {
  messages: {
    // deno-lint-ignore no-explicit-any
    stream(params: any): AsyncIterable<any> & { finalMessage(): Promise<any>; abort(): void };
  };
};

export type AnswerOptions = {
  client: StreamClient;
  model: string;
  // deno-lint-ignore no-explicit-any
  system: any;
  // deno-lint-ignore no-explicit-any
  messages: any[];
  // deno-lint-ignore no-explicit-any
  tools: any[];
  maxTokens: number;
  send: (text: string) => void;
  cancelled?: () => boolean;
  onStream?: (s: { abort(): void }) => void;
  maxRounds?: number;
};

export async function streamAnswer(o: AnswerOptions): Promise<{ sources: Source[]; calculations: number; text: string; tokens: number }> {
  const sources: Source[] = [];
  let msgs = o.messages;
  let calculations = 0;
  let text = "";
  let tokens = 0;
  const out = (t: string) => { if (t) { text += t; o.send(t); } };
  for (let round = 0; round < (o.maxRounds ?? 6) && !o.cancelled?.(); round++) {
    const s = o.client.messages.stream({
      model: o.model,
      max_tokens: o.maxTokens,
      system: o.system,
      messages: msgs,
      ...(o.tools.length ? { tools: o.tools } : {})
    });
    o.onStream?.(s);
    for await (const ev of s) {
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") out(ev.delta.text);
    }
    const final = await s.finalMessage();
    tokens += (Number(final.usage?.input_tokens) || 0) + (Number(final.usage?.output_tokens) || 0) + (Number(final.usage?.cache_read_input_tokens) || 0) + (Number(final.usage?.cache_creation_input_tokens) || 0);
    sources.push(...collectSources(final.content as unknown[], 10));
    if (final.stop_reason === "pause_turn") {
      msgs = [...msgs, { role: "assistant", content: final.content }];
      continue;
    }
    if (final.stop_reason === "tool_use") {
      // deno-lint-ignore no-explicit-any
      const calls = (final.content as any[]).filter((b) => b.type === "tool_use");
      if (!calls.length) break;
      const results = calls.map((c) => {
        const r = c.name === "calculate" ? runCalculator(c.input || {}) : { text: `Unknown tool ${c.name}`, isError: true };
        if (c.name === "calculate") calculations++;
        return { type: "tool_result", tool_use_id: c.id, content: r.text, ...(r.isError ? { is_error: true } : {}) };
      });
      // Keep the streamed text readable when the answer continues after a calculation
      if (text && !/\s$/.test(text)) out(" ");
      msgs = [...msgs, { role: "assistant", content: final.content }, { role: "user", content: results }];
      continue;
    }
    break;
  }
  return { sources, calculations, text, tokens };
}
