// Bro's studio voice: settings, endpoint and request in the OpenAI audio format (VoiceStudio, Kokoro, OpenAI...).
import { strict as assert } from "node:assert";
import { speakable, speechRequest, speechUrl, voiceConfig } from "../../supabase/functions/_shared/voiceServer.ts";

Deno.test("voiceConfig: needs a real http(s) address; sensible defaults for the rest", () => {
  assert.equal(voiceConfig(() => undefined), null);
  assert.equal(voiceConfig((k) => (k === "VOICE_API_URL" ? "not a url" : undefined)), null);
  assert.equal(voiceConfig((k) => (k === "VOICE_API_URL" ? "ftp://x.com" : undefined)), null);
  const c = voiceConfig((k) => ({ VOICE_API_URL: "https://bro-voice.trycloudflare.com/", VOICE_API_KEY: " sk-1 " } as Record<string, string>)[k]);
  assert.deepEqual(c, { base: "https://bro-voice.trycloudflare.com", key: "sk-1", voice: "alloy", model: "tts-1", format: "mp3" });
  const d = voiceConfig((k) => ({ VOICE_API_URL: "http://10.0.0.5:3900/v1", VOICE_NAME: "bro-clone", VOICE_FORMAT: "wav", VOICE_MODEL: "omnivoice" } as Record<string, string>)[k]);
  assert.equal(d?.voice, "bro-clone");
  assert.equal(d?.format, "wav");
  assert.equal(voiceConfig((k) => ({ VOICE_API_URL: "https://x.com", VOICE_FORMAT: "exe" } as Record<string, string>)[k])?.format, "mp3");
});

Deno.test("speechUrl: works with or without /v1, or the full endpoint", () => {
  assert.equal(speechUrl("http://127.0.0.1:3900"), "http://127.0.0.1:3900/v1/audio/speech");
  assert.equal(speechUrl("https://api.openai.com/v1"), "https://api.openai.com/v1/audio/speech");
  assert.equal(speechUrl("https://x.com/v1/audio/speech"), "https://x.com/v1/audio/speech");
});

Deno.test("speechRequest: OpenAI audio format, bearer key only when set, speed kept in range", () => {
  const c = { base: "http://x", key: "k", voice: "bro", model: "tts-1", format: "mp3" };
  const r = speechRequest(c, "Hello there.", 9);
  assert.equal((r.headers as Record<string, string>).authorization, "Bearer k");
  assert.deepEqual(JSON.parse(String(r.body)), { model: "tts-1", voice: "bro", input: "Hello there.", response_format: "mp3", speed: 2 });
  const n = speechRequest({ ...c, key: "" }, "Hi", 0.1, "wav");
  assert.equal((n.headers as Record<string, string>).authorization, undefined);
  assert.equal(JSON.parse(String(n.body)).response_format, "wav");
  assert.equal(JSON.parse(String(n.body)).speed, 0.5);
});

Deno.test("speakable: drops markdown, links and code; caps the length", () => {
  assert.equal(speakable("**GFCI** is required — see [NEC 210.8](https://nfpa.org/x) and https://foo.com/y"), "GFCI is required — see NEC 210.8 and");
  assert.equal(speakable("```js\ncode\n``` After"), "After");
  assert.equal(speakable("x ".repeat(2000)).length, 1500);
  assert.equal(speakable(null), "");
});

import { cleanVoiceName, newConnectCode, publicVoiceUrl, sameCode, sttConfig as sttCfg, voiceConfig as voiceCfg, withSaved } from "../../supabase/functions/_shared/voiceServer.ts";
Deno.test("PC connector: a saved tunnel address (and its voice) wins over GitHub settings, without GitHub's key", () => {
  const env = (m: Record<string, string>) => (k: string) => m[k];
  const gh = env({ VOICE_API_URL: "https://old.example", VOICE_API_KEY: "gh-key", VOICE_NAME: "alloy", VOICE_MODEL: "tts-1" });
  const c = voiceCfg(withSaved({ url: "https://brave-tiger.trycloudflare.com", voice: "lucu0001" }, gh))!;
  assert.equal(c.base, "https://brave-tiger.trycloudflare.com");
  assert.equal(c.voice, "lucu0001");
  assert.equal(c.key, "");
  assert.equal(c.model, "tts-1");
  assert.equal(sttCfg(withSaved({ url: "https://brave-tiger.trycloudflare.com" }, gh))!.base, "https://brave-tiger.trycloudflare.com");
  // Nothing saved: GitHub settings as before
  assert.equal(voiceCfg(withSaved(null, gh))!.base, "https://old.example");
  assert.equal(voiceCfg(withSaved({ code: "x" }, gh))!.key, "gh-key");
});

Deno.test("PC connector: only public https addresses, constant-time codes, safe voice names", () => {
  assert.equal(publicVoiceUrl("https://brave-tiger.trycloudflare.com/"), "https://brave-tiger.trycloudflare.com");
  assert.equal(publicVoiceUrl("https://brave-tiger.trycloudflare.com/openapi.json"), "https://brave-tiger.trycloudflare.com");
  assert.equal(publicVoiceUrl("https://voice.mysite.com/v1/audio/speech"), "https://voice.mysite.com");
  for (const bad of ["http://brave.trycloudflare.com", "https://localhost:3900", "https://127.0.0.1:3900", "https://192.168.1.20", "https://10.0.0.5", "https://myserver", "ftp://x.com", "", null]) assert.equal(publicVoiceUrl(bad), null, String(bad));
  assert.equal(sameCode("abc", "abc"), true);
  assert.equal(sameCode("abc", "abd"), false);
  assert.equal(sameCode("", ""), false);
  assert.equal(sameCode(undefined, "abc"), false);
  const a = newConnectCode(), b = newConnectCode();
  assert.equal(a.length, 24); assert.notEqual(a, b); assert.match(a, /^[a-z2-9]+$/);
  assert.equal(cleanVoiceName(" lucu0001 "), "lucu0001");
  assert.equal(cleanVoiceName("voice; rm -rf"), "");
});
