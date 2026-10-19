"use client";
// Admin code: the claim/redeem form shown at /admin to signed-in non-admins, and the code manager in Settings.
// The server (redeem_admin_code and friends in schema.sql) does every check; this file only shows the screens.
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, KeyRound, RefreshCw, Send } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/auth";
import { IS_APP_BUILD, SITE_URL } from "@/lib/nav";
import { errMsg, fmtDate } from "./format";
import { useAdmin, ConfirmButton, ErrorBox, FormPanel, Loading, Toggle } from "./ui";
import s from "./admin.module.css";

type Redeem = { ok: boolean; code?: string; tries_left?: number; first_admin?: boolean; already?: boolean };
type CodeInfo = { code: string; enabled: boolean; updated_at: string; admins: number };

const norm = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
const siteAddress = () => (IS_APP_BUILD ? SITE_URL : typeof window !== "undefined" ? window.location.origin : SITE_URL) || "your Licensing Bro's website";

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

/** Is there an admin yet? null while loading or if the check fails. */
export function useHasAdmin() {
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase().rpc("admin_setup_status");
        if (!error && alive) setHasAdmin(!!(data as any)?.has_admin);
      } catch { /* leave as null */ }
    })();
    return () => { alive = false; };
  }, []);
  return hasAdmin;
}

// ------------------------------------------------------------------------------------------------
/** Shown at /admin to a signed-in student who isn't an admin. */
export function RedeemAdminCode({ hasAdmin }: { hasAdmin: boolean | null }) {
  const { refresh } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "bad" | "ok"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (norm(code).length < 6) { setMsg({ kind: "bad", text: "Type the whole admin code. It looks like LB-7KQ2-M9XD-4TPA." }); return; }
    setBusy(true); setMsg(null);
    try {
      const { data, error } = await supabase().rpc("redeem_admin_code", { p_code: code });
      if (error) throw error;
      const r = data as Redeem;
      if (r?.ok) {
        setMsg({ kind: "ok", text: r.first_admin ? "You're the first admin. Opening the control center…" : "You're an admin now. Opening the control center…" });
        await refresh();
        setBusy(false);
        return;
      }
      const text =
        r?.code === "wrong_code" ? `That code didn't match.${typeof r.tries_left === "number" ? ` ${r.tries_left} ${r.tries_left === 1 ? "try" : "tries"} left this hour.` : ""} Check it with whoever gave it to you.` :
        r?.code === "too_many_attempts" ? "Too many wrong tries. Wait an hour, then try again." :
        r?.code === "code_off" ? "Adding admins by code is switched off right now. Ask an admin to switch it on in Admin → Settings." :
        r?.code === "signed_out" ? "Your sign-in ran out. Sign in again, then enter the code." :
        "That didn't work. Try again.";
      setMsg({ kind: "bad", text });
    } catch (err) {
      setMsg({ kind: "bad", text: errMsg(err, "Couldn't check the code. Check your connection and try again.") });
    }
    setBusy(false);
  }

  return (
    <form className={s.redeem} onSubmit={submit}>
      <div className="field">
        <label htmlFor="admin-code-input">Admin code</label>
        <input id="admin-code-input" value={code} onChange={(e) => { setCode(e.target.value); setMsg(null); }} placeholder="LB-XXXX-XXXX-XXXX"
          autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={60} className={s.codeInput} disabled={busy} aria-describedby="admin-code-hint" />
        <span className="hint" id="admin-code-hint">
          {hasAdmin === false
            ? "Use the code shown in Supabase when you ran schema.sql. Capital letters and dashes don't matter."
            : "Ask an admin for the code. Capital letters and dashes don't matter."}
        </span>
      </div>
      {msg && <p className={msg.kind === "bad" ? "err" : s.okMsg} role={msg.kind === "bad" ? "alert" : "status"} style={{ margin: 0 }}>{msg.text}</p>}
      <button type="submit" className="btn primary cta block" disabled={busy}>
        <KeyRound aria-hidden="true" />{busy ? "Checking…" : hasAdmin === false ? "Claim admin access" : "Become an admin"}
      </button>
    </form>
  );
}

