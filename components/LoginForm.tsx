"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { IS_APP_BUILD } from "@/lib/native";
import { setSessionId } from "@/lib/sessionId";
import { friendlyAuthError } from "@/lib/authErrors";
import { routes } from "@/lib/nav";
import Link from "next/link";

type Mode = "signin" | "signup" | "reset" | "code" | "newpw";

// Works the same in the browser and inside the Android app. Password reset uses a 6-digit
// email code so students never have to leave the app.
export default function LoginForm({ initialMode = "signin", onSignedIn }: { initialMode?: "signin" | "signup"; onSignedIn: () => void }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; owner?: string } | null>(null);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== "undefined" && !IS_APP_BUILD ? window.location.origin : "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const sb = supabase();
    try {
      if (mode === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: fullName.trim() }, ...(siteUrl ? { emailRedirectTo: `${siteUrl}/learn/` } : {}) } });
        if (error) throw error;
        if (data.session) onSignedIn();
        else { setMsg({ ok: true, text: "Check your email to confirm your account, then sign in here." }); setMode("signin"); }
      } else if (mode === "signin") {
        setSessionId(null); // a fresh sign-in gets a fresh device session
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onSignedIn();
      } else if (mode === "reset") {
        const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
        if (error) throw error;
        setMode("code"); setMsg({ ok: true, text: `We emailed a 6-digit code to ${email}.` });
      } else if (mode === "code") {
        const { error } = await sb.auth.verifyOtp({ email, token: code.trim(), type: "email" });
        if (error) throw error;
        setMode("newpw"); setMsg(null); setPassword("");
      } else if (mode === "newpw") {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
        onSignedIn();
      }
    } catch (err: any) {
      const f = friendlyAuthError(err);
      setMsg({ ok: false, text: f.text, owner: f.owner });
    } finally { setBusy(false); }
  }

  const title = { signin: "Welcome back", signup: "Create your account", reset: "Reset your password", code: "Enter your code", newpw: "Set a new password" }[mode];
  const cta = { signin: "Sign in", signup: "Create account", reset: "Email me a code", code: "Verify code", newpw: "Save password" }[mode];

  return (
    <main className="authwrap">
      <form className="formcs authcard" onSubmit={submit} style={{ gap: 0 }}>
        <div className="hazard" />
        <div className="formhead"><b>Form LB-1</b><div className="note" style={{ fontSize: 12.5 }}>{mode === "signup" ? "Free account · no card needed" : "Student sign-in"}</div></div>
        <div className="formbody">
        <h1 style={{ fontSize: 30, textTransform: "uppercase" }}>{title}</h1>
        {(mode === "signin" || mode === "signup") && (
          <div className="seg" role="group" aria-label="Account">
            <button type="button" aria-pressed={mode === "signin"} onClick={() => { setMode("signin"); setMsg(null); }}>Sign in</button>
            <button type="button" aria-pressed={mode === "signup"} onClick={() => { setMode("signup"); setMsg(null); }}>Create account</button>
          </div>
        )}
        {mode === "signup" && (
          <label className="field" htmlFor="fullName">Your name
            <input id="fullName" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <span className="hint">Shown on your certificates and in the community.</span>
          </label>
        )}
        {mode !== "newpw" && (
          <label className="field" htmlFor="email">Email
            <input id="email" type="email" autoComplete="email" required value={email} disabled={mode === "code"} onChange={(e) => setEmail(e.target.value)} />
          </label>
        )}
        {mode === "code" && (
          <label className="field" htmlFor="code">6-digit code
            <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </label>
        )}
        {(mode === "signin" || mode === "signup" || mode === "newpw") && (
          <label className="field" htmlFor="password">{mode === "newpw" ? "New password" : "Password"}
            <input id="password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}
        <button className="btn primary cta block" disabled={busy}>{busy ? "Working…" : cta}</button>
        {msg && <p className={msg.ok ? "note" : "err"} role="status" style={{ margin: 0 }}>{msg.text}</p>}
        {msg?.owner && (
          <p className="note" style={{ margin: 0, fontSize: 12.5 }}>
            <b>Site owner:</b> {msg.owner} <Link href={routes.status} style={{ color: "var(--orange)", fontWeight: 700 }}>Check the setup</Link>
          </p>
        )}
        {mode === "signin" && <button type="button" className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => { setMode("reset"); setMsg(null); }}>Forgot password?</button>}
        {(mode === "reset" || mode === "code") && <button type="button" className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => { setMode("signin"); setMsg(null); setCode(""); }}>Back to sign in</button>}
        {mode === "signup" && <p className="note" style={{ margin: 0 }}>Free accounts include free courses, free live classes and limited practice. Practice questions teach tested concepts and are not actual exam items.</p>}
        </div>
      </form>
    </main>
  );
}
