"use client";
// Voice engine for "Talk to Bro": speech-to-text and text-to-speech on the web and in the Android app,
// plus helpers that turn a streaming tutor answer into speakable sentences.
import { hasPlugin, isApp, SpeechRecognition, TextToSpeech } from "@/lib/native";
import { setSiteStudioVoice, siteStudioVoice } from "@/lib/voiceFlag";

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
const K = { rate: "lb.voice.rate", loop: "lb.voice.loop", webVoice: "lb.voice", nativeVoice: "lb.voice.native", studio: "lb.voice.studio", clear: "lb.voice.clear" };
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
  setLoop(on: boolean) { setPref(K.loop, on ? "1" : "0"); },
  /** Clear-voice listening (noise-filtered mic + the voice server's transcription), on unless turned off */
  clear(): boolean { return getPref(K.clear) !== "0"; },
  setClear(on: boolean) { setPref(K.clear, on ? "1" : "0"); }
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
/** Voices that failed to make a sound on this device this visit; skipped from then on. */
const brokenVoices = new Set<string>();
async function resolveWebVoice(): Promise<SpeechSynthesisVoice | null> {
  const ranked = (await webVoices()).filter((v) => rankVoice(v) >= 0 && !brokenVoices.has(v.voiceURI)).sort((a, b) => rankVoice(b) - rankVoice(a));
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
  const device = await deviceVoiceOptions(kind);
  return siteStudioVoice() ? [{ id: STUDIO, label: "Bro's studio voice (recommended)" }, ...device] : device;
}
async function deviceVoiceOptions(kind: TtsKind): Promise<VoiceOption[]> {
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
  if (siteStudioVoice() && studioPref()) return STUDIO;
  if (kind === "web") return (await resolveWebVoice())?.voiceURI || "";
  if (kind === "native") { const i = await resolveNativeVoice(); return i === undefined ? "" : nativeVoices?.[i]?.voiceURI || ""; }
  return "";
}
/** Remembers the student's voice choice on this device ("" = automatic). */
export async function chooseVoice(kind: TtsKind, id: string) {
  if (id === STUDIO) { setPref(K.studio, "1"); studioDownUntil = 0; return; }
  if (siteStudioVoice()) setPref(K.studio, "0");
  setPref(kind === "native" ? K.nativeVoice : K.webVoice, id);
  if (kind === "web") await resolveWebVoice();
  if (kind === "native") await resolveNativeVoice();
}

/** Call from a tap/click before speaking later (iOS Safari only allows speech that starts from a user gesture). */
let primed = false;
export function primeSpeech() {
  unlockAudio();
  if (primed || typeof window === "undefined" || isApp() || !("speechSynthesis" in window)) return;
  primed = true;
  const synth = window.speechSynthesis;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    synth.speak(u);
    // Some Chrome builds never finish a silent utterance, which would hold up every answer queued behind it
    setTimeout(() => { if (!speaking && (synth.speaking || synth.pending)) { try { synth.cancel(); lastCancel = Date.now(); } catch { /* ignore */ } } }, 1500);
  } catch { /* ignore */ }
  resolveWebVoice();
}

// ---------------------------------------------------------------------------------------------
// Text-to-speech: speaking. Each say() resolves when the sentence ends or is stopped, and throws
// SpeechError when the device can't make a sound (so the screen can say so instead of going quiet).
// ---------------------------------------------------------------------------------------------
/** "blocked": the browser wants a tap first. "failed": no voice on this device could play it. */
export class SpeechError extends Error {
  constructor(public reason: "blocked" | "failed") { super(reason === "blocked" ? "Speech needs a tap first" : "Speech failed"); }
}

let stopCurrent: (() => void) | null = null;
let speaking: SpeechSynthesisUtterance | null = null; // held so Chrome doesn't garbage-collect it mid-sentence
let lastCancel = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Outcome = "ok" | "stopped" | "blocked" | "failed";

