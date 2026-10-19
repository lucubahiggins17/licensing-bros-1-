"use client";
import { Capacitor, registerPlugin } from "@capacitor/core";

// Native features when running as the Android app. Everything here is a no-op on the website.
export const isApp = () => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};
export const IS_APP_BUILD = process.env.NEXT_PUBLIC_TARGET === "app";

/** True inside the app when the native plugin is compiled into this APK. */
export const hasPlugin = (name: string) => {
  try { return isApp() && Capacitor.isPluginAvailable(name); } catch { return false; }
};

type Handle = { remove: () => Promise<void> };

/** @capacitor-community/speech-recognition (mobile/package.json) */
export type SpeechRecognitionPlugin = {
  available(): Promise<{ available: boolean }>;
  start(o?: { language?: string; maxResults?: number; prompt?: string; popup?: boolean; partialResults?: boolean }): Promise<{ matches?: string[] }>;
  stop(): Promise<void>;
  checkPermissions(): Promise<{ speechRecognition: string }>;
  requestPermissions(): Promise<{ speechRecognition: string }>;
  addListener(event: "partialResults", fn: (d: { matches: string[] }) => void): Promise<Handle>;
  addListener(event: "listeningState", fn: (d: { status: "started" | "stopped" }) => void): Promise<Handle>;
};

/** @capacitor-community/text-to-speech 6.1.0 (mobile/package.json) */
export type TextToSpeechPlugin = {
  speak(o: { text: string; lang?: string; rate?: number; pitch?: number; volume?: number; voice?: number; queueStrategy?: 0 | 1 }): Promise<void>;
  stop(): Promise<void>;
  getSupportedVoices(): Promise<{ voices: { default: boolean; lang: string; localService: boolean; name: string; voiceURI: string }[] }>;
};

const App = registerPlugin<any>("App");
const StatusBar = registerPlugin<any>("StatusBar");
export const SpeechRecognition = registerPlugin<SpeechRecognitionPlugin>("SpeechRecognition");
export const TextToSpeech = registerPlugin<TextToSpeechPlugin>("TextToSpeech");

export async function setupNativeChrome() {
  if (!isApp()) return;
  try {
    await StatusBar.setBackgroundColor({ color: "#1b1f3b" });
    await StatusBar.setStyle({ style: "DARK" });
  } catch { /* plugin missing: keep defaults */ }
}

// Android back button. Handlers form a stack: the newest (e.g. an open full-screen voice chat) runs first.
// If none handles the press, go back in history, or close the app on the first screen.
const backHandlers: (() => boolean)[] = [];
let backSub: Promise<Handle | null> | null = null;

/** Calls `handler` for the Android back button. Return true if it handled the press. */
export function onBackButton(handler: () => boolean): () => void {
  if (!isApp()) return () => {};
  backHandlers.push(handler);
  if (!backSub) {
    backSub = App.addListener("backButton", (ev: { canGoBack?: boolean }) => {
      for (let i = backHandlers.length - 1; i >= 0; i--) {
        try { if (backHandlers[i]()) return; } catch { /* keep going */ }
      }
      if (ev?.canGoBack) window.history.back();
      else App.exitApp();
    }).catch(() => null);
  }
  return () => {
    const i = backHandlers.lastIndexOf(handler);
    if (i >= 0) backHandlers.splice(i, 1);
    if (!backHandlers.length && backSub) {
      const sub = backSub;
      backSub = null;
      sub.then((s) => s?.remove()).catch(() => {});
    }
  };
}
