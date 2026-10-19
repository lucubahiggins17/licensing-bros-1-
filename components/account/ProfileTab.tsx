"use client";
// Profile: name, state, trade, exam date (profiles row) + change password.
import { useEffect, useRef, useState } from "react";
import { Save, KeyRound, Check, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { routes } from "@/lib/nav";
import { supabase } from "@/lib/supabaseClient";
import type { Trade } from "@/lib/types";
import { US_STATES } from "@/components/home/states";
import { TRADE_META, TRADE_ORDER } from "@/components/home/trades";
import s from "./Account.module.css";

const LOCAL_PROGRESS = "licensingbros.progress"; // offline copy kept by the study workspace

/** Keep the study workspace (progress.data) in step with the profile so the exam countdown and pickers match. */
async function syncStudyProgress(uid: string, patch: { examDate: string; state: string; trade: Trade }) {
  try {
    const sb = supabase();
    const { data } = await sb.from("progress").select("data").eq("user_id", uid).maybeSingle();
    if (data?.data && typeof data.data === "object") {
      await sb.from("progress").update({ data: { ...data.data, ...patch }, updated_at: new Date().toISOString() }).eq("user_id", uid);
    }
    const local = JSON.parse(localStorage.getItem(LOCAL_PROGRESS) || "null");
    if (local && typeof local === "object") localStorage.setItem(LOCAL_PROGRESS, JSON.stringify({ ...local, ...patch }));
  } catch { /* best effort */ }
}

export default function ProfileTab() {
  const { user, profile, account, refresh } = useAuth();
  const [fullName, setFullName] = useState("");
  const [state, setState] = useState("Tennessee");
  const [trade, setTrade] = useState<Trade>("gc");
  const [examDate, setExamDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    if (!profile || dirty.current) return;
    setFullName(profile.full_name || "");
    setState(profile.state || "Tennessee");
    setTrade(profile.trade || "gc");
    setExamDate(profile.exam_date || "");
  }, [profile]);

  const touch = () => { dirty.current = true; setMsg(null); };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const name = fullName.trim();
    if (!name) { setMsg({ ok: false, text: "Add your name. It goes on your certificates." }); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabase().from("profiles").update({ full_name: name.slice(0, 120), state, trade, exam_date: examDate || null }).eq("id", user.id);
    if (error) {
      setMsg({ ok: false, text: /fetch|network/i.test(error.message) ? "You're offline. Connect and try again." : "Couldn't save your profile. Try again." });
    } else {
      await syncStudyProgress(user.id, { examDate, state, trade });
      dirty.current = false;
      await refresh();
      setMsg({ ok: true, text: "Saved." });
    }
    setBusy(false);
  }

  return (
    <div className={s.stack}>
      <form className={`card ${s.card}`} onSubmit={save} aria-labelledby="pf-title">
        <div className={s.cardHead}>
          <h2 id="pf-title">Profile</h2>
          <p>This is what we use for your study plan, your certificates and the community.</p>
        </div>
        <div className={s.formGrid}>
          <label className="field" htmlFor="pf-name">Full name
            <input id="pf-name" value={fullName} maxLength={120} autoComplete="name" onChange={(e) => { touch(); setFullName(e.target.value); }} />
            <span className="hint">Shown on certificates exactly like this.</span>
          </label>
          <label className="field" htmlFor="pf-email">Email
            <input id="pf-email" value={user?.email || ""} readOnly aria-readonly="true" className={s.readOnly} />
            <span className="hint">You sign in with this email.</span>
          </label>
          <label className="field" htmlFor="pf-state">State you&rsquo;re testing in
            <select id="pf-state" value={state} onChange={(e) => { touch(); setState(e.target.value); }}>
              {US_STATES.map((st) => <option key={st} value={st}>{st}</option>)}
            </select>
          </label>
          <label className="field" htmlFor="pf-trade">Trade
            <select id="pf-trade" value={trade} onChange={(e) => { touch(); setTrade(e.target.value as Trade); }}>
              {TRADE_ORDER.map((t) => <option key={t} value={t}>{TRADE_META[t].label}</option>)}
            </select>
          </label>
          <label className="field" htmlFor="pf-exam">Exam date
            <input id="pf-exam" type="date" value={examDate} onChange={(e) => { touch(); setExamDate(e.target.value); }} />
            <span className="hint">Powers your countdown. Leave blank if you haven&rsquo;t booked yet.</span>
          </label>
        </div>
        <div className={s.actionsRow}>
          <button type="submit" className="btn primary cta" disabled={busy}><Save aria-hidden="true" />{busy ? "Saving…" : "Save profile"}</button>
          {msg && <span className={msg.ok ? s.ok : "err"} role={msg.ok ? "status" : "alert"}>{msg.ok && <Check aria-hidden="true" />}{msg.text}</span>}
        </div>
      </form>
      <PasswordCard />
      {!account?.is_admin && (
        <p className="note" style={{ margin: 0 }}>
          On the Licensing Bro&rsquo;s team? If an admin gave you an admin code, <Link href={routes.admin()} style={{ color: "var(--orange)", fontWeight: 700 }}>enter it here</Link>.
        </p>
      )}
    </div>
  );
}

