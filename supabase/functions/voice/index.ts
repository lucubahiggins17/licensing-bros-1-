// Bro's studio voice for signed-in students and staff:
//   {text, speed?}       -> audio (mp3 by default), spoken by the school's voice server
//   {action: "health"}   -> {configured, ok, ms, voice, error?, stt}   (is the voice server reachable right now?)
//   {action: "transcribe", audio: base64, mime} -> {text}   (clear-voice listening: the student's recorded question)
//   {action: "voice_admin", op: "get"|"save"|"new_code"|"forget", url?, voice?, key?}   (admins: the voice server's address)
// The server's address and key stay on the server (function secrets, or server_settings saved by the admin page or the
// PC connector); the app never sees them, except admins on the settings page.
import { cors, handler, HttpError, json, readBody, requireUser, staffRole } from "../_shared/common.ts";
import {
  AUDIO_TYPES, cleanVoiceName, DEFAULT_VOICE_NAME, newConnectCode, pickVoice, publicVoiceUrl, readVoices, type ServerVoice, speakable, speechRequest,
  speechUrl, sttConfig, transcriptionRequest, transcriptionUrl, transcriptText, type VoiceConfig, voiceConfig, withSaved
} from "../_shared/voiceServer.ts";
import { loadSavedVoice, saveVoice } from "../_shared/voiceStore.ts";

/** The voices the server has (cached a few minutes per server), so "Bro" can be found by name. */
const voiceCache = new Map<string, { at: number; list: ServerVoice[] }>();
async function serverVoices(c: VoiceConfig, fresh = false): Promise<ServerVoice[]> {
  const hit = voiceCache.get(c.base);
  if (!fresh && hit && Date.now() - hit.at < 300_000) return hit.list;
  let list: ServerVoice[] = [];
  try {
    const root = c.base.replace(/\/v1$/, "");
    const r = await fetch(`${root}/v1/audio/voices`, { headers: c.key ? { authorization: `Bearer ${c.key}` } : {}, signal: AbortSignal.timeout(8000) });
    if (r.ok) list = readVoices(await r.json());
    else await r.body?.cancel();
  } catch { /* the server may not list voices (OpenAI): use the configured voice as is */ }
  voiceCache.set(c.base, { at: Date.now(), list });
  return list;
}

const NOT_SET = "Bro's studio voice isn't connected. Run the voice connector on the PC with VoiceStudio (Admin → Settings → Bro's voice), or keep using the phone's voice.";

Deno.serve(handler(async (req) => {
  const { user } = await requireUser(req);
  const body = await readBody(req);
  const saved = await loadSavedVoice();
  const env = withSaved(saved);
  const c0 = voiceConfig(env);
  // Use the school's voice ("Bro", or the name an admin picked) whenever the server has it
  const prefer = saved?.prefer || DEFAULT_VOICE_NAME;
  const c = c0 && body.action !== "voice_admin" && body.action !== "transcribe" ? { ...c0, voice: pickVoice(await serverVoices(c0), c0.voice, prefer) } : c0;

  if (body.action === "voice_admin") {
    if ((await staffRole(user.id)) !== "admin") throw new HttpError(403, "forbidden", "Only admins can change the voice server.");
    const cur = (await loadSavedVoice(true)) || {};
    const op = String(body.op || "get");
    if (op === "new_code" || (op === "get" && !cur.code)) {
      const next = { ...cur, code: newConnectCode() };
      await saveVoice(next);
      Object.assign(cur, next);
    }
    if (op === "save") {
      const url = publicVoiceUrl(body.url);
      if (!url) throw new HttpError(400, "bad_request", "Use the public https address of your voice server (for example the trycloudflare.com address), not localhost.");
      const next = { ...cur, url, voice: cleanVoiceName(body.voice) || cur.voice || "", key: typeof body.key === "string" ? body.key.trim().slice(0, 300) : cur.key || "", connected_at: new Date().toISOString(), machine: "entered by hand" };
      await saveVoice(next);
      Object.assign(cur, next);
    }
    if (op === "prefer") {
      const name = String(body.name || "").trim().slice(0, 80);
      if (!name) throw new HttpError(400, "bad_request", "Pick a voice.");
      const next = { ...cur, prefer: name };
      await saveVoice(next);
      Object.assign(cur, next);
    }
    if (op === "forget") {
      const next = { code: cur.code };
      await saveVoice(next);
      for (const k of Object.keys(cur)) if (k !== "code") delete (cur as Record<string, unknown>)[k];
    }
    const github = !!Deno.env.get("VOICE_API_URL");
    // The voices on the connected server, and the one students hear
    const live = voiceConfig(withSaved(cur));
    const voices = live ? await serverVoices(live, op === "voices" || op === "prefer") : [];
    const preferName = cur.prefer || DEFAULT_VOICE_NAME;
    const using = live ? pickVoice(voices, live.voice, preferName) : null;
    return json({
      voices: voices.map((v) => ({ id: v.id, name: v.name, type: v.type })), prefer: preferName, using,
      usingName: voices.find((v) => v.id === using)?.name || using,
      source: cur.url ? "saved" : github ? "github" : "none",
      url: cur.url || null, voice: cur.voice || (cur.url ? null : Deno.env.get("VOICE_NAME") || null),
      connected_at: cur.connected_at || null, machine: cur.machine || null, stt: cur.stt ?? null, hasKey: !!cur.key,
      code: cur.code, github
    });
  }

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

  if (body.action === "transcribe") {
    const sc = sttConfig(env);
    if (!sc) throw new HttpError(503, "stt_not_set_up", "Clear-voice listening isn't set up. Add VOICE_API_URL (or STT_API_URL) in GitHub.");
    const b64 = typeof body.audio === "string" ? body.audio : "";
    if (!b64 || b64.length > 14_000_000) throw new HttpError(400, "bad_request", "That recording is missing or too long.");
    let audio: Uint8Array<ArrayBuffer>;
    try { const bin = atob(b64); audio = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) audio[i] = bin.charCodeAt(i); } catch { throw new HttpError(400, "bad_request", "That recording couldn't be read."); }
    let res: Response;
    try { res = await fetch(transcriptionUrl(sc.base), { ...transcriptionRequest(sc, audio, String(body.mime || "audio/webm")), signal: AbortSignal.timeout(30000) }); }
    catch (e) { throw new HttpError(502, "stt_unavailable", (e as Error)?.name === "TimeoutError" ? "The voice server took too long to understand that." : "Couldn't reach the voice server to understand that."); }
    const raw = await res.text();
    if (!res.ok) { console.error("transcribe", res.status, raw.slice(0, 300)); throw new HttpError(502, "stt_unavailable", `The voice server couldn't understand that recording (${res.status}).`); }
    return json({ text: transcriptText(raw) });
  }

  if (body.action === "health") {
    const stt = !!sttConfig(env);
    if (!c) return json({ configured: false, ok: false, error: NOT_SET, stt });
    const t0 = Date.now();
    try {
      const { res } = await speak("Hey, it's Bro. Ready when you are.", 1, 20000);
      const ok = res.ok && (res.headers.get("content-type") || "").startsWith("audio");
      await res.body?.cancel();
      return json({ configured: true, ok, ms: Date.now() - t0, voice: c.voice, stt, ...(ok ? {} : { error: `The voice server answered ${res.status}.` }) });
    } catch (e) {
      return json({ configured: true, ok: false, ms: Date.now() - t0, voice: c.voice, stt, error: (e as Error)?.name === "TimeoutError" ? "The voice server didn't answer within 20 seconds. Is the computer running it on, and the tunnel up?" : "Couldn't reach the voice server." });
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
