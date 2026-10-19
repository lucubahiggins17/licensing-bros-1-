"use client";
// Voice engine for "Talk to Bro": speech-to-text and text-to-speech on the web and in the Android app,
// plus helpers that turn a streaming tutor answer into speakable sentences.
import { hasPlugin, isApp, SpeechRecognition, TextToSpeech } from "@/lib/native";

export type SttKind = "web" | "native" | null;
export type TtsKind = "web" | "native" | null;

/** What this device can do. Inside the app the native plugins are used; on the web, the browser's speech APIs. */
export function voiceSupport(): { stt: SttKind; tts: TtsKind } {
  if (typeof window === "undefined") return { stt: null, tts: null };
  const w = window as any;
  const webTts: TtsKind = "speechSynthesis" in w && typeof w.SpeechSynthesisUtterance !== "undefined" ? "web" : null;
  if (isApp()) {
    return { stt: hasPlugin("SpeechRecognition") ? "native" : null, tts: hasPlugin("TextToSpeech") ? "native" : webTts };
  }
  return { stt: w.SpeechRecognition || w.webkitSpeechRecognition ? "web" : null, tts: webTts };
}

// ---------------------------------------------------------------------------------------------
// Preferences (per device)
// ---------------------------------------------------------------------------------------------
const K = { rate: "lb.voice.rate", loop: "lb.voice.loop", webVoice: "lb.voice", nativeVoice: "lb.voice.native" };
function getPref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function setPref(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* storage blocked */ }
}
export const RATES = [0.9, 1, 1.15, 1.3];
export const prefs = {
  rate(): number { const r = Number(getPref(K.rate)); return RATES.includes(r) ? r : 1; },
  setRate(r: number) { setPref(K.rate, String(r)); },
  loop(): boolean { return getPref(K.loop) !== "0"; },
  setLoop(on: boolean) { setPref(K.loop, on ? "1" : "0"); }
};

// ---------------------------------------------------------------------------------------------
// Text-to-speech: voices
// ---------------------------------------------------------------------------------------------
let voicesWait: Promise<SpeechSynthesisVoice[]> | null = null;
function webVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve([]);
  const now = window.speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  if (!voicesWait) {
    voicesWait = new Promise((resolve) => {
      const done = () => { clearTimeout(t); resolve(window.speechSynthesis.getVoices()); };
      const t = setTimeout(done, 1500);
      window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    });
  }
  return voicesWait;
}

/** Higher = more natural. Non-English voices score below zero. */
function rankVoice(v: { name: string; lang: string; localService?: boolean; default?: boolean }): number {
  if (!/^en([-_]|$)/i.test(v.lang)) return -1;
  const n = v.name;
  let s = 0;
  if (/natural|neural/i.test(n)) s += 50;
  if (/google us english/i.test(n)) s += 40;
  if (/\b(samantha|aaron|ava)\b/i.test(n)) s += 35;
  if (/online/i.test(n)) s += 20;
  if (/premium|enhanced/i.test(n)) s += 15;
  if (/en[-_]us/i.test(v.lang)) s += 10;
  if (v.localService === false) s += 3;
  if (/espeak|compact|novelty|whisper|zarvox|bells|bubbles|cellos|jester|organ|trinoids|bad news|good news|albert/i.test(n)) s -= 40;
  if (v.default) s += 1;
  return s;
}

let webVoice: SpeechSynthesisVoice | null = null;
let webVoiceExplicit = false;
async function resolveWebVoice(): Promise<SpeechSynthesisVoice | null> {
  const ranked = (await webVoices()).filter((v) => rankVoice(v) >= 0).sort((a, b) => rankVoice(b) - rankVoice(a));
  const saved = getPref(K.webVoice);
  const pick = ranked.find((v) => v.voiceURI === saved);
  webVoiceExplicit = !!pick;
  webVoice = pick || ranked[0] || null;
  return webVoice;
}
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  // Some browsers (Edge, Chrome) add their best online voices a moment after load
  try { window.speechSynthesis.addEventListener("voiceschanged", () => { if (!webVoiceExplicit) resolveWebVoice(); }); } catch { /* old browser */ }
}

