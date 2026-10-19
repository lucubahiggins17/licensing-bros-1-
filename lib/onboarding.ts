"use client";
// Android app onboarding: whether this device has seen it, and the trade/state/exam date picked there.
// A new account created right after onboarding starts with those choices (sent as sign-up metadata).
import type { TradeKey } from "@/lib/data";
import { US_STATES } from "@/components/home/states";

// Kept free of the question bank so the sign-in page stays small
const TRADE_KEYS: TradeKey[] = ["gc", "elec", "plumb", "hvac"];

const DONE = "lb.onboarded.v1";
const CHOICE = "lb.onboard.choice";
export type OnboardChoice = { trade: TradeKey; state: string; examDate: string };

export function isOnboarded(): boolean {
  try { return localStorage.getItem(DONE) === "1"; } catch { return true; }
}
export function markOnboarded() {
  try { localStorage.setItem(DONE, "1"); } catch { /* storage blocked */ }
}
export function resetOnboarding() {
  try { localStorage.removeItem(DONE); } catch { /* storage blocked */ }
}

export function saveChoice(c: OnboardChoice) {
  try { localStorage.setItem(CHOICE, JSON.stringify(c)); } catch { /* storage blocked */ }
}

export function readChoice(): OnboardChoice | null {
  try {
    const v = JSON.parse(localStorage.getItem(CHOICE) || "null");
    if (!v || !TRADE_KEYS.includes(v.trade) || !US_STATES.includes(v.state)) return null;
    return { trade: v.trade, state: v.state, examDate: /^\d{4}-\d{2}-\d{2}$/.test(v.examDate || "") ? v.examDate : "" };
  } catch { return null; }
}

/** Extra sign-up metadata so the new profile starts with the onboarding choices. */
export function signupExtras(): Record<string, string> {
  const c = readChoice();
  if (!c) return {};
  return { trade: c.trade, state: c.state, ...(c.examDate ? { exam_date: c.examDate } : {}) };
}
