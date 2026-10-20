"use client";
// "Talk to Bro": a full-screen voice conversation with the AI tutor.
// Listen → think → speak (sentence by sentence while the answer streams) → listen again (hands-free).
import { useContext, useEffect, useRef, useState } from "react";
import { Mic, Square, X, Keyboard, Settings2, Send, Info } from "lucide-react";
import { AppCtx, AiErrorNote, SourceList } from "@/components/ctx";
import { askForTravelMode } from "@/components/shell/SessionGuard";
import { useAuth } from "@/lib/auth";
import { md, splitSources, streamTutor } from "@/lib/ai";
import { TRADES, TradeKey } from "@/lib/data";
import { onBackButton } from "@/lib/native";
import { coachNote } from "@/lib/progress";
import {
  chooseVoice, currentVoiceId, forSpeech, isEcho, Listening, ListenError, onStudioFallback, prefs, primeSpeech, RATES, say, Speaker,
  startListening, studioStatus, takeSentences, voiceErrorText, voiceOptions, VoiceOption, voiceSupport, wasInterrupted
} from "./speech";
import { clearListen, clearVoiceAvailable } from "./clearVoice";
import { siteClearVoice } from "@/lib/voiceFlag";

const NO_VOICE = "This device can't speak answers out loud, so Bro's replies are shown as captions. On a computer or phone browser, Chrome, Edge and Safari can talk.";
import s from "./TalkMode.module.css";

export type TalkModeProps = {
  open: boolean;
  onClose: () => void;
  /** Extra background for the tutor, e.g. the lesson summary or the exam question being explained */
  context?: string;
  /** Shown at the top, e.g. "Lesson 3: Fall protection" */
  title?: string;
  /** Optional first thing to ask automatically when opened */
  initialQuestion?: string;
};

type Phase = "idle" | "listening" | "thinking" | "speaking";
type Msg = { role: "user" | "assistant"; content: string };

const STARTERS: Record<TradeKey, string[]> = {
  gc: ["Quiz me on fall protection", "How do I frame a window opening?", "Markup versus margin?"],
  elec: ["Quiz me on GFCI rules", "How do I wire a 3-way switch?", "Explain voltage drop"],
  plumb: ["Quiz me on trap rules", "How do I set a toilet flange?", "When do I need a pressure-reducing valve?"],
  hvac: ["Superheat versus subcooling?", "Why would a furnace short-cycle?", "Quiz me on EPA 608"]
};
const CONTEXT_STARTERS = ["Explain this simply", "Quiz me on this", "What's most likely on the exam?"];

const LISTEN_ERRORS: Record<ListenError, string> = {
  unsupported: "Voice input doesn't work in this browser. Type your question below (Chrome, Edge and Safari support talking).",
  denied: "The microphone is blocked. Allow it in your browser or phone settings, or type your question below.",
  "no-mic": "No microphone was found. Plug one in, or type your question below.",
  network: "Voice recognition needs internet. Check your connection and tap the orb again.",
  busy: "The microphone is busy. Tap the orb to try again.",
  error: "The microphone stopped unexpectedly. Tap the orb to try again."
};

