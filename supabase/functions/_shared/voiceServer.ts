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