function PasswordCard() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (pw.length < 8) { setMsg({ ok: false, text: "Use at least 8 characters." }); return; }
    if (pw !== pw2) { setMsg({ ok: false, text: "The two passwords don't match. Type them again." }); return; }
    setBusy(true);
    const { error } = await supabase().auth.updateUser({ password: pw });
    if (error) {
      const m = error.message || "";
      setMsg({
        ok: false,
        text: /reauth|recent/i.test(m) ? "For your security, sign out and back in, then change your password."
          : /fetch|network/i.test(m) ? "You're offline. Connect and try again."
          : m || "Couldn't change your password. Try again."
      });
    } else {
      setPw(""); setPw2("");
      setMsg({ ok: true, text: "Password changed. Use the new one next time you sign in." });
    }
    setBusy(false);
  }

  const mismatch = pw2.length > 0 && pw !== pw2;
  return (
    <form className={`card ${s.card}`} onSubmit={submit} aria-labelledby="pw-title">
      <div className={s.cardHead}>
        <h2 id="pw-title">Change password</h2>
        <p>Type the new password twice so we know it&rsquo;s right.</p>
      </div>
      <div className={s.formGrid}>
        <label className="field" htmlFor="pw-new">New password
          <input id="pw-new" type={show ? "text" : "password"} value={pw} autoComplete="new-password" minLength={8} onChange={(e) => { setPw(e.target.value); setMsg(null); }} />
          <span className="hint">At least 8 characters.</span>
        </label>
        <label className="field" htmlFor="pw-again">New password again
          <input id="pw-again" type={show ? "text" : "password"} value={pw2} autoComplete="new-password" aria-invalid={mismatch || undefined} onChange={(e) => { setPw2(e.target.value); setMsg(null); }} />
          {mismatch && <span className="hint" style={{ color: "var(--bad)" }}>Doesn&rsquo;t match yet.</span>}
        </label>
      </div>
      <div className={s.actionsRow}>
        <button type="submit" className="btn navy cta" disabled={busy || !pw || !pw2}><KeyRound aria-hidden="true" />{busy ? "Changing…" : "Change password"}</button>
        <button type="button" className="btn ghost sm" onClick={() => setShow((v) => !v)} aria-pressed={show}>
          {show ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}{show ? "Hide" : "Show"} passwords
        </button>
        {msg && <span className={msg.ok ? s.ok : "err"} role={msg.ok ? "status" : "alert"}>{msg.ok && <Check aria-hidden="true" />}{msg.text}</span>}
      </div>
    </form>
  );
}
