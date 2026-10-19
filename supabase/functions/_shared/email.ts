// Email from the server (command center and automations) through Resend's API.
// Needs RESEND_API_KEY and EMAIL_FROM (for example: Licensing Bro's <team@yourdomain.com>) as function secrets.
// Each recipient gets their own email (nobody sees the others' addresses), up to 100 per API call.
import { HttpError } from "./common.ts";

export const emailReady = () => !!(Deno.env.get("RESEND_API_KEY") || "").trim() && !!(Deno.env.get("EMAIL_FROM") || "").trim();

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text (blank lines = paragraphs, "- " = bullets, bare links clickable) to simple, safe HTML. */
export function textToHtml(text: string, siteUrl = ""): string {
  const blocks = text.replace(/\r\n?/g, "\n").trim().split(/\n{2,}/);
  const linkify = (s: string) => esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#f26a1b">${u}</a>`);
  const body = blocks.map((b) => {
    const lines = b.split("\n");
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) return `<ul style="padding-left:20px;margin:0 0 14px">${lines.map((l) => `<li style="margin:4px 0">${linkify(l.replace(/^\s*[-•]\s+/, ""))}</li>`).join("")}</ul>`;
    return `<p style="margin:0 0 14px;line-height:1.55">${lines.map(linkify).join("<br>")}</p>`;
  }).join("");
  return `<div style="font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;color:#1b1f3b;max-width:600px;margin:0 auto;padding:8px">
<div style="border-bottom:4px solid #f26a1b;padding-bottom:8px;margin-bottom:18px;font-weight:900;letter-spacing:.04em;text-transform:uppercase">Licensing <span style="color:#f26a1b">Bro's</span></div>
${body}
<p style="margin:22px 0 0;font-size:12px;color:#6b7090">Sent from Licensing Bro's${siteUrl ? ` · <a href="${esc(siteUrl)}" style="color:#6b7090">${esc(siteUrl.replace(/^https?:\/\//, ""))}</a>` : ""}</p></div>`;
}

export async function sendEmails(to: string[], subject: string, text: string): Promise<{ sent: number; failed: number }> {
  const key = (Deno.env.get("RESEND_API_KEY") || "").trim();
  const from = (Deno.env.get("EMAIL_FROM") || "").trim();
  if (!key || !from) throw new HttpError(503, "not_configured", "Email isn't set up yet. Add the RESEND_API_KEY and EMAIL_FROM secrets in GitHub and rerun Build Android app.");
  const list = [...new Set(to.map((x) => x.trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))].slice(0, 2000);
  const site = (Deno.env.get("SITE_URL") || "").replace(/\/+$/, "");
  const html = textToHtml(text, site);
  let sent = 0, failed = 0;
  for (let i = 0; i < list.length; i += 100) {
    const batch = list.slice(i, i + 100).map((addr) => ({ from, to: [addr], subject: subject.slice(0, 200), text, html }));
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(batch)
      });
      if (res.ok) sent += batch.length;
      else { failed += batch.length; console.warn("resend", res.status, (await res.text()).slice(0, 300)); }
    } catch (e) {
      failed += batch.length;
      console.warn("resend", (e as Error)?.message);
    }
  }
  return { sent, failed };
}