async function webSayOnce(text: string, rate: number, voice: SpeechSynthesisVoice | null): Promise<Outcome> {
  const synth = window.speechSynthesis;
  // A stuck queue (Chrome's online voices sometimes never finish) silences everything after it: clear it first
  if (!speaking && (synth.speaking || synth.pending)) {
    try { synth.cancel(); } catch { /* ignore */ }
    lastCancel = Date.now();
  }
  // Chrome drops an utterance that starts right after cancel()
  const since = Date.now() - lastCancel;
  if (since < 150) await sleep(150 - since);
  return new Promise<Outcome>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "en-US";
    u.rate = rate;
    let finished = false;
    let started = false;
    // Watchdog: some browsers never fire onend (e.g. after a cancel or with a broken voice)
    const watch = setTimeout(() => done("ok"), Math.max(5000, (text.length * 95) / rate + 6000));
    // Nothing started: the voice is broken or the queue is stuck. If the engine says it's talking, trust it.
    const startWatch = setTimeout(() => {
      if (started || finished) return;
      if (synth.speaking && !synth.pending) return;
      try { synth.cancel(); } catch { /* ignore */ }
      lastCancel = Date.now();
      done("failed");
    }, 5000);
    function done(o: Outcome) {
      if (finished) return;
      finished = true;
      clearTimeout(watch);
      clearTimeout(startWatch);
      if (stopCurrent === stop) stopCurrent = null;
      if (speaking === u) speaking = null;
      resolve(o);
    }
    const stop = () => done("stopped");
    u.onstart = () => { started = true; };
    u.onboundary = () => { started = true; };
    u.onend = () => done("ok");
    u.onerror = (ev: any) => {
      const e = ev?.error;
      done(e === "interrupted" || e === "canceled" ? "stopped" : e === "not-allowed" ? "blocked" : "failed");
    };
    speaking = u;
    stopCurrent = stop;
    try { if (synth.paused) synth.resume(); } catch { /* ignore */ }
    try { synth.speak(u); } catch { done("failed"); }
  });
}

async function webSay(text: string, rate: number): Promise<void> {
  const voice = webVoice;
  let o = await webSayOnce(text, rate, voice);
  if (o === "failed" && voice) {
    // That voice can't play here (often an online voice): fall back to the browser's default voice for good
    brokenVoices.add(voice.voiceURI);
    if (webVoice === voice) webVoice = null;
    o = await webSayOnce(text, rate, null);
  }
  if (o === "blocked") primed = false; // let the next tap unlock speech again
  if (o === "blocked" || o === "failed") throw new SpeechError(o);
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

// ---------------------------------------------------------------------------------------------
// Bro's studio voice: the school's own voice server (VoiceStudio, or any server with the OpenAI audio API), when an
// admin switched it on. Every answer tries it first; if it can't be reached (the computer running it is asleep, say),
// Bro uses the device voice for a couple of minutes, then tries the studio again.
// ---------------------------------------------------------------------------------------------
const STUDIO = "studio";
let studioDownUntil = 0;
/** Set from the site settings: an admin switched the studio voice on. */
export const setStudioVoice = setSiteStudioVoice;
export const studioAvailable = siteStudioVoice;
/** The student's choice on this device (on unless they picked a device voice). */
export const studioPref = () => getPref(K.studio) !== "0";
export function studioOn(): boolean {
  return siteStudioVoice() && studioPref() && Date.now() >= studioDownUntil && typeof window !== "undefined" && typeof Audio !== "undefined";
}

/** Why the studio voice last failed (shown in Talk to Bro), and who wants to hear about it. */
let studioProblem = "";
const studioListeners = new Set<(why: string) => void>();
export function onStudioFallback(fn: (why: string) => void): () => void { studioListeners.add(fn); return () => { studioListeners.delete(fn); }; }
export function studioStatus(): { site: boolean; pref: boolean; down: boolean; problem: string } {
  return { site: siteStudioVoice(), pref: studioPref(), down: Date.now() < studioDownUntil, problem: studioProblem };
}

const audioCache = new Map<string, Promise<Blob>>();
const studioKey = (text: string, rate: number) => `${rate}|${text}`;
/** A sentence's audio from the studio voice. Gives up after 15 seconds (a slow server on a CPU) so Bro isn't silent. */
async function fetchAudio(text: string, rate: number): Promise<Blob> {
  const { audioFn } = await import("@/lib/api");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try { return await audioFn("voice", { text, speed: rate }, ctl.signal); }
  catch (e: any) { throw e?.name === "AbortError" ? new Error("The voice server took more than 15 seconds for one sentence (a GPU makes VoiceStudio much faster).") : e; }
  finally { clearTimeout(t); }
}
/** Starts fetching a sentence's audio while the one before it plays, so there's no gap between sentences. */
export function prefetchSpeech(text: string, rate = 1) {
  if (!studioOn() || !text.trim()) return;
  const k = studioKey(text, rate);
  if (audioCache.has(k)) return;
  const p = fetchAudio(text, rate);
  p.catch(() => {}); // handled when it's played
  audioCache.set(k, p);
  while (audioCache.size > 8) audioCache.delete(audioCache.keys().next().value as string);
}

let audioEl: HTMLAudioElement | null = null;
function player(): HTMLAudioElement {
  if (!audioEl) { audioEl = new Audio(); audioEl.preload = "auto"; }
  return audioEl;
}
// A tenth of a second of silence: playing it from a tap lets iPhones play Bro's audio later without another tap
const SILENCE = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA";
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked || !siteStudioVoice() || typeof Audio === "undefined" || isApp()) return;
  audioUnlocked = true;
  try { const el = player(); el.src = SILENCE; el.play().catch(() => { audioUnlocked = false; }); } catch { audioUnlocked = false; }
}

