"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Mic, Sparkles, Volume2, Square } from "lucide-react";
import { useApp, PanelHead, AiErrorNote, SourceList, usePlan } from "./ctx";
import { TRADES } from "@/lib/data";
import { md, shrinkImage, splitSources, streamTutor, useAiUsage } from "@/lib/ai";
import { isApp, SpeechRecognition } from "@/lib/native";
import { routes } from "@/lib/nav";
import { askForTravelMode } from "@/components/shell/SessionGuard";
import { coachNote, proactiveStarters } from "@/lib/progress";
import { forSpeech, prefs, primeSpeech, Speaker, takeSentences, voiceErrorText, voiceSupport } from "@/components/voice/speech";
import s from "./Study.module.css";

type Msg = { role: "user" | "assistant"; content: string; error?: any };

const STARTERS: Record<string, string[]> = {
  gc: ["Quiz me on OSHA fall protection", "Explain retainage vs. lien waivers", "How do I calculate concrete yards?", "What's the difference between markup and margin?"],
  elec: ["How do I size an EGC?", "Walk me through a box-fill calculation", "When is GFCI required in a garage?", "Quiz me on voltage drop"],
  plumb: ["How do I size a drain using DFUs?", "Explain trap arms and venting", "When is a PRV required?", "Quiz me on water heater rules"],
  hvac: ["Explain superheat vs. subcooling", "What's on the EPA 608 Core section?", "How do I size a duct for 400 CFM?", "Quiz me on refrigerant recovery"]
};

