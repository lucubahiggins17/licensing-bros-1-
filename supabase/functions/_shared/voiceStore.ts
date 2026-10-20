// Where the voice server's saved settings live: server_settings (key "voice"), readable only by the server.
import { adminClient } from "./common.ts";
import type { SavedVoice } from "./voiceServer.ts";

let cache: { at: number; v: SavedVoice | null } | null = null;

export async function loadSavedVoice(fresh = false): Promise<SavedVoice | null> {
  if (!fresh && cache && Date.now() - cache.at < 15000) return cache.v;
  let v: SavedVoice | null = null;
  try {
    const { data, error } = await adminClient().from("server_settings").select("value").eq("key", "voice").maybeSingle();
    if (!error && data?.value && typeof data.value === "object") v = data.value as SavedVoice;
  } catch { /* table not created yet: GitHub settings only */ }
  cache = { at: Date.now(), v };
  return v;
}

export async function saveVoice(v: SavedVoice): Promise<void> {
  const { error } = await adminClient().from("server_settings").upsert({ key: "voice", value: v, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(/server_settings|does not exist|schema cache/i.test(error.message) ? "Rerun supabase/schema.sql in Supabase first (it adds a place to keep the voice server's address)." : error.message);
  cache = { at: Date.now(), v };
}

/** Switches Bro's studio voice (and clear-voice listening, when the server can transcribe) on for students. */
export async function switchVoiceOn(ears: boolean): Promise<void> {
  const db = adminClient();
  const { data } = await db.from("site_settings").select("value").eq("key", "voice").maybeSingle();
  const cur = (data?.value && typeof data.value === "object" ? data.value : {}) as Record<string, unknown>;
  await db.from("site_settings").upsert({ key: "voice", value: { ...cur, studio: true, ears: ears || cur.ears === true }, updated_at: new Date().toISOString() }, { onConflict: "key" });
}
