"use client";
// One device at a time + home location, client side.
// The `session` edge function is the authority; this module keeps the app in sync with it.
import { useSyncExternalStore } from "react";
import { callFn, ApiError } from "@/lib/api";
import { getSessionId, setSessionId } from "@/lib/sessionId";
import { supabase } from "@/lib/supabaseClient";

export type LocationState = "home" | "away" | "outside" | "unset" | "unknown";
export type LocationInfo = {
  state: LocationState;
  city: string | null;
  region: string | null;
  home_city: string | null;
  home_region: string | null;
  away_city: string | null;
  away_region: string | null;
  away_until: string | null;
  enforce: boolean;
  home_set_now?: boolean;
  can_change_home_after?: string | null;
  away_passes_left?: number;
  ok?: boolean;
  distance_miles?: number | null;
};
export type Conflict = { device: string; city: string | null; region: string | null; last_seen: string };

export type SessionState = {
  status: "idle" | "claiming" | "ok" | "in_use" | "replaced" | "error";
  sessionId: string | null;
  location: LocationInfo | null;
  conflict: Conflict | null;
  error: string | null;
};

let state: SessionState = { status: "idle", sessionId: null, location: null, conflict: null, error: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<SessionState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
export const getSessionState = () => state;
export function useSession(): SessionState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state);
}

/** A friendly device name, e.g. "Chrome on Windows" or "Licensing Bro's app on Android" */
export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "Unknown device";
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iPhone/iPad" : /Windows/i.test(ua) ? "Windows" : /Mac OS X/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "device";
  const isApp = typeof window !== "undefined" && (window as any).Capacitor?.isNativePlatform?.();
  if (isApp) return `Licensing Bro's app on ${os}`;
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} on ${os}`;
}

let beat: ReturnType<typeof setInterval> | null = null;
function stopHeartbeat() { if (beat) clearInterval(beat); beat = null; }
function startHeartbeat() {
  stopHeartbeat();
  beat = setInterval(heartbeat, 45_000);
}

/** Claim this device as the active one. With takeover=false, another active device blocks the claim. */
export async function claimSession(takeover = false): Promise<SessionState> {
  set({ status: "claiming", error: null });
  try {
    const r = await callFn<any>("session", { action: "claim", device: deviceLabel(), takeover, session_id: getSessionId() });
    if (r.status === "in_use") {
      set({ status: "in_use", conflict: r.conflict, location: null });
      return state;
    }
    setSessionId(r.session_id);
    set({ status: "ok", sessionId: r.session_id, location: r.location, conflict: null });
    startHeartbeat();
  } catch (e: any) {
    // Offline or server not set up: let free features keep working
    set({ status: "error", error: e?.message || "Couldn't verify this device." });
  }
  return state;
}

export async function heartbeat() {
  const sid = getSessionId();
  if (!sid || state.status !== "ok") return;
  try {
    const r = await callFn<any>("session", { action: "heartbeat", session_id: sid });
    if (r.status === "replaced") {
      stopHeartbeat();
      setSessionId(null);
      set({ status: "replaced", sessionId: null, conflict: r.conflict });
    } else if (r.location) {
      set({ location: r.location });
    }
  } catch { /* transient network issue: try again next beat */ }
}

export async function releaseSession() {
  stopHeartbeat();
  const sid = getSessionId();
  setSessionId(null);
  set({ status: "idle", sessionId: null, location: null, conflict: null });
  if (sid) { try { await callFn("session", { action: "release", session_id: sid }); } catch { /* ignore */ } }
}

export async function refreshLocation() {
  try {
    const r = await callFn<any>("session", { action: "status", session_id: getSessionId() });
    if (r.location) set({ location: r.location });
    return r;
  } catch (e) { return null; }
}

/** Email a 6-digit code to the signed-in user (proves it's really them before travel/home changes). */
export async function sendSecurityCode(): Promise<void> {
  const { data } = await supabase().auth.getUser();
  const email = data.user?.email;
  if (!email) throw new ApiError("Sign in again first.", 401, "signed_out");
  const { error } = await supabase().auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) throw new ApiError(error.message, 400, "otp_failed");
}

export async function verifySecurityCode(code: string): Promise<void> {
  const { data } = await supabase().auth.getUser();
  const email = data.user?.email;
  if (!email) throw new ApiError("Sign in again first.", 401, "signed_out");
  const { error } = await supabase().auth.verifyOtp({ email, token: code.trim(), type: "email" });
  if (error) throw new ApiError("That code didn't work. Check the newest email and try again.", 400, "otp_invalid");
}

/** Turn on Travel mode where you are now (needs a fresh email code). */
export async function setAway(days: number) {
  const r = await callFn<any>("session", { action: "set_away", session_id: getSessionId(), days });
  set({ location: r.location });
  return r.location as LocationInfo;
}
export async function endAway() {
  const r = await callFn<any>("session", { action: "end_away", session_id: getSessionId() });
  set({ location: r.location });
  return r.location as LocationInfo;
}
/** Make where you are now your home location (needs a fresh email code once a home is set). */
export async function setHomeHere() {
  const r = await callFn<any>("session", { action: "set_home", session_id: getSessionId() });
  set({ location: r.location });
  return r.location as LocationInfo;
}

/** Update the stored location with a fresher copy (e.g. the `location` an outside_home error carries). */
export function updateLocation(location: LocationInfo | null | undefined) {
  if (location) set({ location });
}

/** For paid content: true when this device is the active one and the location rules pass. */
export function canWatchPaid(s: SessionState = state): boolean {
  if (s.status !== "ok") return false;
  if (!s.location || !s.location.enforce) return true;
  return s.location.state !== "outside";
}