export default function Tutor({ draft, clearDraft }: { draft: string; clearDraft: () => void }) {
  const { p, talk } = useApp();
  const { limits, paid } = usePlan();
  const usage = useAiUsage();
  const tradeName = TRADES[p.trade];
  // Suggestions from the student's own record come first (weakest topic, missed questions, exam countdown)
  const pro = useMemo(() => proactiveStarters(p), [p]);
  const starters = useMemo(() => [...pro.prompts, ...STARTERS[p.trade]].filter((x, i, a) => a.indexOf(x) === i).slice(0, 5), [pro, p.trade]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const [reading, setReading] = useState<number | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const speaker = useRef<Speaker | null>(null);

  // New context = fresh conversation
  useEffect(() => { setMsgs([]); }, [p.state, p.trade]);
  useEffect(() => { if (draft) { setInput(draft); clearDraft(); setTimeout(() => taRef.current?.focus(), 50); } }, [draft, clearDraft]);
  useEffect(() => { const c = chatRef.current; if (c) c.scrollTop = c.scrollHeight; }, [msgs]);
  useEffect(() => { const t = taRef.current; if (t) { t.style.height = "auto"; t.style.height = Math.min(160, t.scrollHeight) + "px"; } }, [input]);
  useEffect(() => () => speaker.current?.cancel(), []);

  /** Reads an answer aloud in the most natural voice on this device (Sources are skipped). Tap again to stop. */
  function readAloud(i: number | null, text: string) {
    primeSpeech();
    if (!speaker.current) {
      const kind = voiceSupport().tts;
      if (!kind) { setStatus("This browser can't read answers aloud."); return; }
      speaker.current = new Speaker(kind, () => prefs.rate());
      speaker.current.onIdle = () => setReading(null);
      speaker.current.onError = (e) => { setReading(null); setStatus(voiceErrorText(e, kind)); };
    }
    const sp = speaker.current;
    sp.cancel();
    if (i !== null && reading === i) { setReading(null); return; }
    setStatus("");
    takeSentences(forSpeech(text), 0, true).chunks.forEach((c) => sp.push(c));
    setReading(i);
  }

  async function send(textArg?: string, base: Msg[] = msgs) {
    const text = (textArg ?? input).trim();
    if ((!text && !photo) || busy) return;
    const content = text || "Explain the question in this photo and solve it.";
    const history: Msg[] = [...base.filter((m) => !m.error), { role: "user", content }];
    setMsgs([...history, { role: "assistant", content: "" }]);
    setInput(""); setBusy(true); setStatus("");
    speaker.current?.cancel(); setReading(null);
    ctl.current = new AbortController();
    let image;
    try { if (photo) image = await shrinkImage(photo); } catch { setStatus("That photo couldn't be read. Try another."); }
    setPhoto(null); if (fileRef.current) fileRef.current.value = "";
    try {
      const full = await streamTutor(
        { state: p.state, trade: p.trade, messages: history.slice(-16).map(({ role, content }) => ({ role, content })), image, coach: coachNote(p) || undefined },
        (t) => setMsgs([...history, { role: "assistant", content: t }]),
        ctl.current.signal
      );
      setMsgs([...history, { role: "assistant", content: full }]);
      if (autoSpeak) readAloud(history.length, full);
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setMsgs((m) => { const last = m[m.length - 1]; return last && !last.content ? m.slice(0, -1) : m; });
      } else {
        setMsgs([...history, { role: "assistant", content: e?.message || "Something interrupted the AI. Try again.", error: e }]);
        if (e?.code === "outside_home") askForTravelMode(e?.data?.location);
      }
    } finally { setBusy(false); }
  }

  function retry() {
    const base = msgs.filter((m) => !m.error);
    const last = base[base.length - 1];
    if (last?.role === "user") send(last.content, base.slice(0, -1));
  }

  // Android app: use the phone's built-in speech recognizer through the native plugin
  async function nativeMic() {
    try {
      const { available } = await SpeechRecognition.available();
      if (!available) { setStatus("Speech recognition isn't available on this phone. Use your keyboard's mic key."); return; }
      const perm = await SpeechRecognition.requestPermissions();
      if (perm?.speechRecognition !== "granted") { setStatus("Allow microphone access in your phone's settings to ask by voice."); return; }
      setListening(true); setStatus("Listening…");
      const res = await SpeechRecognition.start({ language: "en-US", maxResults: 1, prompt: "Ask your exam question", partialResults: false, popup: true });
      const said = res?.matches?.[0]?.trim();
      if (said) { setInput(said); send(said); }
    } catch {
      setStatus("Didn't catch that. Try again.");
    } finally { setListening(false); setStatus((x) => (x === "Listening…" ? "" : x)); }
  }

  function mic() {
    if (isApp()) { if (!listening) nativeMic(); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setStatus("Voice input isn't supported in this browser. Try Chrome or Safari, or use your keyboard's mic key."); return; }
    if (listening) { recRef.current?.stop(); return; }
    const rec = new SR();
    rec.lang = "en-US"; rec.interimResults = true; rec.continuous = false;
    let finalText = "";
    rec.onresult = (ev: any) => { finalText = Array.from(ev.results).map((r: any) => r[0].transcript).join(""); setInput(finalText); };
    rec.onerror = (ev: any) => setStatus(ev.error === "not-allowed" ? "Microphone access was blocked. Allow it in your browser's site settings." : "Didn't catch that. Try again.");
    rec.onend = () => { setListening(false); setStatus(""); if (finalText.trim()) send(finalText); };
    recRef.current = rec;
    try { rec.start(); setListening(true); setStatus("Listening…"); } catch { setStatus("Couldn't start the microphone."); }
  }

  const left = usage.hit ? 0 : Math.max(0, limits.ai_daily - usage.n);

  return (
    <section className="panel">
      <PanelHead
        eyebrow="AI Tutor"
        title="Ask the tutor"
        accent="anything on your exam"
        lede="Answers cite the code book and section so you can tab it in your open-book references. Type, tap the mic, snap a photo of a practice problem, or just talk it through with Bro."
        action={<button type="button" className="btn primary cta" onClick={() => talk()}><Mic aria-hidden="true" />Talk to Bro</button>}
      />
      {!paid && (
        <p className={s.planChip} style={{ alignSelf: "flex-start", margin: 0 }}>
          <Sparkles aria-hidden="true" />
          {usage.day ? `${left} of ${limits.ai_daily} free AI questions left today` : `Free plan: ${limits.ai_daily} AI questions a day`}
          {" · "}<Link href={routes.courses()}>Get more</Link>
        </p>
      )}
      <div className="row">
        {starters.map((x, i) => <button key={x} className={`chip${i < pro.prompts.length ? " hot" : ""}`} onClick={() => send(x)} disabled={busy}>{x}</button>)}
      </div>
      <div className="card">
        <div className="chat" ref={chatRef} aria-live="polite">
          <div className="msg ai" dangerouslySetInnerHTML={{ __html: md(`I'm set up for the **${p.state} ${tradeName}** exam.${pro.greeting || ` Ask me a code question, a calculation, or say "quiz me on" any topic.`}`) }} />
          {msgs.map((m, i) => {
            if (m.role === "user") return <div key={i} className="msg me">{m.content}</div>;
            if (m.error) return <div key={i} className="msg ai" style={{ background: "transparent", border: 0, padding: 0, maxWidth: "100%" }}><AiErrorNote error={m.error} onRetry={retry} /></div>;
            const streaming = busy && i === msgs.length - 1;
            const { body, sources } = splitSources(m.content);
            return (
              <div key={i} className="msg ai">
                {m.content
                  ? <div dangerouslySetInnerHTML={{ __html: md(body) }} />
                  : <p className="note" style={{ margin: 0 }}>Thinking…</p>}
                <SourceList sources={sources} state={p.state} />
                {m.content && !streaming && (
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn sm" onClick={() => readAloud(i, m.content)} aria-pressed={reading === i}>
                      {reading === i ? <><Square aria-hidden="true" />Stop reading</> : <><Volume2 aria-hidden="true" />Read aloud</>}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {photo && <p className="note" style={{ margin: "8px 0 0" }}>Photo attached: {photo.name}. Add a note or just send. <button className="btn sm" onClick={() => setPhoto(null)}>Remove</button></p>}
        <div className="compose">
          <button className="iconbtn" title="Attach a photo of a question or diagram" aria-label="Attach photo" onClick={() => fileRef.current?.click()}>
            <svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
          <button className={`iconbtn${listening ? " live" : ""}`} title="Speak your question" aria-label="Speak your question" onClick={mic}>
            <svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </button>
          <label htmlFor="ask" hidden>Your question</label>
          <textarea id="ask" ref={taRef} rows={1} value={input} placeholder="e.g. How do I size the EGC for a 60 A circuit?"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          {busy
            ? <button className="iconbtn" title="Stop" aria-label="Stop" onClick={() => ctl.current?.abort()}><svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg></button>
            : <button className="iconbtn go" title="Send" aria-label="Send" onClick={() => send()}><svg viewBox="0 0 24 24"><path d="M4 12h15M13 6l6 6-6 6" /></svg></button>}
        </div>
        <div className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
          <label className="note" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={autoSpeak} onChange={(e) => { setAutoSpeak(e.target.checked); if (e.target.checked) primeSpeech(); }} /> Read answers aloud</label>
          <span className="note" role="status">{status}</span>
        </div>
      </div>
    </section>
  );
}
