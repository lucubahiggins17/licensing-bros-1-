"use client";
// Notifications center: bell with unread count, dropdown panel (full-width sheet on phones), realtime updates.
// The panel is portaled to <body> because the sticky nav uses backdrop-filter, which would trap fixed positioning.
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, CheckCheck, X, ExternalLink, BellOff } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import type { Notification } from "@/lib/types";
import { timeAgo, isInternalLink } from "./timeAgo";
import s from "./Bell.module.css";

export default function NotificationBell() {
  const { user } = useAuth();
  const uid = user?.id || null;
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState(false);
  const [lastRead, setLastRead] = useState(0); // read_until before this opening, for the "new" dots
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 64, right: 12 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  openRef.current = open;

  const loadUnread = useCallback(async () => {
    if (!uid) return;
    try {
      const { data, error } = await supabase().rpc("unread_notifications");
      if (!error && typeof data === "number") setUnread(data);
    } catch { /* offline */ }
  }, [uid]);

  const loadList = useCallback(async () => {
    if (!uid) return;
    setError(false);
    try {
      // Explicit filter: admins can read every row through RLS, but the bell only shows yours + broadcasts
      const { data, error } = await supabase().from("notifications").select("*")
        .or(`user_id.is.null,user_id.eq.${uid}`)
        .order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      setItems((data as Notification[]) || []);
    } catch { setError(true); setItems((x) => x || []); }
  }, [uid]);

  const markRead = useCallback(async () => {
    if (!uid) return;
    setUnread(0);
    try {
      await supabase().from("notification_reads").upsert({ user_id: uid, read_until: new Date().toISOString() });
    } catch { /* offline: the count comes back next time */ }
  }, [uid]);

  // Unread count on load, when the window regains focus, and on realtime inserts
  useEffect(() => {
    if (!uid) return;
    loadUnread();
    const sb = supabase();
    const ch = sb.channel(`notifications:${uid}:${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, (payload: any) => {
        const n = payload?.new as Notification | undefined;
        if (!n || (n.user_id && n.user_id !== uid)) return;
        setItems((list) => (list ? [n, ...list.filter((x) => x.id !== n.id)].slice(0, 20) : list));
        if (openRef.current) markRead(); else setUnread((c) => c + 1);
      })
      .subscribe();
    const onFocus = () => loadUnread();
    window.addEventListener("focus", onFocus);
    return () => { window.removeEventListener("focus", onFocus); sb.removeChannel(ch); };
  }, [uid, loadUnread, markRead]);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: Math.round(r.bottom + 8), right: Math.max(8, Math.round(window.innerWidth - r.right - 6)) });
  }, []);

  // Opening: remember what was already read, load the list, then mark everything read
  async function toggle() {
    if (open) { setOpen(false); return; }
    place();
    setOpen(true);
    if (uid) {
      try {
        const { data } = await supabase().from("notification_reads").select("read_until").eq("user_id", uid).maybeSingle();
        setLastRead(data?.read_until ? new Date(data.read_until).getTime() : 0);
      } catch { /* offline */ }
    }
    loadList();
    markRead();
  }

  const close = useCallback((focusBell = false) => {
    setOpen(false);
    if (focusBell) btnRef.current?.focus();
  }, []);

  useLayoutEffect(() => { if (open) panelRef.current?.focus(); }, [open]);

  // Close on outside click / Escape; keep the dropdown under the bell on resize
  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => !!t && ((wrapRef.current?.contains(t as Node)) || (panelRef.current?.contains(t as Node)));
    const onDown = (e: MouseEvent | TouchEvent) => { if (!inside(e.target)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(true); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
    };
  }, [open, close, place]);

  if (!uid) return null;
  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";

  const panel = open && typeof document !== "undefined" ? createPortal(
    <>
      <div className={s.scrim} aria-hidden="true" />
      <div ref={panelRef} className={s.panel} role="dialog" aria-labelledby="notif-title" tabIndex={-1}
        style={{ ["--bell-top" as any]: `${pos.top}px`, ["--bell-right" as any]: `${pos.right}px` }}>
        <div className={s.head}>
          <b id="notif-title">Notifications</b>
          <div className={s.headActions}>
            <button type="button" className={`btn sm ghost ${s.markBtn}`} onClick={() => { markRead(); setLastRead(Date.now()); }} disabled={!items?.length}>
              <CheckCheck aria-hidden="true" /> Mark all read
            </button>
            <button type="button" className={s.closeBtn} aria-label="Close notifications" onClick={() => close(true)}><X aria-hidden="true" /></button>
          </div>
        </div>
        <div className={s.list}>
          {items === null ? (
            <div className={s.state}><span className="spin" role="status" aria-label="Loading notifications" /></div>
          ) : error && !items.length ? (
            <div className={s.state}>
              <p>Couldn&rsquo;t load notifications. Check your connection.</p>
              <button type="button" className="btn sm" onClick={loadList}>Try again</button>
            </div>
          ) : !items.length ? (
            <div className={s.state}>
              <BellOff aria-hidden="true" />
              <p>You&rsquo;re all caught up. New courses, live classes and replies to your questions show up here.</p>
            </div>
          ) : (
            <ul>
              {items.map((n) => {
                const fresh = new Date(n.created_at).getTime() > lastRead;
                const external = !!n.link && !isInternalLink(n.link);
                const inner = (
                  <>
                    <span className={`${s.dotNew} ${fresh ? s.on : ""}`} aria-hidden="true" />
                    <span className={s.text}>
                      <b>{n.title}{fresh && <span className={s.srOnly}> (new)</span>}</b>
                      {n.body && <span className={s.body}>{n.body}</span>}
                      <time className={s.time} dateTime={n.created_at}>{timeAgo(n.created_at)}</time>
                    </span>
                    {external && <ExternalLink className={s.ext} aria-hidden="true" />}
                  </>
                );
                return (
                  <li key={n.id}>
                    {!n.link ? <div className={s.item}>{inner}</div>
                      : external
                        ? <a href={n.link} target="_blank" rel="noopener noreferrer" className={`${s.item} ${s.link}`} onClick={() => close()}>{inner}</a>
                        : <Link href={n.link} className={`${s.item} ${s.link}`} onClick={() => close()}>{inner}</Link>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>,
    document.body
  ) : null;

  return (
    <div className={s.wrap} ref={wrapRef}>
      <button ref={btnRef} type="button" className="iconbtn-plain" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
        <Bell aria-hidden="true" />
        {unread > 0 && <span className="dot" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {panel}
    </div>
  );
}