function studioSay(text: string, rate: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const k = studioKey(text, rate);
    const pending = audioCache.get(k) || fetchAudio(text, rate);
    audioCache.delete(k);
    let finished = false;
    let url = "";
    let watch: ReturnType<typeof setTimeout> | undefined;
    const el = player();
    function done(err?: unknown) {
      if (finished) return;
      finished = true;
      clearTimeout(watch);
      if (stopCurrent === stop) stopCurrent = null;
      el.onended = el.onerror = null;
      if (url) { try { el.pause(); } catch { /* ignore */ } URL.revokeObjectURL(url); }
      err ? reject(err) : resolve();
    }
    const stop = () => done();
    stopCurrent = stop;
    pending.then((blob) => {
      if (finished) return;
      url = URL.createObjectURL(blob);
      el.onended = () => done();
      el.onerror = () => done(new Error("audio error"));
      el.src = url;
      el.play().then(() => {
        const secs = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : text.length / 12;
        watch = setTimeout(() => done(), secs * 1000 + 4000);
      }, (e: any) => done(e?.name === "NotAllowedError" ? new SpeechError("blocked") : e));
    }, (e) => done(e));
  });
}

export async function say(kind: TtsKind, text: string, rate = 1): Promise<void> {
  if (!text.trim()) return;
  if (studioOn()) {
    try { return await studioSay(text, rate); }
    catch (e) {
      if (e instanceof SpeechError) throw e; // the browser wants a tap: the device voice would be blocked too
      studioDownUntil = Date.now() + 120_000;
      audioCache.clear();
      studioProblem = String((e as Error)?.message || "The voice server couldn't be reached.").slice(0, 240);
      studioListeners.forEach((fn) => { try { fn(studioProblem); } catch { /* listener gone */ } });
    }
  }
  if (!kind) return;
  if (kind === "web") { if (!webVoice) await resolveWebVoice(); return webSay(text, rate); }
  if (nativeVoices === null) await resolveNativeVoice();
  try { return await nativeSay(text, rate); }
  catch (e) {
    // A saved voice that's no longer installed: try the phone's default voice once
    if (nativeVoiceIndex !== undefined) {
      nativeVoiceIndex = undefined;
      try { return await nativeSay(text, rate); } catch { /* fall through */ }
    }
    throw new SpeechError("failed");
  }
}