let nativeVoices: { name: string; lang: string; voiceURI: string; localService: boolean; default: boolean }[] | null = null;
let nativeVoiceIndex: number | undefined;
async function resolveNativeVoice(): Promise<number | undefined> {
  if (!nativeVoices) {
    try { nativeVoices = (await TextToSpeech.getSupportedVoices()).voices || []; } catch { nativeVoices = []; }
  }
  const saved = getPref(K.nativeVoice);
  const i = saved ? nativeVoices.findIndex((v) => v.voiceURI === saved) : -1;
  nativeVoiceIndex = i >= 0 ? i : undefined; // undefined = the phone's default voice
  return nativeVoiceIndex;
}

export type VoiceOption = { id: string; label: string };
/** English voices for the picker, most natural first. */
export async function voiceOptions(kind: TtsKind): Promise<VoiceOption[]> {
  if (kind === "web") {
    return (await webVoices()).filter((v) => rankVoice(v) >= 0).sort((a, b) => rankVoice(b) - rankVoice(a))
      .map((v) => ({ id: v.voiceURI, label: `${v.name.replace(/^Microsoft\s+/, "").replace(/\s+-\s+English.*$/, "")} (${v.lang})` }));
  }
  if (kind === "native") {
    await resolveNativeVoice();
    return (nativeVoices || []).filter((v) => rankVoice(v) >= 0).sort((a, b) => rankVoice(b) - rankVoice(a))
      .map((v) => ({ id: v.voiceURI, label: `${v.name}${v.localService ? "" : " (online)"}` }));
  }
  return [];
}
export async function currentVoiceId(kind: TtsKind): Promise<string> {
  if (kind === "web") return (await resolveWebVoice())?.voiceURI || "";
  if (kind === "native") { const i = await resolveNativeVoice(); return i === undefined ? "" : nativeVoices?.[i]?.voiceURI || ""; }
  return "";
}
/** Remembers the student's voice choice on this device ("" = automatic). */
export async function chooseVoice(kind: TtsKind, id: string) {
  setPref(kind === "native" ? K.nativeVoice : K.webVoice, id);
  if (kind === "web") await resolveWebVoice();
  if (kind === "native") await resolveNativeVoice();
}

/** Call from a tap/click before speaking later (iOS Safari only allows speech that starts from a user gesture). */
let primed = false;
export function primeSpeech() {
  if (primed || typeof window === "undefined" || isApp() || !("speechSynthesis" in window)) return;
  primed = true;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch { /* ignore */ }
  resolveWebVoice();
}

// ---------------------------------------------------------------------------------------------
// Text-to-speech: speaking. Each say() resolves when the sentence ends or is stopped.
// ---------------------------------------------------------------------------------------------
let stopCurrent: (() => void) | null = null;
let speaking: SpeechSynthesisUtterance | null = null; // held so Chrome doesn't garbage-collect it mid-sentence

function webSay(text: string, rate: number): Promise<void> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    if (webVoice) { u.voice = webVoice; u.lang = webVoice.lang; } else u.lang = "en-US";
    u.rate = rate;
    let finished = false;
    // Watchdog: some browsers never fire onend (e.g. after a cancel or with a broken voice)
    const watch = setTimeout(() => done(), Math.max(5000, (text.length * 95) / rate + 4000));
    function done() {
      if (finished) return;
      finished = true;
      clearTimeout(watch);
      if (stopCurrent === done) stopCurrent = null;
      if (speaking === u) speaking = null;
      resolve();
    }
    u.onend = done;
    u.onerror = done;
    speaking = u;
    stopCurrent = done;
    try { if (synth.paused) synth.resume(); } catch { /* ignore */ }
    synth.speak(u);
  });
}

function nativeSay(text: string, rate: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const watch = setTimeout(() => done(), Math.max(6000, (text.length * 110) / rate + 5000));
    function done(err?: unknown) {
      if (finished) return;
      finished = true;
      clearTimeout(watch);
      if (stopCurrent === done) stopCurrent = null;
      err ? reject(err) : resolve();
    }
    stopCurrent = done;
    TextToSpeech.speak({ text, lang: "en-US", rate, pitch: 1, volume: 1, queueStrategy: 0, ...(nativeVoiceIndex !== undefined ? { voice: nativeVoiceIndex } : {}) })
      .then(() => done(), (e) => done(e));
  });
}

