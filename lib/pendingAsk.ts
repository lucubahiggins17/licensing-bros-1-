"use client";
// Hands a question to the AI tutor on another page: set it, then open /learn/#tutor and it lands in the box.
const KEY = "lb.ask";

export function setPendingAsk(text: string) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ text: text.slice(0, 600), at: Date.now() })); } catch { /* storage blocked */ }
}

/** Reads and clears the waiting question (ignored after 10 minutes). */
export function takePendingAsk(): string {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const v = JSON.parse(raw || "null");
    if (!v || typeof v.text !== "string" || Date.now() - Number(v.at) > 600e3) return "";
    return v.text;
  } catch { return ""; }
}