export function stopSpeaking(kind: TtsKind) {
  const s = stopCurrent;
  stopCurrent = null;
  if (audioEl) { try { audioEl.pause(); } catch { /* ignore */ } }
  if (kind === "web") { try { window.speechSynthesis.cancel(); lastCancel = Date.now(); } catch { /* ignore */ } }
  if (kind === "native") TextToSpeech.stop().catch(() => {});
  s?.();
}

/** Plain-words explanation for a voice that couldn't play. */
export function voiceErrorText(e: unknown, kind: TtsKind): string {
  if (e instanceof SpeechError && e.reason === "blocked") return "Your browser wants a tap before Bro can talk. Tap the orb (or Test voice in the voice settings), then ask again.";
  if (kind === "native") return "Your phone couldn't play Bro's voice, so answers are shown as captions. Turn up the media volume, and check that Speech Services by Google is installed and set under Settings → Accessibility → Text-to-speech.";
  return "Your browser couldn't play Bro's voice, so answers are shown as captions. Check your volume (on iPhone, the silent switch mutes it), try another voice in the voice settings, or use Chrome, Edge or Safari.";
}

/** Breaks a long sentence at commas so no single utterance runs long (Chrome cuts off long ones). */
function splitLong(text: string, max = 200): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window_ = rest.slice(0, max);
    const cut = Math.max(window_.lastIndexOf(", "), window_.lastIndexOf("; "), window_.lastIndexOf(": "), window_.lastIndexOf(" - "));
    const at = cut > max * 0.4 ? cut + 1 : (window_.lastIndexOf(" ") > 0 ? window_.lastIndexOf(" ") : max);
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Speaks queued sentences one after another. cancel() stops instantly and drops the queue. */
export class Speaker {
  private q: string[] = [];
  private gen = 0;
  busy = false;
  /** Called when the queue runs dry (not after cancel) */
  onIdle: () => void = () => {};
  /** Called when the voice can't play; the rest of that answer is skipped (it's still on screen) */
  onError: (e: unknown) => void = () => {};
  /** After a failure, the rest of the current answer isn't attempted; cancel() (a new answer) tries again. */
  private dead = false;
  constructor(private kind: TtsKind, private rate: () => number) {}
  push(text: string) {
    if ((!this.kind && !studioOn()) || !text.trim() || this.dead) return;
    this.q.push(...splitLong(text));
    if (!this.busy) this.run(this.gen);
  }
  private async run(g: number) {
    this.busy = true;
    while (g === this.gen && this.q.length) {
      const t = this.q.shift() as string;
      prefetchSpeech(t, this.rate());
      if (this.q.length) prefetchSpeech(this.q[0], this.rate());
      try { await say(this.kind, t, this.rate()); }
      catch (e) {
        if (g !== this.gen) return;
        this.q = [];
        this.dead = true;
        this.onError(e);
      }
    }
    if (g !== this.gen) return;
    this.busy = false;
    this.onIdle();
  }
  cancel() {
    this.gen++;
    this.q = [];
    this.busy = false;
    this.dead = false;
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
    .replace(/\[Staff note:[^\]]*\]/g, "")
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

/** The tutor's "interrupted" ending (it already retried on the server), so the app can try once more by itself. */
export const wasInterrupted = (text: string) => /\[The answer was interrupted\. Try again\.\]/.test(text);

/**
 * Whether what the microphone heard is just Bro's own voice coming back from the speaker: most of its words are in
 * what Bro just said. Lets hands-free mode ignore its own echo instead of answering itself.
 */
export function isEcho(heard: string, recentlySpoken: string[]): boolean {
  const words = (heard || "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter((w) => w.length > 2);
  if (words.length < 3) return false;
  const said = new Set(recentlySpoken.join(" ").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter((w) => w.length > 2));
  if (!said.size) return false;
  return words.filter((w) => said.has(w)).length / words.length >= 0.75;
}