// ------------------------------------------------------------------------------------------------
/** Settings card: see, copy, share, change or switch off the admin code. */
export function AdminCodeCard() {
  const { toast } = useAdmin();
  const [info, setInfo] = useState<CodeInfo | null>(null);
  const [err, setErr] = useState("");
  const [show, setShow] = useState(false);
  const [own, setOwn] = useState("");
  const [ownErr, setOwnErr] = useState("");
  const [busy, setBusy] = useState<"" | "own" | "toggle">("");
  const [copied, setCopied] = useState<"" | "code" | "invite">("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const { data, error } = await supabase().rpc("admin_code_info");
      if (error) throw error;
      setInfo(data as CodeInfo);
    } catch (e) { setErr(errMsg(e, "Couldn't load the admin code.")); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function copy(what: "code" | "invite") {
    if (!info) return;
    const site = siteAddress();
    const text = what === "code" ? info.code
      : `You're invited to help run Licensing Bro's as an admin.\n1. Sign in (or create a free account) at ${site}/login/\n2. Open ${site}/admin/\n3. Enter this admin code: ${info.code}`;
    if (await copyText(text)) { setCopied(what); setTimeout(() => setCopied(""), 2000); toast(what === "code" ? "Code copied." : "Invite message copied. Paste it in a text or email."); }
    else toast("Couldn't copy. Press Show and copy it by hand.", "bad");
  }

  async function newCode() {
    try {
      const { data, error } = await supabase().rpc("admin_set_code", {});
      if (error) throw error;
      setInfo((x) => (x ? { ...x, code: String(data), updated_at: new Date().toISOString() } : x));
      setShow(true);
      toast("New code made. The old one no longer works.");
    } catch (e) { toast(errMsg(e), "bad"); }
  }

  async function saveOwn(e: React.FormEvent) {
    e.preventDefault();
    const n = norm(own);
    const p = n.length < 8 ? "Use at least 8 letters or numbers." : n.length > 40 ? "Use 40 letters or numbers at most." : "";
    setOwnErr(p);
    if (p) return;
    setBusy("own");
    try {
      const { data, error } = await supabase().rpc("admin_set_code", { p_code: own.trim() });
      if (error) throw error;
      setInfo((x) => (x ? { ...x, code: String(data), updated_at: new Date().toISOString() } : x));
      setOwn(""); setShow(true);
      toast("Your code is saved. The old one no longer works.");
    } catch (e2: any) {
      const m = String(e2?.message || "");
      setOwnErr(m.includes("code_too_short") ? "Use at least 8 letters or numbers." : m.includes("code_too_long") ? "Use 40 letters or numbers at most." : errMsg(e2));
    }
    setBusy("");
  }

  async function setEnabled(on: boolean) {
    if (!info) return;
    setBusy("toggle");
    const before = info.enabled;
    setInfo({ ...info, enabled: on });
    try {
      const { error } = await supabase().rpc("admin_set_code_enabled", { p_on: on });
      if (error) throw error;
      toast(on ? "The code can add admins again." : "Switched off. The code won't add anyone until you switch it back on.");
    } catch (e) { setInfo((x) => (x ? { ...x, enabled: before } : x)); toast(errMsg(e), "bad"); }
    setBusy("");
  }

  const masked = info ? info.code.replace(/[A-Z0-9]/gi, "•") : "";

  return (
    <FormPanel code="Form ST-7 · Team" title="Admin code" id="admin-code">
      {err ? <ErrorBox text={err} onRetry={load} /> : !info ? <Loading text="Loading the admin code…" /> : (
        <div className="stack" style={{ gap: 14 }}>
          <p className="note" style={{ margin: 0 }}>
            Anyone who signs in, opens <b>/admin</b> and enters this code becomes an admin with full access. Only share it with people you trust.
            There {info.admins === 1 ? "is 1 admin" : `are ${info.admins} admins`} right now. Remove admins in Students.
          </p>
          <div className={s.codeShow}>
            <code className={`mono ${s.codeText}`} aria-label={show ? `Admin code ${info.code}` : "Admin code hidden"}>{show ? info.code : masked}</code>
            <div className={s.codeBtns}>
              <button type="button" className="btn sm" onClick={() => setShow((v) => !v)} aria-pressed={show}>
                {show ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}{show ? "Hide" : "Show"}
              </button>
              <button type="button" className="btn sm" onClick={() => copy("code")}>
                {copied === "code" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}Copy code
              </button>
              <button type="button" className="btn sm primary" onClick={() => copy("invite")}>
                {copied === "invite" ? <Check aria-hidden="true" /> : <Send aria-hidden="true" />}Copy invite message
              </button>
            </div>
          </div>
          <span className="note">Last changed {fmtDate(info.updated_at)}.</span>
          <Toggle checked={info.enabled} disabled={busy === "toggle"} onChange={setEnabled} label="Code can add new admins"
            hint="Turn off when you're not adding anyone. Your current admins keep their access either way." />
          <div className={s.codeActions}>
            <ConfirmButton className="btn" onConfirm={newCode} confirmLabel="Yes, make a new code" busyLabel="Making…"
              message="The old code will stop working. People already made admin stay admins.">
              <RefreshCw aria-hidden="true" />Make a new random code
            </ConfirmButton>
          </div>
          <form className={s.ownCode} onSubmit={saveOwn}>
            <div className="field">
              <label htmlFor="own-admin-code">Or set your own code</label>
              <input id="own-admin-code" value={own} onChange={(e) => { setOwn(e.target.value); setOwnErr(""); }} placeholder="At least 8 letters or numbers" maxLength={60}
                autoComplete="off" spellCheck={false} disabled={busy === "own"} aria-describedby="own-admin-code-hint" />
              <span className="hint" id="own-admin-code-hint">Longer is safer. Capital letters, spaces and dashes are ignored when someone types it.</span>
            </div>
            {ownErr && <p className="err" role="alert" style={{ margin: 0 }}>{ownErr}</p>}
            <button type="submit" className="btn navy cta" disabled={busy === "own" || !own.trim()}>{busy === "own" ? "Saving…" : "Use this code"}</button>
          </form>
        </div>
      )}
    </FormPanel>
  );
}