export async function say(kind: TtsKind, text: string, rate = 1): Promise<void> {
  if (!kind || !text.trim()) return;
  if (kind === "web") { if (!webVoice) await resolveWebVoice(); return webSay(text, rate); }
  if (nativeVoices === null) await resolveNativeVoice();
  return nativeSay(text, rate);
}

export function stopSpeaking(kind: TtsKind) {
  const s = stopCurrent;
  stopCurrent = null;
  if (kind === "web") { try { window.speechSynthesis.cancel(); } catch { /* ignore */ } }
  if (kind === "native") TextToSpeech.stop().catch(() => {});
  s?.();
}

/** Speaks queued sentences one after another. cancel() stops instantly and drops the queue. */
export class Speaker {
  private q: string[] = [];
  private gen = 0;
  busy = false;
  /** Called when the queue runs dry (not after cancel) */
  onIdle: () => void = () => {};
  /** Called once if the voice engine fails */
  onError: () => void = () => {};
  private failed = false;
  constructor(private kind: TtsKind, private rate: () => number) {}
  push(text: string) {
    if (!this.kind || !text.trim()) return;
    this.q.push(text);
    if (!this.busy) this.run(this.gen);
  }
  private async run(g: number) {
    this.busy = true;
    while (g === this.gen && this.q.length) {
      const t = this.q.shift() as string;
      try { await say(this.kind, t, this.rate()); }
      catch { if (!this.failed) { this.failed = true; this.onError(); } }
    }
    if (g !== this.gen) return;
    this.busy = false;
    this.onIdle();
  }
  cancel() {
    this.gen++;
    this.q = [];
    this.busy = false;
    stopSpeaking(this.kind);
  }
}

// ---------------------------------------------------------------------------------------------
// Speech-to-text
// ---------------------------------------------------------------------------------------------
export type ListenError = "unsupported" | "denied" | "no-mic" | "network" | "busy" | "error";
export type ListenHandlers = {
  onPartial: (text: string) => void;
  /** Final transcript; "" when nothing was heard */
  onFinal: (text: string) => void;
  onError: (e: ListenError) => void;
};
export type Listening = { stop: () => void; abort: () => void };
const NOOP: Listening = { stop: () => {}, abort: () => {} };

export function startListening(kind: SttKind, h: ListenHandlers): Promise<Listening> {
  if (kind === "web") return Promise.resolve(webListen(h));
  if (kind === "native") return nativeListen(h);
  h.onError("unsupported");
  return Promise.resolve(NOOP);
}

function webListen(h: ListenHandlers): Listening {
  const w = window as any;
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!SR) { h.onError("unsupported"); return NOOP; }
  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let text = "";
  let err: ListenError | null = null;
  let settled = false;
  rec.onresult = (ev: any) => {
    let t = "";
    for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
    text = t;
    if (!settled) h.onPartial(t.trim());
  };
  rec.onerror = (ev: any) => {
    const e = ev?.error;
    if (e === "no-speech" || e === "aborted") return;
    err = e === "not-allowed" || e === "service-not-allowed" ? "denied" : e === "audio-capture" ? "no-mic" : e === "network" ? "network" : e === "language-not-supported" ? "unsupported" : "error";
  };
  rec.onend = () => {
    if (settled) return;
    settled = true;
    if (text.trim()) h.onFinal(text.trim());
    else if (err) h.onError(err);
    else h.onFinal("");
  };
  try { rec.start(); } catch { settled = true; h.onError("busy"); return NOOP; }
  return {
    stop: () => { try { rec.stop(); } catch { /* already stopped */ } },
    abort: () => { settled = true; try { rec.abort(); } catch { /* already stopped */ } }
  };
}

