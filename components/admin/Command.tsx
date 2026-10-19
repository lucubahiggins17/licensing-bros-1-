"use client";
// Bro Command: the AI chief of staff for admins and instructors. Ask in plain words (or by voice); it looks up
// students and stats, builds draft tests and game decks, and prepares announcements, emails, live classes and more,
// which only happen after you tap Confirm.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, CircleAlert, Loader2, Mic, RotateCcw, Send, ShieldCheck, Sparkles, Square, Volume2, VolumeX, X } from "lucide-react";
import { ApiError, callFn, fnHeaders, FUNCTIONS_URL } from "@/lib/api";
import { md } from "@/lib/ai";
import { useAuth } from "@/lib/auth";
import { forSpeech, primeSpeech, Speaker, startListening, takeSentences, voiceSupport, type Listening } from "@/components/voice/speech";
import { errMsg } from "./format";
import { useAdmin } from "./ui";
import c from "./Command.module.css";

type Card =
  | { kind: "students"; title: string; rows: { name: string; email: string; detail: string; risk?: string }[] }
  | { kind: "created"; title: string; detail: string; link: string; linkLabel: string }
  | { kind: "stats"; title: string; items: { label: string; value: string }[] }
  | { kind: "list"; title: string; items: string[] };
type Action = { id: string; kind: string; summary: string; details: string[]; state?: "busy" | "done" | "cancelled" | "failed"; result?: string };
type Brief = { greeting: string; items: { label: string; value: number }[]; classes: string[]; suggestions: string[] };
type Item =
  | { type: "me"; text: string }
  | { type: "ai"; text: string }
  | { type: "tool"; id: string; label: string; status: "start" | "done" | "error" }
  | { type: "card"; card: Card }
  | { type: "action"; action: Action }
  | { type: "error"; text: string };

const STORE = "lb.cmd.v1";
const ADMIN_SUGGESTIONS = [
  "How is the site doing this week?",
  "Who's at risk of failing their exam this month?",
  "Build a 25-question Tennessee GC practice test on lien law",
  "Make a game deck on NEC grounding and bonding",
  "Schedule a free live Q&A next Tuesday at 7 PM",
  "Email my instructors a summary of at-risk students"
];
const INSTRUCTOR_SUGGESTIONS = [
  "Who's at risk of failing their exam this month?",
  "Which students haven't studied in a week?",
  "Build a 20-question plumbing practice test on venting",
  "Make a game deck on OSHA fall protection",
  "Schedule a free review class this Thursday at 6 PM",
  "Remind my exam-soon students to take a mock exam"
];
const PAST = { start: "Working", done: "Done", error: "Couldn't finish" };

function load(): { items: Item[]; history: unknown[]; notes: string[] } {
  try {
    const v = JSON.parse(sessionStorage.getItem(STORE) || "null");
    if (v && Array.isArray(v.items) && Array.isArray(v.history)) return { items: v.items.slice(-120), history: v.history, notes: Array.isArray(v.notes) ? v.notes : [] };
  } catch { /* storage blocked */ }
  return { items: [], history: [], notes: [] };
}