export default function TalkMode({ open, onClose, context, title, initialQuestion }: TalkModeProps) {
  const app = useContext(AppCtx);
  const { profile, account } = useAuth();
  const staff = !!account?.is_staff;
  const state = app?.p.state || profile?.state || "Tennessee";
  const trade = ((app?.p.trade || profile?.trade || "gc") as TradeKey);

  const [support] = useState(() => voiceSupport());
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [msgs, setMsgsState] = useState<Msg[]>([]);
  const [heard, setHeard] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<any>(null);
  const [typing, setTypingState] = useState(() => !support.stt && !(siteClearVoice() && prefs.clear() && clearVoiceAvailable()));
  const [typed, setTyped] = useState("");
  const [loop, setLoopState] = useState(true);
  const [rate, setRateState] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  const [voiceId, setVoiceId] = useState("");
  const [clearOn, setClearOn] = useState(true);
  const [stage, setStage] = useState<"" | "hearing" | "understanding">("");
  const [level, setLevel] = useState(0);

  // Refs: async callbacks (speech, streaming) always read the latest values through these
  const phaseRef = useRef<Phase>("idle");
  const msgsRef = useRef<Msg[]>([]);
  const loopRef = useRef(true);
  const rateRef = useRef(1);
  const typingRef = useRef(!support.stt && !(siteClearVoice() && prefs.clear() && clearVoiceAvailable()));
  const micBlocked = useRef(false);
  const openRef = useRef(open);
  const gen = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const listenRef = useRef<Listening | null>(null);
  const speakerRef = useRef<Speaker | null>(null);
  const streamDone = useRef(false);
  const spoken = useRef(0);
  const misses = useRef(0);
  const sessionKey = useRef<string | null>(null);
  const clearDown = useRef(false);
  const recentSpoken = useRef<string[]>([]);
  const lastText = useRef("");
  const retried = useRef(false);
  const studioNoted = useRef(false);
  const ctxRef = useRef({ state, trade, context });
  ctxRef.current = { state, trade, context };
  openRef.current = open;

  const rootRef = useRef<HTMLDivElement>(null);
  const capRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };
  const setMsgs = (m: Msg[]) => { msgsRef.current = m; setMsgsState(m); };
  const setTyping = (on: boolean) => { typingRef.current = on; setTypingState(on); };

  // Saved preferences
  useEffect(() => {
    const l = prefs.loop(), r = prefs.rate();
    loopRef.current = l; setLoopState(l);
    setClearOn(prefs.clear());
    rateRef.current = r; setRateState(r);
  }, []);

  // One speaker for the life of this component
  const afterSpeechRef = useRef<(g: number) => void>(() => {});
  useEffect(() => {
    if (!support.tts) return;
    const sp = new Speaker(support.tts, () => rateRef.current);
    sp.onIdle = () => { if (streamDone.current) afterSpeechRef.current(gen.current); };
    sp.onError = (e) => setNotice(voiceErrorText(e, support.tts));
    speakerRef.current = sp;
    const off = onStudioFallback((why) => {
      if (studioNoted.current) return;
      studioNoted.current = true;
      setNotice(staff ? `Using the device voice: Bro's studio voice failed (${why}). Check Admin → Settings → Bro's voice.` : "Bro's studio voice is offline, so you're hearing your device's voice for now.");
    });
    return () => { sp.cancel(); speakerRef.current = null; off(); };
  }, [support.tts, staff]);

  /** Clear-voice listening is on for this site, this device and this browser. */
  const useClear = () => siteClearVoice() && prefs.clear() && clearVoiceAvailable() && !clearDown.current;
  const canListen = () => !!support.stt || useClear();

  /** Stops listening, thinking and speaking; ignores any late callbacks from them. */
  function halt() {
    gen.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    listenRef.current?.abort();
    listenRef.current = null;
    speakerRef.current?.cancel();
    streamDone.current = false;
    setHeard(""); setStage(""); setLevel(0);
  }
  function stop() { halt(); setPhase("idle"); }

  /** auto = started by the app (on open / hands-free loop) rather than by a tap */
  async function listen(auto = false) {
    halt();
    setNotice(""); setError(null);
    if (!canListen() || micBlocked.current) { setTyping(true); setPhase("idle"); setTimeout(() => inputRef.current?.focus(), 50); return; }
    const g = gen.current;
    setPhase("listening");
    const heardText = (t: string) => {
      if (g !== gen.current) return;
      listenRef.current = null;
      setHeard(""); setStage(""); setLevel(0);
      // Bro's own voice coming back from the speaker: ignore it and keep listening
      if (t && isEcho(t, recentSpoken.current)) { recentSpoken.current = []; listen(true); return; }
      if (t) { misses.current = 0; ask(t); return; }
      misses.current++;
      if (loopRef.current && misses.current < 2) { listen(true); return; }
      setPhase("idle");
      setNotice("I didn't catch that. Tap the orb and talk, or type your question.");
    };
    if (useClear()) {
      const l = await clearListen({
        onFinal: heardText,
        onLevel: (v) => { if (g === gen.current) setLevel(v); },
        onStage: (st) => { if (g === gen.current) setStage(st === "listening" ? "" : st); },
        onError: (e, detail) => {
          if (g !== gen.current) return;
          listenRef.current = null;
          setStage(""); setLevel(0);
          // The voice server or the microphone stream didn't work: use the device's own recognizer from now on
          clearDown.current = true;
          if (e === "stt") {
            setPhase("idle");
            setNotice(`${staff && detail ? `Clear-voice listening failed (${detail}). ` : "Clear-voice listening isn't available right now. "}Switched to your device's speech recognition. Please say that again.`);
            if (support.stt) setTimeout(() => { if (g === gen.current) listen(true); }, 600);
            return;
          }
          if (support.stt) { listen(auto); return; }
          setPhase("idle");
          setNotice(LISTEN_ERRORS[e as ListenError] || LISTEN_ERRORS.error);
          if (e === "denied" || e === "no-mic") { micBlocked.current = true; setTyping(true); }
        }
      });
      if (g === gen.current) listenRef.current = l; else l.abort();
      return;
    }
    const l = await startListening(support.stt, {
      onPartial: (t) => { if (g === gen.current) setHeard(t); },
      onFinal: heardText,
      onError: (e) => {
        if (g !== gen.current) return;
        listenRef.current = null;
        setHeard("");
        setPhase("idle");
        // Some browsers refuse a mic that wasn't started by a tap: ask for a tap instead of giving up on voice
        if (e === "denied" && auto && support.stt === "web") { setNotice("Tap the orb to start talking. If your browser asks, allow the microphone."); return; }
        setNotice(LISTEN_ERRORS[e]);
        if (e === "denied" || e === "no-mic" || e === "unsupported") { micBlocked.current = true; setTyping(true); }
        if (e === "network") setTyping(true);
      }
    });
    if (g === gen.current) listenRef.current = l; else l.abort();
  }

  async function ask(text: string, isRetry = false) {
    const q = text.trim();
    if (!q) return;
    halt();
    if (!isRetry) retried.current = false;
    setNotice(""); setError(null); setSettingsOpen(false);
    const g = gen.current;
    const base = msgsRef.current.filter((m) => m.content.trim());
    if (base.length && base[base.length - 1].role === "user") base.pop(); // drop an unanswered question
    const history: Msg[] = [...base, { role: "user", content: q }];
    setMsgs([...history, { role: "assistant", content: "" }]);
    setPhase("thinking");
    spoken.current = 0;
    lastText.current = "";
    recentSpoken.current = [];
    const ctl = new AbortController();
    abortRef.current = ctl;
    const { state: st, trade: tr, context: cx } = ctxRef.current;
    /** One more automatic try when an answer gets cut off, so the student doesn't have to ask again. */
    const retry = () => {
      if (retried.current || g !== gen.current) return false;
      retried.current = true;
      speakerRef.current?.cancel();
      setMsgs(history);
      setNotice("That got cut off. Trying again…");
      setTimeout(() => { if (g === gen.current) ask(q, true); }, 900);
      return true;
    };
    try {
      const full = await streamTutor(
        { state: st, trade: tr, context: cx || undefined, voice: true, messages: history.slice(-12), coach: app?.p ? coachNote(app.p) || undefined : undefined },
        (t) => {
          if (g !== gen.current) return;
          // The server restarted the answer after a hiccup: start speaking over from the new text
          if (t.length < lastText.current.length || !t.startsWith(lastText.current)) { speakerRef.current?.cancel(); spoken.current = 0; }
          lastText.current = t;
          setMsgs([...history, { role: "assistant", content: t }]);
          feed(t, false, g);
        },
        ctl.signal
      );
      if (g !== gen.current) return;
      abortRef.current = null;
      if (wasInterrupted(full) && retry()) return;
      setMsgs([...history, { role: "assistant", content: full }]);
      feed(full, true, g);
    } catch (e: any) {
      if (g !== gen.current || e?.name === "AbortError") return;
      abortRef.current = null;
      if (["stream_cut", "ai_error", "ai_busy"].includes(e?.code) && retry()) return;
      setMsgs(history);
      setError(e);
      setPhase("idle");
      if (e?.code === "outside_home") askForTravelMode(e?.data?.location);
    }
  }

  /** Queues each finished sentence for speech while the answer is still streaming. */
  function feed(text: string, final: boolean, g: number) {
    const sp = speakerRef.current;
    if (!sp) {
      if (final && !support.tts) setNotice(NO_VOICE);
      if (text.trim() && phaseRef.current === "thinking") setPhase("speaking");
      if (final) { streamDone.current = true; afterSpeech(g); }
      return;
    }
    const { chunks, upTo } = takeSentences(forSpeech(text), spoken.current, final);
    spoken.current = upTo;
    chunks.forEach((c) => sp.push(c));
    if (chunks.length) recentSpoken.current = [...recentSpoken.current, ...chunks].slice(-4);
    if (chunks.length && phaseRef.current === "thinking") setPhase("speaking");
    if (final) {
      streamDone.current = true;
      if (!sp.busy) afterSpeech(g);
    }
  }

  function afterSpeech(g: number) {
    if (g !== gen.current) return;
    streamDone.current = false;
    if (loopRef.current && canListen() && !typingRef.current && !micBlocked.current && openRef.current) {
      // a pause so the mic doesn't catch the tail of Bro's voice (speakers keep playing a moment after "done")
      setTimeout(() => { if (g === gen.current && openRef.current) listen(true); }, 700);
    }
    setPhase("idle");
  }
  afterSpeechRef.current = afterSpeech;

  function orbTap() {
    primeSpeech();
    misses.current = 0;
    const ph = phaseRef.current;
    if (ph === "idle") listen();
    else if (ph === "listening") listenRef.current?.stop();
    else if (ph === "thinking") stop();
    else listen(); // speaking: interrupt and listen
  }

  function sendTyped(e?: React.FormEvent) {
    e?.preventDefault();
    primeSpeech();
    const t = typed.trim();
    if (!t) return;
    setTyped("");
    ask(t);
  }

  function toggleLoop() {
    const v = !loopRef.current;
    loopRef.current = v; setLoopState(v); prefs.setLoop(v);
  }
  function setRate(r: number) {
    rateRef.current = r; setRateState(r); prefs.setRate(r);
  }
  function cycleRate() { setRate(RATES[(RATES.indexOf(rateRef.current) + 1) % RATES.length]); }

  // Opening and closing
  useEffect(() => {
    if (!open) return;
    const key = `${context || ""}\u0000${initialQuestion || ""}`;
    const fresh = key !== sessionKey.current;
    if (fresh) {
      sessionKey.current = key;
      halt();
      setMsgs([]);
      setError(null);
      setNotice("");
    }
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusT = setTimeout(() => mainRef.current?.focus(), 40);
    const startT = setTimeout(() => {
      if (fresh && initialQuestion) ask(initialQuestion);
      else if (canListen() && !micBlocked.current) listen(true);
      else setTyping(true);
    }, 160);
    const offBack = onBackButton(() => { onClose(); return true; });
    return () => {
      clearTimeout(focusT); clearTimeout(startT);
      offBack();
      halt();
      setPhase("idle");
      setSettingsOpen(false);
      document.body.style.overflow = prevOverflow;
      try { prevFocus?.focus?.(); } catch { /* element gone */ }
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop everything if the component goes away
  useEffect(() => () => { gen.current++; abortRef.current?.abort(); listenRef.current?.abort(); }, []);

  // Keep the newest caption in view
  useEffect(() => {
    const c = capRef.current;
    if (c) c.scrollTop = c.scrollHeight;
  }, [msgs, heard, notice, error]);

  // Voice list for the settings sheet
  useEffect(() => {
    if (!settingsOpen || (voices && voices.length)) return;
    voiceOptions(support.tts).then(setVoices).catch(() => setVoices([]));
    currentVoiceId(support.tts).then(setVoiceId).catch(() => {});
  }, [settingsOpen, voices, support.tts]);

  // Escape closes; Tab stays inside the dialog
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); if (settingsOpen) setSettingsOpen(false); else onClose(); return; }
    if (e.key !== "Tab" || !rootRef.current) return;
    const els = Array.from(rootRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex='-1'])"))
      .filter((el) => el.offsetParent !== null);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  if (!open) return null;

  const mic = canListen() && !micBlocked.current;
  const statusText = phase === "listening" ? (stage === "understanding" ? "Understanding…" : stage === "hearing" ? "Hearing you…" : "Listening…") : phase === "thinking" ? "Thinking…" : phase === "speaking" ? (support.tts ? "Speaking…" : "Answering…") : mic ? "Tap to talk" : "Type below";
  const studio = studioStatus();
  const clearAvailable = siteClearVoice() && clearVoiceAvailable();
  const orbLabel = phase === "idle" ? "Start talking" : phase === "listening" ? "Done talking" : phase === "thinking" ? "Stop" : "Interrupt and talk";
  const busy = phase !== "idle";
  const starters = context ? CONTEXT_STARTERS : STARTERS[trade] || STARTERS.gc;
  const lastBro = msgs.length - 1;

  return (
    <div ref={rootRef} className={s.screen} data-phase={phase} role="dialog" aria-modal="true" aria-labelledby="talk-title" onKeyDown={onKeyDown}>
      <div className={s.tape} aria-hidden="true" />
      <div className={s.bar}>
        <div className={s.brand}>
          <h2 id="talk-title">Talk to <span>Bro</span></h2>
          <span className={s.sub}>{title || `${state} · ${TRADES[trade]}`}</span>
        </div>
        {support.tts && (
          <button type="button" className={s.icon} aria-label="Voice settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((o) => !o)}>
            <Settings2 aria-hidden="true" />
          </button>
        )}
        <button type="button" className={s.icon} aria-label="Close Talk to Bro" onClick={onClose}><X aria-hidden="true" /></button>
        {settingsOpen && (
          <div className={s.sheet} role="group" aria-label="Voice settings">
            <h3>Bro&rsquo;s voice</h3>
            <label className="field" htmlFor="talk-voice">Voice
              <select id="talk-voice" value={voiceId} disabled={!voices}
                onChange={async (e) => { setVoiceId(e.target.value); await chooseVoice(support.tts, e.target.value); }}>
                {!voices && <option value="">Loading voices…</option>}
                {voices && <option value="">Automatic (most natural)</option>}
                {voices?.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </label>
            <div>
              <div className="label" style={{ marginBottom: 6 }}>Speed</div>
              <div className="seg" role="group" aria-label="Speaking speed">
                {RATES.map((r) => <button key={r} type="button" aria-pressed={rate === r} onClick={() => setRate(r)}>{r}×</button>)}
              </div>
            </div>
            <button type="button" className="btn sm" onClick={() => { primeSpeech(); setNotice(""); say(support.tts, "Hey, I'm Bro. Let's get you licensed.", rateRef.current).catch((e) => setNotice(voiceErrorText(e, support.tts))); }}>Test voice</button>
            {clearAvailable && (
              <button type="button" role="switch" aria-checked={clearOn} className={s.switch} onClick={() => { const v = !clearOn; setClearOn(v); prefs.setClear(v); if (v) clearDown.current = false; }}>
                <span className={s.track} aria-hidden="true" />
                <span>Clear-voice listening <small className={s.hint}>Filters out background noise and Bro&rsquo;s own voice</small></span>
              </button>
            )}
            {studio.site && studio.down && <p className={s.hint} role="status">Studio voice is offline right now{staff && studio.problem ? `: ${studio.problem}` : ""}. Using the device voice.</p>}
            {!studio.site && staff && <p className={s.hint}>Bro&rsquo;s studio voice is switched off. Turn it on in Admin → Settings → Bro&rsquo;s voice.</p>}
          </div>
        )}
      </div>

      <div className={s.stage}>
        <div className={s.orbWrap} style={{ "--lvl": level } as React.CSSProperties} data-hearing={stage === "hearing" ? "1" : "0"}>
          <span className={s.ripple} aria-hidden="true" />
          <span className={s.ripple} aria-hidden="true" />
          <span className={s.ripple} aria-hidden="true" />
          <span className={s.spinner} aria-hidden="true" />
          <button type="button" className={s.orb} aria-label={orbLabel} onClick={orbTap}>
            {phase === "speaking" ? <span className={s.bars} aria-hidden="true"><i /><i /><i /><i /><i /></span>
              : phase === "thinking" ? <span className={s.dots} aria-hidden="true"><i /><i /><i /></span>
              : <Mic aria-hidden="true" />}
          </button>
        </div>
        <div className={s.status} role="status" aria-live="polite">{statusText}</div>
      </div>

      <div className={s.captions} ref={capRef} aria-live="polite">
        {!msgs.length && !heard && (
          <div className={s.empty}>
            <p>{context ? "Ask about this, or tap a suggestion." : `Ask anything about the ${state} ${TRADES[trade]} exam or the job site. Talk like you would to a buddy on the crew.`}</p>
            <div className={s.starters}>
              {starters.map((t) => <button key={t} type="button" className={s.starter} onClick={() => { primeSpeech(); ask(t); }}>{t}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => {
          const old = i < msgs.length - 2 ? ` ${s.old}` : "";
          if (m.role === "user") return <div key={i} className={`${s.turn} ${s.you}${old}`}><span className={s.who}>You</span><p>{m.content}</p></div>;
          const { body, sources } = splitSources(m.content);
          return (
            <div key={i} className={`${s.turn} ${s.bro}${old}`}>
              <span className={s.who}>Bro</span>
              {body
                ? <div className={s.text} dangerouslySetInnerHTML={{ __html: md(body) }} />
                : i === lastBro && phase === "thinking" ? <span className={s.wait} aria-label="Thinking"><i /><i /><i /></span> : null}
              <SourceList sources={sources} state={state} tone="dark" />
            </div>
          );
        })}
        {heard && <div className={`${s.turn} ${s.you} ${s.live}`}><span className={s.who}>You</span><p>{heard}</p></div>}
        {error && <AiErrorNote error={error} tone="dark" onRetry={() => { const lastQ = [...msgsRef.current].reverse().find((m) => m.role === "user"); if (lastQ) ask(lastQ.content); }} />}
        {notice && <p className={s.notice} role="status"><Info aria-hidden="true" />{notice}</p>}
      </div>

      {typing && (
        <form className={s.typeRow} onSubmit={sendTyped}>
          <label htmlFor="talk-typed" hidden>Type your question</label>
          <input id="talk-typed" ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your question…" autoComplete="off" enterKeyHint="send" />
          <button type="submit" className={s.send} aria-label="Send" disabled={!typed.trim()}><Send aria-hidden="true" /></button>
        </form>
      )}

      <div className={s.controls}>
        <div className={s.controlsInner}>
          <div className={s.side}>
            {mic && (
              <button type="button" role="switch" aria-checked={loop} className={s.switch} onClick={toggleLoop}>
                <span className={s.track} aria-hidden="true" />
                <span>Hands-free</span>
              </button>
            )}
          </div>
          <div className={s.mainCol}>
            <button ref={mainRef} type="button" className={`${s.main}${busy ? ` ${s.stop}` : ""}`} onClick={busy ? stop : orbTap}
              aria-label={busy ? "Stop" : mic ? "Tap to talk" : "Type your question"}>
              {busy ? <Square aria-hidden="true" /> : mic ? <Mic aria-hidden="true" /> : <Keyboard aria-hidden="true" />}
            </button>
            <span className={s.mainLabel} aria-hidden="true">{busy ? "Stop" : mic ? "Talk" : "Type"}</span>
          </div>
          <div className={`${s.side} ${s.right}`}>
            {support.tts && (
              <button type="button" className={s.pill} onClick={cycleRate} aria-label={`Speaking speed ${rate} times. Tap to change.`}>{rate}×</button>
            )}
            {mic && (
              <button type="button" className={s.pill} aria-pressed={typing} aria-label="Type instead"
                onClick={() => { const on = !typingRef.current; setTyping(on); if (on) { if (phaseRef.current === "listening") stop(); setTimeout(() => inputRef.current?.focus(), 50); } }}>
                <Keyboard aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Floating round "Talk to Bro" mic button (bottom-right, above the phone tab bar) that opens TalkMode. */
export function TalkButton({ context, title, label = "Talk to Bro", onOpen }: { context?: string; title?: string; label?: string; /** Use your own TalkMode instead of the built-in one */ onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={s.fab} aria-label={label} onClick={() => { primeSpeech(); if (onOpen) onOpen(); else setOpen(true); }} hidden={open}>
        <span className={s.fabPulse} aria-hidden="true" />
        <Mic aria-hidden="true" />
        <span className={s.fabLabel}>{label}</span>
      </button>
      {!onOpen && <TalkMode open={open} onClose={() => setOpen(false)} context={context} title={title} />}
    </>
  );
}