async function nativeListen(h: ListenHandlers): Promise<Listening> {
  const SR = SpeechRecognition;
  try {
    const { available } = await SR.available();
    if (!available) { h.onError("unsupported"); return NOOP; }
    let perm = await SR.checkPermissions();
    if (perm?.speechRecognition !== "granted") perm = await SR.requestPermissions();
    if (perm?.speechRecognition !== "granted") { h.onError("denied"); return NOOP; }
  } catch {
    h.onError("unsupported");
    return NOOP;
  }
  let last = "";
  let settled = false;
  let began = false;
  let ended = false;
  const handles: { remove: () => Promise<void> }[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const cleanup = () => { timers.forEach(clearTimeout); handles.forEach((x) => x.remove().catch(() => {})); };
  const finish = (err?: ListenError) => {
    if (settled) return;
    settled = true;
    cleanup();
    const t = last.trim();
    if (t) h.onFinal(t);
    else if (err) h.onError(err);
    else h.onFinal("");
  };
  // With partial results the plugin resolves start() right away and reports text through events.
  // After "stopped" (end of speech) the next partialResults event carries the final transcript.
  const endSoon = (ms: number) => timers.push(setTimeout(() => finish(), ms));
  try {
    handles.push(await SR.addListener("partialResults", (d) => {
      const t = d?.matches?.[0] || "";
      if (t) { last = t; began = true; if (!settled) h.onPartial(t); }
      if (ended) finish();
    }));
    handles.push(await SR.addListener("listeningState", (d) => {
      if (d?.status === "started") began = true;
      else if (d?.status === "stopped") { ended = true; endSoon(2000); }
    }));
  } catch { /* older plugin: the timers below still end the turn */ }
  timers.push(setTimeout(() => { if (!began) { SR.stop().catch(() => {}); finish(); } }, 7000));
  timers.push(setTimeout(() => { ended = true; SR.stop().catch(() => {}); endSoon(1500); }, 30000));
  SR.start({ language: "en-US", maxResults: 1, partialResults: true, popup: false })
    .catch(() => finish("error"));
  return {
    stop: () => { if (settled) return; ended = true; SR.stop().catch(() => {}); endSoon(1500); },
    abort: () => { if (settled) return; settled = true; cleanup(); SR.stop().catch(() => {}); }
  };
}

// ---------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------
/**
 * What to read aloud: drops the "Sources:" list, links and markdown symbols.
 * Works on partial (streaming) text: text before a finished sentence never changes as more arrives.
 */
export function forSpeech(text: string): string {
  let s = text;
  const cut = s.search(/(^|\n)[ \t]*[*_#>]*[ \t]*sources?[ \t]*[*_]*[ \t]*[:：]/i);
  if (cut >= 0) s = s.slice(0, cut);
  return s
    .replace(/\[The answer was interrupted\. Try again\.\]/g, "")
    .replace(/\]\([^)\s]*\)?/g, "")
    .replace(/\(?\bhttps?:\/\/[^\s)]*\)?/g, "")
    .replace(/\bwww\.[^\s)]+/g, "")
    .replace(/[*_`#>|~[\]]/g, "")
    .replace(/^[ \t]*[-•][ \t]+/gm, "")
    .replace(/\s×\s/g, " times ")
    .replace(/\s÷\s/g, " divided by ")
    .replace(/°/g, " degrees ")
    .replace(/&/g, " and ")
    .replace(/[ \t]+/g, " ");
}

const ABBR = /\b(?:e\.g|i\.e|vs|approx|sec|art|fig|mr|mrs|ms|dr|st)\.$/i;
const BOUNDARY = /([.!?…]+["'”’)\]]*)(?=\s)|\n+/g;

/**
 * Pulls finished sentences out of growing text, starting at `from`.
 * Short sentences are merged with the next one so speech doesn't sound choppy.
 * With final=true, whatever is left is returned too.
 */
export function takeSentences(s: string, from: number, final: boolean): { chunks: string[]; upTo: number } {
  const chunks: string[] = [];
  let start = Math.min(from, s.length);
  BOUNDARY.lastIndex = start;
  for (let m = BOUNDARY.exec(s); m; m = BOUNDARY.exec(s)) {
    const end = m.index + m[0].length;
    const piece = s.slice(start, end);
    if (m[1] === "." && ABBR.test(piece.trimEnd())) continue;
    const clean = piece.replace(/\s+/g, " ").trim();
    if (!/[a-z0-9]/i.test(clean)) { start = end; continue; }
    if (clean.length < 14 && !final) continue;
    chunks.push(clean);
    start = end;
  }
  if (final) {
    const rest = s.slice(start).replace(/\s+/g, " ").trim();
    if (/[a-z0-9]/i.test(rest)) chunks.push(rest);
    start = s.length;
  }
  return { chunks, upTo: start };
}
