"use client";
// Holds the current device-session id so every API call can send it (x-session-id header).
const KEY = "lb.session";
let current: string | null = null;

export function getSessionId(): string | null {
  if (current) return current;
  try { current = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  return current;
}

export function setSessionId(id: string | null) {
  current = id;
  try { id ? localStorage.setItem(KEY, id) : localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}
