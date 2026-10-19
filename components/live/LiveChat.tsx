"use client";
// Live class chat: last 100 messages + realtime, host highlighting, auto-scroll with a "New messages" pill,
// 500-character limit and a gentle client-side rate limit (1 message every 2 seconds).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, MessageSquare, Send, Trash2, ArrowDown } from "lucide-react";
import { useAuth, displayName } from "@/lib/auth";
import { routes } from "@/lib/nav";
import { useLiveChat } from "@/components/live/useLiveData";
import s from "./live.module.css";

const MAX = 500;
const GAP_MS = 2000;

export default function LiveChat({ liveId, isHost = false, canSend = true, closedText, open = true, onToggle, className, title = "Live chat" }: {
  liveId: string;
  isHost?: boolean;
  canSend?: boolean;
  closedText?: string;
  open?: boolean;
  onToggle?: () => void;
  className?: string;
  title?: string;
}) {
  const { user, profile } = useAuth();
  const { messages, loading, error, send, remove } = useLiveChat(liveId, !!user);
  const [text, setText] = useState("");
  const [sendErr, setSendErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [tooFast, setTooFast] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [armed, setArmed] = useState<string | null>(null);
  const lastSent = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prevCount = useRef(0);
  const forceScroll = useRef(true);

  const scrollToEnd = (smooth = false) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    atBottom.current = true;
    setUnseen(0);
  };

  useLayoutEffect(() => {
    const added = messages.length - prevCount.current;
    prevCount.current = messages.length;
    if (!open) return;
    if (forceScroll.current || atBottom.current) { forceScroll.current = false; scrollToEnd(); }
    else if (added > 0) setUnseen((n) => n + added);
  }, [messages, open]);

  // Opening the panel again jumps to the newest message
  useEffect(() => { if (open) { forceScroll.current = true; requestAnimationFrame(() => scrollToEnd()); } }, [open]);

  // Rate-limit countdown
  useEffect(() => {
    if (cooldown <= 0) { setTooFast(false); return; }
    const t = setTimeout(() => setCooldown(Math.max(0, GAP_MS - (Date.now() - lastSent.current))), 200);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Disarm the delete confirmation after a moment
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3500);
    return () => clearTimeout(t);
  }, [armed]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (atBottom.current && unseen) setUnseen(0);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || !user || busy) return;
    const wait = GAP_MS - (Date.now() - lastSent.current);
    if (wait > 0) { setCooldown(wait); setTooFast(true); return; }
    setBusy(true); setSendErr("");
    lastSent.current = Date.now();
    setText("");
    forceScroll.current = true;
    try {
      await send({ user_id: user.id, display_name: displayName(profile, user).slice(0, 60), body: body.slice(0, MAX), is_host: isHost });
    } catch (err: any) {
      setSendErr(err?.message || "Message didn't send.");
      setText(body);
      lastSent.current = 0;
    }
    setBusy(false);
    setCooldown(GAP_MS);
  }

  const fmt = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const panelId = `chat-${liveId}`;

  return (
    <section className={`${s.chat}${open ? "" : ` ${s.chatClosed}`} ${className || ""}`} aria-label={title}>
      <header className={s.chatHead}>
        <MessageSquare size={17} aria-hidden="true" />
        <h2>{title}</h2>
        {messages.length > 0 && <span className={s.chatCount}>{messages.length}</span>}
        {onToggle && (
          <button type="button" className={s.chatToggle} onClick={onToggle} aria-expanded={open} aria-controls={panelId}>
            {open ? <><ChevronDown size={16} aria-hidden="true" /> Hide</> : <><ChevronUp size={16} aria-hidden="true" /> Show{unseen ? ` (${unseen})` : ""}</>}
          </button>
        )}
      </header>

      <div id={panelId} className={s.chatBody} hidden={!open}>
        <div className={s.chatList} ref={listRef} onScroll={onScroll} role="log" aria-live="polite" aria-relevant="additions">
          {!user ? (
            <p className={s.chatEmpty}>Sign in to see the chat.</p>
          ) : loading && messages.length === 0 ? (
            <p className={s.chatEmpty}><span className="spin" aria-hidden="true" /> Loading chat…</p>
          ) : messages.length === 0 ? (
            <p className={s.chatEmpty}>{error || "No messages yet. Say hi and ask your questions here."}</p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`${s.msg}${m.is_host ? ` ${s.msgHost}` : ""}${m.user_id === user.id ? ` ${s.msgMine}` : ""}`}>
                <div className={s.msgMeta}>
                  <b>{m.display_name}</b>
                  {m.is_host && <span className={s.hostBadge}>Host</span>}
                  {m.user_id === user.id && !m.is_host && <span className={s.you}>you</span>}
                  <time dateTime={m.created_at}>{fmt(m.created_at)}</time>
                  {isHost && (
                    <button
                      type="button"
                      className={`${s.msgDel}${armed === m.id ? ` ${s.msgDelArmed}` : ""}`}
                      onClick={() => (armed === m.id ? (setArmed(null), remove(m.id)) : setArmed(m.id))}
                      aria-label={armed === m.id ? "Tap again to delete this message" : `Delete message from ${m.display_name}`}
                    >
                      <Trash2 size={13} aria-hidden="true" />{armed === m.id && " Delete?"}
                    </button>
                  )}
                </div>
                <p>{m.body}</p>
              </div>
            ))
          )}
        </div>
        {unseen > 0 && (
          <button type="button" className={s.newPill} onClick={() => scrollToEnd(true)}>
            <ArrowDown size={14} aria-hidden="true" /> {unseen} new {unseen === 1 ? "message" : "messages"}
          </button>
        )}

        {!user ? (
          <div className={s.chatFoot}>
            <Link className="btn primary block" href={routes.login(undefined, typeof window !== "undefined" ? window.location.pathname + window.location.search : routes.lives)}>Sign in to chat</Link>
          </div>
        ) : !canSend ? (
          <div className={s.chatFoot}><p className={s.chatClosedNote}>{closedText || "Chat is closed."}</p></div>
        ) : (
          <form className={s.compose} onSubmit={submit}>
            <label className={s.srOnly} htmlFor={`${panelId}-input`}>Message</label>
            <input
              id={`${panelId}-input`}
              value={text}
              maxLength={MAX}
              onChange={(e) => { setText(e.target.value); if (sendErr) setSendErr(""); }}
              placeholder={isHost ? "Message as host…" : "Ask a question…"}
              autoComplete="off"
              enterKeyHint="send"
            />
            <button type="submit" className={s.sendBtn} disabled={!text.trim() || busy} aria-label="Send message">
              <Send size={18} aria-hidden="true" />
            </button>
            {(text.length > MAX - 100 || (tooFast && cooldown > 0) || sendErr) && (
              <div className={s.composeNote}>
                {sendErr ? <span className="err">{sendErr}</span> : tooFast && cooldown > 0 ? <span>One sec… you can send again in {Math.ceil(cooldown / 1000)}s</span> : null}
                {text.length > MAX - 100 && <span className={s.counter}>{text.length}/{MAX}</span>}
              </div>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
