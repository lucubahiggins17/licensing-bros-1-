"use client";
// Data hooks for live classes: the live row, chat, calls to action and poll results, all kept fresh with Supabase Realtime.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { Live, LiveCta, LiveMessage } from "@/lib/types";
import { channelName } from "@/components/live/liveUtils";

/** Re-renders every `ms` milliseconds; returns Date.now(). */
export function useNow(ms = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, enabled]);
  return now;
}

export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const read = () => setVisible(document.visibilityState !== "hidden");
    read();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, []);
  return visible;
}

/** One live row plus realtime updates (status flips, edits, deletion). */
export function useLiveRow(id: string | null | undefined) {
  const [live, setLive] = useState<Live | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError(null);
    try {
      const { data, error: e } = await supabase().from("lives").select("*").eq("id", id).maybeSingle();
      if (e) throw e;
      setLive((data as Live) || null);
      setMissing(!data);
    } catch (e: any) {
      setError(navigator.onLine === false ? "You're offline. Check your connection and try again." : "We couldn't load this class. Try again.");
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    load();
    let ch: ReturnType<ReturnType<typeof supabase>["channel"]> | null = null;
    try {
      ch = supabase()
        .channel(channelName(`live-row-${id}`))
        .on("postgres_changes", { event: "*", schema: "public", table: "lives", filter: `id=eq.${id}` }, (payload: any) => {
          if (payload.eventType === "DELETE") { setLive(null); setMissing(true); return; }
          if (payload.new) setLive((prev) => ({ ...(prev || {}), ...(payload.new as Live) }));
        })
        .subscribe();
    } catch { /* not configured */ }
    // Coming back to the tab: catch anything realtime missed while asleep
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (ch) supabase().removeChannel(ch);
    };
  }, [id, load]);

  return { live, setLive, loading, error, missing, reload: load };
}

/** Last 100 chat messages + realtime inserts/deletes. */
export function useLiveChat(liveId: string | null | undefined, enabled: boolean) {
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback((m: LiveMessage) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m].slice(-300)));
  }, []);

  useEffect(() => {
    if (!liveId || !enabled) return;
    let cancelled = false;
    setLoading(true); setError(null);
    supabase()
      .from("live_messages").select("*").eq("live_id", liveId)
      .order("created_at", { ascending: false }).limit(100)
      .then(({ data, error: e }) => {
        if (cancelled) return;
        if (e) setError("Chat didn't load. It will catch up when new messages arrive.");
        else setMessages(((data as LiveMessage[]) || []).reverse());
        setLoading(false);
      });
    const ch = supabase()
      .channel(channelName(`live-chat-${liveId}`))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_messages", filter: `live_id=eq.${liveId}` }, (p: any) => add(p.new as LiveMessage))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "live_messages", filter: `live_id=eq.${liveId}` }, (p: any) => {
        const gone = p.old?.id;
        if (gone) setMessages((prev) => prev.filter((m) => m.id !== gone));
      })
      .subscribe();
    return () => { cancelled = true; supabase().removeChannel(ch); };
  }, [liveId, enabled, add]);

  const send = useCallback(async (row: { user_id: string; display_name: string; body: string; is_host: boolean }) => {
    if (!liveId) return;
    const { data, error: e } = await supabase().from("live_messages").insert({ live_id: liveId, ...row }).select().single();
    if (e) throw new Error(navigator.onLine === false ? "You're offline. Message not sent." : "Message didn't send. Try again.");
    if (data) add(data as LiveMessage);
  }, [liveId, add]);

  const remove = useCallback(async (id: string) => {
    const { error: e } = await supabase().from("live_messages").delete().eq("id", id);
    if (!e) setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  return { messages, loading, error, send, remove };
}

/** Calls to action for a live. `activeOnly` = what students see. */
export function useLiveCtas(liveId: string | null | undefined, enabled: boolean, activeOnly: boolean) {
  const [ctas, setCtas] = useState<LiveCta[]>([]);
  const [loaded, setLoaded] = useState(false);

  const upsert = useCallback((row: LiveCta) => {
    setCtas((prev) => {
      const rest = prev.filter((c) => c.id !== row.id);
      const next = activeOnly && !row.active ? rest : [row, ...rest];
      return next.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    });
  }, [activeOnly]);

  const load = useCallback(async () => {
    if (!liveId) return;
    let q = supabase().from("live_ctas").select("*").eq("live_id", liveId).order("created_at", { ascending: false }).limit(activeOnly ? 10 : 100);
    if (activeOnly) q = q.eq("active", true);
    const { data } = await q;
    setCtas(((data as LiveCta[]) || []).map(normalizeCta));
    setLoaded(true);
  }, [liveId, activeOnly]);

  useEffect(() => {
    if (!liveId || !enabled) return;
    load();
    const ch = supabase()
      .channel(channelName(`live-cta-${liveId}`))
      .on("postgres_changes", { event: "*", schema: "public", table: "live_ctas", filter: `live_id=eq.${liveId}` }, (p: any) => {
        if (p.eventType === "DELETE") {
          const gone = p.old?.id;
          if (gone) setCtas((prev) => prev.filter((c) => c.id !== gone));
          return;
        }
        if (p.new) upsert(normalizeCta(p.new as LiveCta));
      })
      .subscribe();
    return () => { supabase().removeChannel(ch); };
  }, [liveId, enabled, load, upsert]);

  return { ctas, loaded, reload: load, upsert };
}

const normalizeCta = (c: LiveCta): LiveCta => ({ ...c, options: Array.isArray(c.options) ? c.options : [] });

/** Poll vote counts, refreshed every `ms` while enabled and the page is visible. */
export function usePollResults(ctaId: string | null | undefined, optionCount: number, enabled: boolean, ms = 3000) {
  const [counts, setCounts] = useState<number[]>(() => Array(optionCount).fill(0));
  const visible = usePageVisible();
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!ctaId || busy.current) return;
    busy.current = true;
    try {
      const { data } = await supabase().rpc("poll_results", { p_cta: ctaId });
      const next = Array(optionCount).fill(0);
      ((data as { choice: number; votes: number | string }[]) || []).forEach((r) => {
        if (r.choice >= 0 && r.choice < optionCount) next[r.choice] = Number(r.votes) || 0;
      });
      setCounts(next);
    } catch { /* keep last numbers */ }
    busy.current = false;
  }, [ctaId, optionCount]);

  useEffect(() => {
    if (!enabled || !visible || !ctaId) return;
    refresh();
    const t = setInterval(refresh, ms);
    return () => clearInterval(t);
  }, [enabled, visible, ctaId, ms, refresh]);

  return { counts, refresh };
}
