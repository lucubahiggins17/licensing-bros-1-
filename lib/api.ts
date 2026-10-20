"use client";
// Calls Licensing Bro's edge functions (Supabase Functions) with the student's sign-in and device session.
import { accessToken } from "@/lib/supabaseClient";
import { getSessionId } from "@/lib/sessionId";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/env";

export class ApiError extends Error {
  status: number;
  code: string;
  data: any;
  constructor(message: string, status: number, code = "error", data: any = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export const FUNCTIONS_URL = () => `${SUPABASE_URL}/functions/v1`;

export async function fnHeaders(requireAuth = true): Promise<Record<string, string>> {
  const t = await accessToken();
  if (!t && requireAuth) throw new ApiError("Sign in to continue.", 401, "signed_out");
  const h: Record<string, string> = { "content-type": "application/json", apikey: SUPABASE_KEY };
  if (t) h.authorization = `Bearer ${t}`;
  const sid = getSessionId();
  if (sid) h["x-session-id"] = sid;
  return h;
}

async function toError(res: Response): Promise<ApiError> {
  let msg = "Something went wrong. Try again.";
  let code = "error";
  let data: any = null;
  try {
    data = await res.json();
    if (data?.error) msg = data.error;
    if (data?.code) code = data.code;
  } catch { /* not JSON */ }
  return new ApiError(msg, res.status, code, data);
}

/** Message shown when the site's server functions haven't been deployed yet (owner setup, not the student's internet). */
export const NOT_SET_UP_MSG = "This part of the site isn't switched on yet. The site owner still needs to finish setup.";

/**
 * A request to a function failed before any answer came back. That's either no internet, or the function was never
 * deployed (Supabase answers a missing function without the headers browsers need, so it looks like a network error).
 * Asking Supabase's sign-in settings page tells the two apart: if that answers, the internet is fine.
 */
async function networkError(offlineMsg: string): Promise<ApiError> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return new ApiError(offlineMsg, 0, "offline");
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY }, signal: ctrl.signal });
    clearTimeout(t);
    if (r.status < 500) return new ApiError(NOT_SET_UP_MSG, 0, "not_set_up");
  } catch { /* really can't reach the internet */ }
  return new ApiError(offlineMsg, 0, "offline");
}

/** POST to an edge function and return its JSON. Throws ApiError with a student-friendly message. */
export async function callFn<T = any>(name: string, body: unknown = {}, opts: { signal?: AbortSignal; auth?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_URL()}/${name}`, { method: "POST", headers: await fnHeaders(opts.auth !== false), body: JSON.stringify(body), signal: opts.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    if (e instanceof ApiError) throw e;
    throw await networkError("You're offline. Check your connection and try again.");
  }
  if (!res.ok) throw await toError(res);
  return res.json();
}

/** POST to an edge function that streams plain text; calls onText with the full text so far. */
export async function streamFn(name: string, body: unknown, onText: (text: string) => void, signal?: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_URL()}/${name}`, { method: "POST", headers: await fnHeaders(), body: JSON.stringify(body), signal });
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    if (e instanceof ApiError) throw e;
    throw await networkError("You're offline. The AI needs internet; practice exams, games and calculators still work.");
  }
  if (!res.ok || !res.body) throw await toError(res);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
    onText(text);
  }
  return text;
}

/** POST to an edge function that answers with audio (Bro's studio voice); returns the audio as a Blob. */
export async function audioFn(name: string, body: unknown, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(`${FUNCTIONS_URL()}/${name}`, { method: "POST", headers: await fnHeaders(), body: JSON.stringify(body), signal });
  if (!res.ok) throw await toError(res);
  const type = res.headers.get("content-type") || "";
  if (!type.startsWith("audio")) throw new ApiError("The voice server didn't send audio.", 502, "voice_unavailable");
  return res.blob();
}
