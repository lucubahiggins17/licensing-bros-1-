// The PC voice connector (public/bro-voice.ps1) reports the address of its VoiceStudio tunnel here:
//   {code, url, voice?, stt?, machine?} -> {ok, voice}
// No sign-in: the connect code an admin copied from Admin → Settings → Bro's voice is the key. The address is checked
// (it must reach a speech server) before it's saved, and Bro's studio voice is switched on for students.
// verify_jwt is off for this function (the connector only has the public site key).
import { handler, HttpError, json, readBody } from "../_shared/common.ts";
import { cleanVoiceName, publicVoiceUrl, sameCode } from "../_shared/voiceServer.ts";
import { loadSavedVoice, saveVoice, switchVoiceOn } from "../_shared/voiceStore.ts";

Deno.serve(handler(async (req) => {
  const body = await readBody(req);
  const saved = (await loadSavedVoice(true)) || {};
  if (!saved.code || !sameCode(String(body.code || "").trim(), saved.code)) {
    throw new HttpError(403, "bad_code", "That connect code isn't right (or was replaced). Copy the command again from Admin → Settings → Bro's voice.");
  }
  const url = publicVoiceUrl(body.url);
  if (!url) throw new HttpError(400, "bad_request", "That isn't a public https address.");
  // Make sure the address really reaches a speech server before students depend on it
  try {
    const r = await fetch(`${url}/v1/audio/voices`, { signal: AbortSignal.timeout(15000) });
    await r.body?.cancel();
    if (r.status >= 500 || r.status === 404) throw new Error(String(r.status));
  } catch (e) {
    throw new HttpError(502, "unreachable", `The cloud couldn't reach your voice server at ${url} (${(e as Error)?.message || "no answer"}). Check that VoiceStudio is open, then run the connector again.`);
  }
  const voice = cleanVoiceName(body.voice) || saved.voice || "";
  const stt = body.stt === true;
  await saveVoice({ ...saved, url, voice, key: "", stt, connected_at: new Date().toISOString(), machine: String(body.machine || "").replace(/[^\w .-]/g, "").slice(0, 60) || "your PC" });
  await switchVoiceOn(stt);
  return json({ ok: true, voice, url });
}));