export default function Command() {
  const { toast } = useAdmin();
  const { account } = useAuth();
  const isAdmin = !!account?.is_admin;
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakOn, setSpeakOn] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const historyRef = useRef<unknown[]>([]);
  const notesRef = useRef<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const listenRef = useRef<Listening | null>(null);
  const speakerRef = useRef<Speaker | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [support] = useState(() => (typeof window === "undefined" ? { stt: null, tts: null } : voiceSupport()));

  useEffect(() => {
    const v = load();
    setItems(v.items);
    historyRef.current = v.history;
    notesRef.current = v.notes;
    try { setSpeakOn(localStorage.getItem("lb.cmd.voice") === "1"); } catch { /* ignore */ }
    callFn<Brief>("assistant", { action: "brief", tz: Intl.DateTimeFormat().resolvedOptions().timeZone }).then(setBrief).catch(() => { /* briefing is a bonus */ });
    return () => { abortRef.current?.abort(); listenRef.current?.abort(); speakerRef.current?.cancel(); };
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify({ items: items.slice(-120), history: historyRef.current, notes: notesRef.current })); } catch { /* ignore */ }
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  function speaker(): Speaker | null {
    if (!support.tts) return null;
    if (!speakerRef.current) {
      speakerRef.current = new Speaker(support.tts, () => 1.05);
      speakerRef.current.onError = () => toast("This device couldn't play the voice. Replies stay on screen.", "info");
    }
    return speakerRef.current;
  }

  function toggleSpeak() {
    const v = !speakOn;
    setSpeakOn(v);
    if (v) primeSpeech(); else speakerRef.current?.cancel();
    try { localStorage.setItem("lb.cmd.voice", v ? "1" : "0"); } catch { /* ignore */ }
  }

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || busy) return;
    primeSpeech();
    speakerRef.current?.cancel();
    setInput("");
    setBusy(true);
    const notes = notesRef.current;
    notesRef.current = [];
    const message = notes.length ? `${notes.map((n) => `[Update: ${n}]`).join("\n")}\n${text}` : text;
    setItems((x) => [...x, { type: "me", text }]);
    const ctl = new AbortController();
    abortRef.current = ctl;
    let aiText = "";
    let spoken = 0;
    const sp = speakOn ? speaker() : null;
    const pushText = (d: string) => {
      aiText += d;
      setItems((x) => {
        const last = x[x.length - 1];
        if (last?.type === "ai") return [...x.slice(0, -1), { type: "ai", text: last.text + d }];
        return d.trim() ? [...x, { type: "ai", text: d.replace(/^\s+/, "") }] : x;
      });
      if (sp) {
        const { chunks, upTo } = takeSentences(forSpeech(aiText), spoken, false);
        spoken = upTo;
        chunks.forEach((ch) => sp.push(ch));
      }
    };
    try {
      const res = await fetch(`${FUNCTIONS_URL()}/assistant`, {
        method: "POST",
        headers: await fnHeaders(),
        body: JSON.stringify({ action: "chat", message, history: historyRef.current, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, voice: speakOn }),
        signal: ctl.signal
      });
      if (!res.ok || !res.body) {
        let msg = "The command center isn't answering. Try again.";
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* not JSON */ }
        throw new ApiError(msg, res.status);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: any;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.t === "text") pushText(String(ev.d || ""));
          else if (ev.t === "tool") setItems((x) => {
            const i = x.findIndex((it) => it.type === "tool" && it.id === ev.id);
            const it: Item = { type: "tool", id: ev.id, label: ev.label, status: ev.status };
            return i >= 0 ? [...x.slice(0, i), it, ...x.slice(i + 1)] : [...x, it];
          });
          else if (ev.t === "card") setItems((x) => [...x, { type: "card", card: ev.card }]);
          else if (ev.t === "action") setItems((x) => [...x, { type: "action", action: ev.action }]);
          else if (ev.t === "error") setItems((x) => [...x, { type: "error", text: ev.message }]);
          else if (ev.t === "done" && Array.isArray(ev.history)) historyRef.current = ev.history;
        }
      }
      if (sp) takeSentences(forSpeech(aiText), spoken, true).chunks.forEach((ch) => sp.push(ch));
    } catch (e: any) {
      if (e?.name !== "AbortError") setItems((x) => [...x, { type: "error", text: errMsg(e, "Something interrupted the command center. Try again.") }]);
      notesRef.current = [...notes, ...notesRef.current];
    }
    abortRef.current = null;
    setBusy(false);
    setTimeout(() => taRef.current?.focus(), 30);
  }

  async function decide(a: Action, choice: "confirm" | "cancel") {
    const set = (patch: Partial<Action>) => setItems((x) => x.map((it) => (it.type === "action" && it.action.id === a.id ? { ...it, action: { ...it.action, ...patch } } : it)));
    set({ state: "busy" });
    try {
      const r = await callFn<{ ok: boolean; status: string; message: string }>("assistant", { action: choice, id: a.id, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
      set({ state: r.status === "done" ? "done" : r.status === "cancelled" ? "cancelled" : "failed", result: r.message });
      notesRef.current = [...notesRef.current, `${choice === "confirm" ? (r.ok ? "Confirmed and done" : "Confirmed but it failed") : "Cancelled"}: ${a.summary}. ${r.message}`];
      if (r.ok && choice === "confirm") toast(r.message);
      else if (!r.ok) toast(r.message, "bad");
    } catch (e) {
      set({ state: undefined });
      toast(errMsg(e), "bad");
    }
  }

  async function mic() {
    if (listening) { listenRef.current?.stop(); return; }
    if (!support.stt) { toast("Voice input doesn't work in this browser. Try Chrome, Edge or Safari.", "info"); return; }
    primeSpeech();
    setListening(true);
    listenRef.current = await startListening(support.stt, {
      onPartial: (t) => setInput(t),
      onFinal: (t) => { setListening(false); listenRef.current = null; if (t) send(t); },
      onError: (e) => { setListening(false); listenRef.current = null; toast(e === "denied" ? "The microphone is blocked. Allow it in your browser settings." : "Didn't catch that. Try again or type.", "info"); }
    });
  }

  function reset() {
    abortRef.current?.abort();
    speakerRef.current?.cancel();
    historyRef.current = [];
    notesRef.current = [];
    setItems([]);
    try { sessionStorage.removeItem(STORE); } catch { /* ignore */ }
  }

  const suggestions = isAdmin ? ADMIN_SUGGESTIONS : INSTRUCTOR_SUGGESTIONS;
  const working = busy && !items.some((it, i) => i === items.length - 1 && it.type === "ai");

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className={c.hero}>
        <div className={c.orbWrap} data-on={busy || listening ? "1" : "0"} aria-hidden="true">
          <span className={c.ring} /><span className={c.ring} /><span className={c.orb}><Sparkles /></span>
        </div>
        <div className={c.heroText}>
          <div className="eyebrow orange">{isAdmin ? "Owner" : "Instructor"} · AI chief of staff</div>
          <h2 className={c.title}>Bro <span>Command</span></h2>
          <p className={c.sub}>Ask for anything: who needs help, new tests and games, live classes, announcements and emails. Anything that reaches people waits for your OK.</p>
        </div>
        <div className={c.heroBtns}>
          {support.tts && (
            <button type="button" className={`btn sm ${speakOn ? "navy" : ""}`} aria-pressed={speakOn} onClick={toggleSpeak} title="Read replies out loud">
              {speakOn ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}{speakOn ? "Voice on" : "Voice off"}
            </button>
          )}
          {items.length > 0 && <button type="button" className="btn sm ghost" onClick={reset}><RotateCcw aria-hidden="true" />New chat</button>}
        </div>
      </section>

      {brief && (
        <section className={c.brief} aria-label="Today's briefing">
          <b className={c.briefHi}>{brief.greeting}</b>
          <div className={c.briefItems}>
            {brief.items.map((x) => <span key={x.label} className={c.briefItem} data-hot={x.value > 0 && x.label !== "New today" ? "1" : "0"}><b>{x.value}</b>{x.label}</span>)}
          </div>
          {brief.classes.length > 0 && <span className="note">Coming up: {brief.classes.join(" · ")}</span>}
          {brief.suggestions.length > 0 && (
            <div className={c.chips}>{brief.suggestions.map((t) => <button key={t} type="button" className={c.chip} onClick={() => send(t)} disabled={busy}>{t}</button>)}</div>
          )}
        </section>
      )}

      <section className={`card hard ${c.console}`}>
        <div ref={chatRef} className={`chat ${c.chat}`} aria-live="polite">
          {!items.length && (
            <div className={c.empty}>
              <p className="note" style={{ margin: 0 }}>Try one of these, or ask your own:</p>
              <div className={c.chips}>
                {suggestions.map((t) => <button key={t} type="button" className={c.chip} onClick={() => send(t)}>{t}</button>)}
              </div>
            </div>
          )}
          {items.map((it, i) => {
            if (it.type === "me") return <div key={i} className="msg me">{it.text}</div>;
            if (it.type === "ai") return it.text.trim() ? <div key={i} className="msg ai" dangerouslySetInnerHTML={{ __html: md(it.text.trim()) }} /> : null;
            if (it.type === "error") return <div key={i} className={c.err} role="alert"><CircleAlert aria-hidden="true" />{it.text}</div>;
            if (it.type === "tool") return (
              <div key={i} className={c.tool} data-status={it.status}>
                {it.status === "start" ? <Loader2 className={c.spin} aria-hidden="true" /> : it.status === "done" ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
                <span>{it.label}{it.status === "start" ? "…" : ""}</span><small>{PAST[it.status]}</small>
              </div>
            );
            if (it.type === "card") return <CardView key={i} card={it.card} />;
            return <ActionCard key={i} a={it.action} onDecide={decide} />;
          })}
          {working && <div className={c.thinking}><span /><span /><span /></div>}
        </div>

        <form className={c.composer} onSubmit={(e) => { e.preventDefault(); send(); }}>
          <label htmlFor="cmd-input" className="srOnly" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Message Bro Command</label>
          <textarea id="cmd-input" ref={taRef} rows={1} value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? "Listening…" : "Ask or tell Bro Command what to do…"}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} disabled={busy && !listening} />
          {support.stt && (
            <button type="button" className={`${c.iconBtn} ${listening ? c.live : ""}`} onClick={mic} aria-label={listening ? "Stop listening" : "Talk"} aria-pressed={listening} disabled={busy}>
              <Mic aria-hidden="true" />
            </button>
          )}
          {busy ? (
            <button type="button" className={`${c.iconBtn} ${c.stop}`} onClick={() => abortRef.current?.abort()} aria-label="Stop"><Square aria-hidden="true" /></button>
          ) : (
            <button type="submit" className={`${c.iconBtn} ${c.sendBtn}`} aria-label="Send" disabled={!input.trim()}><Send aria-hidden="true" /></button>
          )}
        </form>
      </section>
      <p className="note" style={{ margin: 0, display: "flex", gap: 6, alignItems: "flex-start" }}><ShieldCheck aria-hidden="true" style={{ width: 16, height: 16, flex: "none", marginTop: 2 }} />Drafts it builds stay unpublished until you review them. Announcements, emails, classes and role changes only happen after you tap Confirm.</p>
    </div>
  );
}

