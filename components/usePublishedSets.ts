"use client";
// Published tests and game decks from the admin AI builder, for the student's trade (or all trades) and state
// (or every state). Row-level security already hides sets the student's plan doesn't include.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { Pair, Question } from "@/lib/data";

export type GameDeck = { id: string; title: string; topic: string; is_free: boolean; pairs: Pair[] };
export type TestSet = { id: string; title: string; is_free: boolean; questions: Question[] };

const validQ = (q: any): q is Question =>
  !!q && typeof q.q === "string" && Array.isArray(q.c) && q.c.length >= 2 && Number.isInteger(q.a) && q.a >= 0 && q.a < q.c.length;

type Kind = "game" | "test";
type Out<K extends Kind> = K extends "game" ? GameDeck : TestSet;

export function usePublishedSets<K extends Kind>(kind: K, trade: string, state: string, enabled = true) {
  const [sets, setSets] = useState<Out<K>[] | null>(null);
  const [err, setErr] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setErr("");
    (async () => {
      try {
        const { data, error } = await supabase()
          .from("practice_sets")
          .select(kind === "game" ? "id,title,topic,is_free,pairs,created_at" : "id,title,is_free,questions,created_at")
          .eq("published", true)
          .eq("kind", kind)
          .in("trade", [trade, "all"])
          .or(`state.is.null,state.eq."${String(state || "").replace(/"/g, "")}"`)
          .order("created_at", { ascending: false })
          .limit(60);
        if (error) throw error;
        if (!alive) return;
        const rows = (data || []) as any[];
        const list = kind === "game"
          ? rows.map((x) => ({
              id: x.id, title: String(x.title || "Game deck"), topic: String(x.topic || ""), is_free: !!x.is_free,
              pairs: (Array.isArray(x.pairs) ? x.pairs : [])
                .filter((c: any) => c && typeof c.k === "string" && typeof c.v === "string" && c.k.trim() && c.v.trim())
                .map((c: any) => ({ t: trade as Pair["t"], k: c.k.trim(), v: c.v.trim() }))
            })).filter((d) => d.pairs.length >= 3)
          : rows.map((x) => ({
              id: x.id, title: String(x.title || "Practice test"), is_free: !!x.is_free,
              questions: (Array.isArray(x.questions) ? x.questions : []).filter(validQ).map((q: Question) => ({ ...q, src: "set" as const }))
            })).filter((t) => t.questions.length > 0);
        setSets(list as Out<K>[]);
      } catch {
        if (alive) { setSets([]); setErr("Couldn't load Licensing Bro's sets. Check your connection and try again."); }
      }
    })();
    return () => { alive = false; };
  }, [kind, trade, state, enabled, reload]);

  return { sets, err, retry: () => setReload((n) => n + 1) };
}
