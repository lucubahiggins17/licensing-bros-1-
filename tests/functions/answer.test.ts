// The tutor's answer loop against a fake Messages API (real Anthropic SDK, streamed SSE): text streams through,
// calculator calls are answered exactly, and the answer continues after the calculation.
import { strict as assert } from "node:assert";
import Anthropic from "npm:@anthropic-ai/sdk@0.135.0";
import { streamAnswer } from "../../supabase/functions/_shared/answer.ts";
import { CALC_TOOL } from "../../supabase/functions/_shared/logic.ts";

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };

function sse(blocks: Block[], stop: string): string {
  const ev = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  let s = ev("message_start", { type: "message_start", message: { id: "msg_x", type: "message", role: "assistant", model: "fake", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } });
  blocks.forEach((b, index) => {
    if (b.type === "text") {
      s += ev("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
      for (const piece of b.text.match(/.{1,6}/gs) || []) s += ev("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: piece } });
    } else {
      s += ev("content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
      s += ev("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    }
    s += ev("content_block_stop", { type: "content_block_stop", index });
  });
  s += ev("message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } });
  s += ev("message_stop", { type: "message_stop" });
  return s;
}

Deno.test("streamAnswer: calculator round trip with the real SDK", async () => {
  // deno-lint-ignore no-explicit-any
  const requests: any[] = [];
  const ac = new AbortController();
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, signal: ac.signal, onListen: () => {} }, async (req) => {
    const body = await req.json();
    requests.push(body);
    const first = requests.length === 1;
    const text = first
      ? sse([{ type: "text", text: "Use VD = 2KIL/CM." }, { type: "tool_use", id: "toolu_1", name: "calculate", input: { expression: "2 * 12.9 * 16 * 150 / 6530", label: "voltage drop" } }], "tool_use")
      : sse([{ type: "text", text: "That's about 9.48 V, or 7.9% of 120 V." }], "end_turn");
    return new Response(text, { headers: { "content-type": "text/event-stream" } });
  });
  try {
    const client = new Anthropic({ apiKey: "test", baseURL: `http://127.0.0.1:${server.addr.port}`, maxRetries: 0 });
    let streamed = "";
    const r = await streamAnswer({
      client: client as never,
      model: "fake-model",
      system: [{ type: "text", text: "rules", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [{ type: "text", text: "Voltage drop for 150 ft of 12 AWG at 16 A?" }] }],
      tools: [CALC_TOOL],
      maxTokens: 500,
      send: (t) => { streamed += t; }
    });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].model, "fake-model");
    assert.equal(requests[0].tools[0].name, "calculate");
    assert.deepEqual(requests[0].system[0].cache_control, { type: "ephemeral" });
    // The second request carries the exact result back to the model
    const last = requests[1].messages.at(-1);
    assert.equal(last.role, "user");
    assert.equal(last.content[0].type, "tool_result");
    assert.equal(last.content[0].tool_use_id, "toolu_1");
    assert.ok(String(last.content[0].content).startsWith("voltage drop: 9.4823"), last.content[0].content);
    assert.equal(requests[1].messages.at(-2).role, "assistant");
    assert.equal(r.calculations, 1);
    assert.equal(streamed, "Use VD = 2KIL/CM. That's about 9.48 V, or 7.9% of 120 V.");
    assert.equal(r.text, streamed);
  } finally {
    ac.abort();
    await server.finished;
  }
});

Deno.test("streamAnswer: a bad expression goes back to the model as an error, and stops after max rounds", async () => {
  // deno-lint-ignore no-explicit-any
  const requests: any[] = [];
  const ac = new AbortController();
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, signal: ac.signal, onListen: () => {} }, async (req) => {
    requests.push(await req.json());
    return new Response(sse([{ type: "tool_use", id: `t${requests.length}`, name: "calculate", input: { expression: "12 ft * 2" } }], "tool_use"), { headers: { "content-type": "text/event-stream" } });
  });
  try {
    const client = new Anthropic({ apiKey: "test", baseURL: `http://127.0.0.1:${server.addr.port}`, maxRetries: 0 });
    const r = await streamAnswer({ client: client as never, model: "m", system: "s", messages: [{ role: "user", content: "x" }], tools: [CALC_TOOL], maxTokens: 100, send: () => {}, maxRounds: 3 });
    assert.equal(requests.length, 3);
    const res = requests[1].messages.at(-1).content[0];
    assert.equal(res.is_error, true);
    assert.ok(String(res.content).startsWith("Couldn't calculate"));
    assert.equal(r.calculations, 3);
  } finally {
    ac.abort();
    await server.finished;
  }
});
