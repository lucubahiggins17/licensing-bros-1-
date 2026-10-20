"use client";
// Clear-voice listening: Bro hears the student, not the room.
//   1. The microphone opens with the device's echo cancellation, noise suppression and (where the browser has it)
//      voice isolation switched on, so Bro's own voice from the speaker and steady background noise are filtered out.
//   2. A voice detector watches only the speech band (about 250 to 3,800 Hz) against a noise floor it keeps learning,
//      so a fan, traffic or a TV doesn't count as talking. The turn ends after a short pause once the student has spoken.
//   3. The recording is transcribed on the school's voice server (VoiceStudio or any OpenAI-style transcription
//      server), which copes with accents and noise far better than the phone's built-in recognizer, and is primed
//      with exam vocabulary (NEC, GFCI, retainage...).
import { callFn } from "@/lib/api";
import type { ListenError, Listening } from "./speech";

export type ClearHandlers = {
  onFinal: (text: string) => void;
  onError: (e: ListenError | "stt", detail?: string) => void;
  /** 0..1 loudness of the student's voice (0 when only the room is heard) and whether they're talking now */
  onLevel?: (level: number, talking: boolean) => void;
  /** "listening" → "hearing" (voice detected) → "understanding" (sent to the voice server) */
  onStage?: (stage: "listening" | "hearing" | "understanding") => void;
};

export type VadState = { floor: number; talking: boolean; speechMs: number; quietMs: number; heardSpeech: boolean; calibratedMs: number };
export const VAD = { calibrateMs: 350, startRatio: 3.2, stopRatio: 1.9, minLevel: 0.012, startMs: 140, endMs: 950, floorRise: 0.02, floorFall: 0.2 };

/**
 * One step of the voice detector: given the speech-band loudness (RMS, 0..1) of the last `dt` ms, updates the noise
 * floor and decides whether the student is talking and whether their turn just ended. Pure, so it can be tested.
 */
export function vadStep(s: VadState, rms: number, dt: number): { state: VadState; ended: boolean } {
  const n = { ...s };
  if (n.calibratedMs < VAD.calibrateMs) {
    // Learn the room first (the student usually starts a moment after the beep)
    n.floor = n.calibratedMs === 0 ? rms : n.floor * 0.8 + rms * 0.2;
    n.calibratedMs += dt;
    return { state: n, ended: false };
  }
  const on = Math.max(n.floor * VAD.startRatio, VAD.minLevel);
  const off = Math.max(n.floor * VAD.stopRatio, VAD.minLevel * 0.7);
  let ended = false;
  if (!n.talking) {
    n.speechMs = rms > on ? n.speechMs + dt : 0;
    if (n.speechMs >= VAD.startMs) { n.talking = true; n.heardSpeech = true; n.quietMs = 0; }
    // The floor follows the room while nobody talks: up slowly (a fan starting), down quickly (it stopping)
    if (!n.talking) n.floor = rms > n.floor ? n.floor + (rms - n.floor) * VAD.floorRise : n.floor + (rms - n.floor) * VAD.floorFall;
  } else {
    n.quietMs = rms < off ? n.quietMs + dt : 0;
    if (n.quietMs >= VAD.endMs) { n.talking = false; n.speechMs = 0; ended = true; }
  }
  return { state: n, ended };
}

export function clearVoiceAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as any;
  return !!(navigator.mediaDevices?.getUserMedia && w.MediaRecorder && (w.AudioContext || w.webkitAudioContext));
}

function pickMime(): string {
  const MR = (window as any).MediaRecorder;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/aac"]) {
    try { if (MR.isTypeSupported?.(m)) return m; } catch { /* keep looking */ }
  }
  return "";
}

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Starts one listening turn. Resolves once the microphone is open (or failed). */
export async function clearListen(h: ClearHandlers, o: { waitMs?: number; maxMs?: number } = {}): Promise<Listening> {
  const waitMs = o.waitMs ?? 8000, maxMs = o.maxMs ?? 30000;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, voiceIsolation: true } as MediaTrackConstraints
    });
  } catch (e: any) {
    const n = e?.name;
    h.onError(n === "NotAllowedError" || n === "SecurityError" ? "denied" : n === "NotFoundError" || n === "OverconstrainedError" ? "no-mic" : n === "NotReadableError" ? "busy" : "error");
    return { stop: () => {}, abort: () => {} };
  }
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new AC();
  try { await ctx.resume(); } catch { /* resumes on the next gesture */ }
  const src = ctx.createMediaStreamSource(stream);
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 250;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3800;
  const an = ctx.createAnalyser(); an.fftSize = 1024;
  src.connect(hp); hp.connect(lp); lp.connect(an);
  const buf = new Float32Array(an.fftSize);

  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  rec.start(250);

  let vad: VadState = { floor: 0, talking: false, speechMs: 0, quietMs: 0, heardSpeech: false, calibratedMs: 0 };
  let settled = false;
  let last = performance.now();
  const t0 = last;
  h.onStage?.("listening");

  const cleanup = () => {
    clearInterval(tick);
    try { src.disconnect(); } catch { /* gone */ }
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  };
  const finish = (send: boolean, force = false) => {
    if (settled) return;
    settled = true;
    // A tap on "done talking" sends what was recorded even if the detector never heard a clear voice (a quiet speaker)
    const heard = vad.heardSpeech || (force && performance.now() - t0 > 700);
    const done = () => {
      cleanup();
      if (!send || !heard) { if (send) h.onFinal(""); return; }
      const blob = new Blob(chunks, { type: (rec.mimeType || mime || "audio/webm").split(";")[0] });
      if (blob.size < 2000) { h.onFinal(""); return; }
      h.onStage?.("understanding");
      toBase64(blob)
        .then((audio) => callFn<{ text: string }>("voice", { action: "transcribe", audio, mime: blob.type }))
        .then((r) => h.onFinal((r?.text || "").trim()))
        .catch((e: any) => h.onError("stt", e?.message || "The voice server couldn't understand that."));
    };
    if (rec.state !== "inactive") { rec.onstop = done; try { rec.stop(); } catch { done(); } }
    else done();
  };

  const tick = setInterval(() => {
    if (settled) return;
    const now = performance.now();
    const dt = now - last; last = now;
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const r = vadStep(vad, rms, dt);
    if (r.state.talking && !vad.talking) h.onStage?.("hearing");
    vad = r.state;
    h.onLevel?.(vad.talking ? Math.min(1, rms / Math.max(vad.floor * 12, 0.08)) : 0, vad.talking);
    if (r.ended) finish(true);
    else if (!vad.heardSpeech && now - t0 > waitMs) finish(true);
    else if (now - t0 > maxMs) finish(true);
  }, 40);

  return {
    stop: () => finish(true, true),   // the student tapped "done talking"
    abort: () => { if (settled) return; settled = true; try { rec.stop(); } catch { /* stopped */ } cleanup(); }
  };
}
