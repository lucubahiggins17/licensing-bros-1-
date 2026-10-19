"use client";
// The signed-in student's saved study record (the same row the study workspace keeps), shared by the
// dashboard cards on the home page so they make one request between them.
import { supabase } from "@/lib/supabaseClient";

const LOCAL = "licensingbros.progress";
let cache: { uid: string; at: number; p: Promise<unknown> } | null = null;

function readLocal(uid: string): unknown {
  for (const k of [`${LOCAL}.${uid}`, LOCAL]) {
    try { const v = JSON.parse(localStorage.getItem(k) || "null"); if (v) return v; } catch { /* storage blocked */ }
  }
  return null;
}

/** Raw progress data (normalize it with lib/progress). Falls back to this device's copy when offline. */
export function loadProgressRaw(uid: string): Promise<unknown> {
  if (cache && cache.uid === uid && Date.now() - cache.at < 4000) return cache.p;
  const p = (async () => {
    try {
      const { data, error } = await supabase().from("progress").select("data").eq("user_id", uid).maybeSingle();
      if (!error && data?.data) return data.data;
    } catch { /* offline */ }
    return readLocal(uid);
  })();
  cache = { uid, at: Date.now(), p };
  return p;
}