function CardView({ card }: { card: Card }) {
  if (card.kind === "stats") return (
    <div className={c.card}>
      <b className={c.cardTitle}>{card.title}</b>
      <div className={c.statGrid}>{card.items.map((x) => <div key={x.label} className={c.statItem}><b>{x.value}</b><span>{x.label}</span></div>)}</div>
    </div>
  );
  if (card.kind === "students") return (
    <div className={c.card}>
      <b className={c.cardTitle}>{card.title}</b>
      {card.rows.length ? (
        <ul className={c.people}>
          {card.rows.map((r) => (
            <li key={r.email || r.name}>
              <span className={c.dot} data-risk={r.risk || "low"} aria-label={r.risk === "high" ? "At risk" : r.risk === "medium" ? "Watch" : "On track"} />
              <span className={c.person}><b>{r.name}</b><small>{r.email}</small></span>
              <span className={c.pdetail}>{r.detail}</span>
            </li>
          ))}
        </ul>
      ) : <p className="note" style={{ margin: 0 }}>Nobody right now.</p>}
    </div>
  );
  if (card.kind === "created") return (
    <div className={`${c.card} ${c.created}`}>
      <b className={c.cardTitle}><Check aria-hidden="true" />{card.title}</b>
      <span className="note">{card.detail}</span>
      <Link className="btn sm" href={card.link}>{card.linkLabel}</Link>
    </div>
  );
  return (
    <div className={c.card}>
      <b className={c.cardTitle}>{card.title}</b>
      <ul className={c.list}>{card.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

function ActionCard({ a, onDecide }: { a: Action; onDecide: (a: Action, choice: "confirm" | "cancel") => void }) {
  const decided = a.state === "done" || a.state === "cancelled" || a.state === "failed";
  return (
    <div className={c.action} data-state={a.state || "pending"} role="group" aria-label={`Waiting for your OK: ${a.summary}`}>
      <div className={c.actionHead}><span className={c.badge}>{decided ? (a.state === "done" ? "Done" : a.state === "cancelled" ? "Cancelled" : "Didn't work") : "Needs your OK"}</span><b>{a.summary}</b></div>
      {a.details.map((d, i) => <p key={i} className={c.detail}>{d}</p>)}
      {decided ? (
        <p className={c.result}>{a.state === "done" ? <Check aria-hidden="true" /> : a.state === "failed" ? <CircleAlert aria-hidden="true" /> : <X aria-hidden="true" />}{a.result}</p>
      ) : (
        <div className={c.actionBtns}>
          <button type="button" className="btn primary sm" disabled={a.state === "busy"} onClick={() => onDecide(a, "confirm")}>{a.state === "busy" ? "Working…" : "Confirm"}</button>
          <button type="button" className="btn sm ghost" disabled={a.state === "busy"} onClick={() => onDecide(a, "cancel")}>Cancel</button>
        </div>
      )}
    </div>
  );
}
