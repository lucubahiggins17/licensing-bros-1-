// Bro's studio voice for signed-in students and staff:
//   {text, speed?}       -> audio (mp3 by default), spoken by the school's voice server
//   {action: "health"}   -> {configured, ok, ms, voice, error?}   (is the voice server reachable right now?)
// The server's address and key stay here as function secrets; the app never sees them.
import { cors, handler, HttpError, json, readBody, requireUser } from "../_shared/common.ts";
import { AUDIO_TYPES, speakable, speechRequest, speechUrl, voiceConfig } from "../_shared/voiceServer.ts";

const NOT_SET = "Bro's studio voice isn't set up. Add VOICE_API_URL in GitHub (see the Launch Guide), or keep using the phone's voice.";

Deno.serve(handler(async (req) => {
  await requireUser(req);
  const body = await readBody(req);
  const c = voiceConfig();

  const speak = async (text: string, speed: number, timeoutMs: number) => {
    let format = c!.format;
    let res = await fetch(speechUrl(c!.base), { ...speechRequest(c!, text, speed, format), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok && format !== "wav" && (res.status === 400 || res.status === 422)) {
      // Some servers only make WAV
      format = "wav";
      res = await fetch(speechUrl(c!.base), { ...speechRequest(c!, text, speed, format), signal: AbortSignal.timeout(timeoutMs) });
    }
    return { res, format };
  };

  if (body.action === "health") {
    if (!c) return json({ configured: false, ok: false, error: NOT_SET });
    const t0 = Date.now();
    try {
      const { res } = await speak("Hey, it's Bro. Ready when you are.", 1, 20000);
      const ok = res.ok && (res.headers.get("content-type") || "").startsWith("audio");
      await res.body?.cancel();
      return json({ configured: true, ok, ms: Date.now() - t0, voice: c.voice, ...(ok ? {} : { error: `The voice server answered ${res.status}.` }) });
    } catch (e) {
      return json({ configured: true, ok: false, ms: Date.now() - t0, voice: c.voice, error: (e as Error)?.name === "TimeoutError" ? "The voice server didn't answer within 20 seconds. Is the computer running it on, and the tunnel up?" : "Couldn't reach the voice server." });
    }
  }

  if (!c) throw new HttpError(503, "voice_not_set_up", NOT_SET);
  const text = speakable(body.text);
  if (!text) throw new HttpError(400, "bad_request", "Nothing to say.");
  let out;
  try { out = await speak(text, Number(body.speed) || 1, 25000); }
  catch { throw new HttpError(502, "voice_unavailable", "Bro's studio voice is offline right now."); }
  const { res, format } = out;
  if (!res.ok || !res.body) throw new HttpError(502, "voice_unavailable", `Bro's studio voice is offline right now (${res.status}).`);
  const type = res.headers.get("content-type") || "";
  return new Response(res.body, { headers: { ...cors, "content-type": type.startsWith("audio") ? type : AUDIO_TYPES[format] || "audio/mpeg", "cache-control": "no-store" } });
}));
