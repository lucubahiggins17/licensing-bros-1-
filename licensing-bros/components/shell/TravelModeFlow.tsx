"use client";
// Outside-home flow: explain, email a code, verify, then turn on Travel mode where the student is now.
import { useState } from "react";
import { Plane, MapPin, Mail } from "lucide-react";
import { useSession, sendSecurityCode, verifySecurityCode, setAway, setHomeHere } from "@/lib/session";
import { useAuth } from "@/lib/auth";

const place = (city?: string | null, region?: string | null) => [city, region].filter(Boolean).join(", ") || "an unknown location";

function friendly(e: any): string {
  const d = e?.data || {};
  switch (e?.code) {
    case "home_change_too_soon":
      return `Your home area was changed recently. You can move it again on ${d.can_change_home_after ? new Date(d.can_change_home_after).toLocaleDateString() : "a later date"}. Use Travel mode until then.`;
    case "no_passes_left":
      return `You've used all your travel passes for now. The next one opens ${d.next_pass_at ? new Date(d.next_pass_at).toLocaleDateString() : "soon"}. Contact support if you've moved.`;
    case "location_unknown":
      return "We couldn't tell where you are right now. Turn off any VPN, then try again.";
    case "otp_required":
      return "Please confirm with a fresh email code first.";
    default:
      return e?.message || "That didn't work. Try again.";
  }
}

/**
 * reason "blocked": opened because paid content was refused outside the home area (default).
 * reason "manage": opened from Account to plan a trip or move home.
 */
export default function TravelModeFlow({ onClose, intent = "away", reason = "blocked" }: { onClose: () => void; intent?: "away" | "home"; reason?: "blocked" | "manage" }) {
  const s = useSession();
  const loc = s.location;
  const rules = useAuth().settings.location_rules;
  const maxDays = rules?.away_max_days ?? 30;
  const homeDays = rules?.home_change_days ?? 30;
  const dayOptions = [3, 7, 14, 21, 30, 45, 60, 90].filter((d) => d <= maxDays);
  const [step, setStep] = useState<"explain" | "code" | "done">("explain");
  const [days, setDays] = useState(Math.min(rules?.away_default_days ?? 14, rules?.away_max_days ?? 30));
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<"away" | "home">(intent);

  async function send() {
    setBusy(true); setErr("");
    try { await sendSecurityCode(); setStep("code"); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  async function confirm() {
    setBusy(true); setErr("");
    try {
      await verifySecurityCode(code);
      if (mode === "away") await setAway(days); else await setHomeHere();
      setStep("done");
    } catch (e: any) { setErr(friendly(e)); }
    setBusy(false);
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="tm-title">
      <div className="dialog">
        <div className="hazard thin" />
        <div className="dbody">
          {step === "explain" && (
            <>
              <MapPin size={34} color="var(--orange)" aria-hidden="true" />
              <h2 id="tm-title">{reason === "blocked" ? "You\u2019re away from home" : mode === "away" ? "Turn on Travel mode" : "Move your home area"}</h2>
              <p style={{ margin: 0 }}>
                {reason === "blocked"
                  ? <>You&rsquo;re in <b>{place(loc?.city, loc?.region)}</b>. Paid courses and classes play in your home area (<b>{place(loc?.home_city, loc?.home_region)}</b>) or anywhere you turn on Travel mode.</>
                  : <>Right now you&rsquo;re in <b>{place(loc?.city, loc?.region)}</b>. Your home area is <b>{place(loc?.home_city, loc?.home_region)}</b>. {mode === "away" ? "Travel mode lets you watch paid lessons and classes where you are now." : "Moving your home area makes where you are now your new home."}</>}
              </p>
              <div className="seg" role="group" aria-label="What would you like to do?">
                <button aria-pressed={mode === "away"} onClick={() => setMode("away")}>I&rsquo;m traveling</button>
                <button aria-pressed={mode === "home"} onClick={() => setMode("home")}>I moved here</button>
              </div>
              {mode === "away" ? (
                <label className="field" htmlFor="tm-days">Travel mode length
                  <select id="tm-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                    {dayOptions.map((d) => <option key={d} value={d}>{d} days</option>)}
                  </select>
                  <span className="hint">{typeof loc?.away_passes_left === "number" ? `${loc.away_passes_left} travel passes left in the next 90 days.` : "Limited travel passes per 90 days."}</span>
                </label>
              ) : (
                <p className="note" style={{ margin: 0 }}>Your home area can be changed once every {homeDays} days.</p>
              )}
              <p className="note" style={{ margin: 0 }}><Mail size={13} style={{ verticalAlign: "-2px" }} aria-hidden="true" /> We&rsquo;ll email you a 6-digit code to confirm it&rsquo;s you.</p>
              {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
              <div className="row">
                <button className="btn primary cta" disabled={busy} onClick={send}>{busy ? "Sending…" : "Email me a code"}</button>
                <button className="btn ghost" onClick={onClose}>Not now</button>
              </div>
            </>
          )}
          {step === "code" && (
            <>
              <Mail size={34} color="var(--orange)" aria-hidden="true" />
              <h2 id="tm-title">Enter your code</h2>
              <label className="field" htmlFor="tm-code">6-digit code
                <input id="tm-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
              </label>
              {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
              <div className="row">
                <button className="btn primary cta" disabled={busy || code.length !== 6} onClick={confirm}>{busy ? "Checking…" : mode === "away" ? "Turn on Travel mode" : "Set my home here"}</button>
                <button className="btn ghost" onClick={send} disabled={busy}>Resend</button>
              </div>
            </>
          )}
          {step === "done" && (
            <>
              <Plane size={34} color="var(--ok)" aria-hidden="true" />
              <h2 id="tm-title">{mode === "away" ? "Travel mode is on" : "Home updated"}</h2>
              <p style={{ margin: 0 }}>
                {mode === "away"
                  ? <>You can study in {place(s.location?.away_city, s.location?.away_region)} until {s.location?.away_until ? new Date(s.location.away_until).toLocaleDateString() : "your pass ends"}.</>
                  : <>Your home area is now {place(s.location?.home_city, s.location?.home_region)}.</>}
              </p>
              <button className="btn primary cta" onClick={onClose}>Keep studying</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
