// Bro's studio voice: turns text into speech on the school's own voice server, any server that speaks the OpenAI
// audio API (POST /v1/audio/speech). That covers VoiceStudio (open source, can clone a voice; port 3900 by default),
// Kokoro-FastAPI, OpenAI itself, and others. Settings (function secrets): VOICE_API_URL (required), VOICE_API_KEY
// (if the server wants one, e.g. VoiceStudio's OMNIVOICE_API_KEY), VOICE_NAME (the voice; default "alloy"),
// VOICE_MODEL (default "tts-1"), VOICE_FORMAT (default "mp3"; falls back to "wav" if the server can't do mp3).

export type VoiceConfig = { base: string; key: string; voice: string; model: string; format: string };

export function voiceConfig(env: (k: string) => string | undefined = (k) => Deno.env.get(k)): VoiceConfig | null {
  const raw = (env("VOICE_API_URL") || "").trim();
  if (!raw) return null;
  let base: string;
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return null;
    base = u.toString().replace(/\/+$/, "");
  } catch { return null; }
  return {
    base,
    key: (env("VOICE_API_KEY") || "").trim(),
    voice: (env("VOICE_NAME") || "alloy").trim(),
    model: (env("VOICE_MODEL") || "tts-1").trim(),
    format: /^(mp3|wav|opus|aac|flac)$/.test((env("VOICE_FORMAT") || "").trim()) ? (env("VOICE_FORMAT") || "").trim() : "mp3"
  };
}

/** The speech endpoint, whether the URL was given with or without /v1 (or as the full endpoint). */
export function speechUrl(base: string): string {
  if (/\/audio\/speech$/.test(base)) return base;
  return /\/v1$/.test(base) ? `${base}/audio/speech` : `${base}/v1/audio/speech`;
}

/** Text ready for a voice: markdown, links and "Try this:" scaffolding out; at most 1,500 characters. */
export function speakable(text: unknown): string {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#>`|]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
}

export function speechRequest(c: VoiceConfig, text: string, speed: number, format = c.format): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...(c.key ? { authorization: `Bearer ${c.key}` } : {}) },
    body: JSON.stringify({ model: c.model, voice: c.voice, input: text, response_format: format, speed: Math.max(0.5, Math.min(2, Number(speed) || 1)) })
  };
}

export const AUDIO_TYPES: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", opus: "audio/ogg", aac: "audio/aac", flac: "audio/flac" };

// ---------------------------------------------------------------------------------------------
// Clear-voice listening: speech-to-text on the same kind of server (POST /v1/audio/transcriptions, the OpenAI audio
// format). VoiceStudio has it on the same port as its voices; OpenAI's Whisper works too. Settings: STT_API_URL
// (defaults to VOICE_API_URL), STT_API_KEY (defaults to VOICE_API_KEY when the URL is the same), STT_MODEL
// (default "whisper-1").
// ---------------------------------------------------------------------------------------------
export type SttConfig = { base: string; key: string; model: string };

export function sttConfig(env: (k: string) => string | undefined = (k) => Deno.env.get(k)): SttConfig | null {
  const own = (env("STT_API_URL") || "").trim();
  const raw = own || (env("VOICE_API_URL") || "").trim();
  if (!raw) return null;
  let base: string;
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return null;
    base = u.toString().replace(/\/+$/, "");
  } catch { return null; }
  return {
    base,
    key: ((own ? env("STT_API_KEY") : env("STT_API_KEY") || env("VOICE_API_KEY")) || "").trim(),
    model: (env("STT_MODEL") || "whisper-1").trim()
  };
}

export function transcriptionUrl(base: string): string {
  if (/\/audio\/transcriptions$/.test(base)) return base;
  const root = base.replace(/\/audio\/speech$/, "").replace(/\/v1$/, "");
  return `${root}/v1/audio/transcriptions`;
}

/** Words that come up on licensing exams, so the transcriber spells them right (NEC, GFCI, retainage...). */
export const STT_HINT = "Contractor licensing exam prep with Bro. NEC, GFCI, AFCI, IBC, IRC, IPC, UPC, IMC, IFGC, OSHA, EPA 608, PSI, Prometric, ampacity, conduit fill, box fill, voltage drop, grounding electrode, bonding, fixture units, trap arm, vent stack, backflow, BTU, CFM, superheat, subcooling, refrigerant, mechanic's lien, retainage, bid bond, performance bond, workers' comp, markup, margin.";

const EXT: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/aac": "aac", "audio/m4a": "m4a", "audio/x-m4a": "m4a" };

/** The multipart request for one recorded question. */
export function transcriptionRequest(c: SttConfig, audio: Uint8Array<ArrayBuffer>, mime: string): RequestInit {
  const type = (mime || "audio/webm").split(";")[0].trim().toLowerCase();
  const form = new FormData();
  form.append("file", new Blob([audio], { type }), `question.${EXT[type] || "webm"}`);
  form.append("model", c.model);
  form.append("language", "en");
  form.append("response_format", "json");
  form.append("prompt", STT_HINT);
  form.append("temperature", "0");
  return { method: "POST", headers: c.key ? { authorization: `Bearer ${c.key}` } : {}, body: form };
}

/** Text from a transcription reply (JSON {text} or plain text), with the usual hallucinations on silence removed. */
export function transcriptText(raw: string): string {
  let t = raw;
  try { const j = JSON.parse(raw); t = typeof j?.text === "string" ? j.text : ""; } catch { /* plain text */ }
  t = t.replace(/\s+/g, " ").trim();
  // Whisper-style models invent these on silence or noise
  if (/^(thanks for watching|thank you for watching|please subscribe|you|bye|\.+|\[.*\]|\(.*\))[.!]?$/i.test(t)) return "";
  if (t.includes("Contractor licensing exam prep with Bro")) return "";
  return t.slice(0, 2000);
}

// ---------------------------------------------------------------------------------------------
// The voice server's address can also come from the admin page or the PC connector (saved server-side in
// server_settings, key "voice"), so a new tunnel address needs no GitHub change or rebuild. When saved, it wins.
// ---------------------------------------------------------------------------------------------
export type SavedVoice = { url?: string; voice?: string; key?: string; code?: string; connected_at?: string; stt?: boolean; machine?: string };

/** Settings as the rest of this file reads them, with the saved address (and its voice and key) over GitHub's. */
export function withSaved(saved: SavedVoice | null | undefined, env: (k: string) => string | undefined = (k) => Deno.env.get(k)) {
  if (!saved?.url) return env;
  return (k: string) => {
    if (k === "VOICE_API_URL") return saved.url;
    if (k === "VOICE_NAME") return saved.voice || env(k);
    if (k === "VOICE_API_KEY") return saved.key || "";
    if (k === "STT_API_KEY" && !env("STT_API_URL")) return saved.key || "";
    return env(k);
  };
}

/** A public https address for the voice server (a tunnel or a host). Local and private addresses can't work from the cloud. */
export function publicVoiceUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:") return null;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || /^\[?[0-9a-f:]+\]?$/.test(h) && h.includes(":")) return null;
    if (!h.includes(".")) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "").replace(/\/(v1\/audio\/(speech|voices|transcriptions)|openapi\.json|docs)$/, "")}`;
  } catch { return null; }
}

/** Constant-time comparison for the connect code. */
export function sameCode(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || !a || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** A fresh connect code: 24 characters, easy to paste, impossible to guess. */
export function newConnectCode(): string {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

/** A voice name the speech API can take: VoiceStudio profile ids, OpenAI voice names. */
export const cleanVoiceName = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(v.trim()) ? v.trim() : "");
