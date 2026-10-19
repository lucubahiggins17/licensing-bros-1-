"use client";
// Devices & home: this device, home area, Travel mode, and why these rules exist (in plain words).
import { useCallback, useEffect, useState } from "react";
import { MonitorSmartphone, Home, Plane, RefreshCw, MapPin, ShieldCheck, Info } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { useSession, claimSession, refreshLocation, endAway, deviceLabel, type LocationInfo } from "@/lib/session";
import TravelModeFlow from "@/components/shell/TravelModeFlow";
import { timeAgo } from "@/components/notifications/timeAgo";
import s from "./Account.module.css";

type ActiveSessionRow = {
  user_id: string; session_id: string; device: string; city: string | null; region: string | null; country: string | null;
  location_ok: boolean; started_at: string; last_seen: string;
};
type AccountLocationRow = {
  user_id: string; home_city: string | null; home_region: string | null; home_country: string | null; home_set_at: string | null;
  away_city: string | null; away_region: string | null; away_until: string | null; away_history: string[] | null;
};

const place = (city?: string | null, region?: string | null) => [city, region].filter(Boolean).join(", ");
const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

function whereNow(loc: LocationInfo | null): { text: string; tone: "ok" | "warn" | "muted" } {
  if (!loc) return { text: "Checking where you are…", tone: "muted" };
  switch (loc.state) {
    case "home": return { text: "You're in your home area.", tone: "ok" };
    case "away": return { text: "Travel mode covers where you are now.", tone: "ok" };
    case "outside": return { text: "You're outside your home area. Paid lessons won't play here until you turn on Travel mode or move your home.", tone: "warn" };
    case "unset": return { text: "No home area yet. It's set the first time you open a paid lesson or class.", tone: "muted" };
    default: return { text: "We couldn't tell where you are right now.", tone: "muted" };
  }
}

export default function DevicesTab() {
  const { user, settings } = useAuth();
  const sess = useSession();
  const [row, setRow] = useState<ActiveSessionRow | null | undefined>(undefined);
  const [loc, setLoc] = useState<AccountLocationRow | null | undefined>(undefined);
  const [flow, setFlow] = useState<"away" | "home" | null>(null);
  const [busy, setBusy] = useState<"" | "refresh" | "end" | "claim">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [device, setDevice] = useState("This device");

  useEffect(() => { setDevice(deviceLabel()); }, []);

  const load = useCallback(async () => {
    if (!user) return;
    setLoadErr(false);
    try {
      const sb = supabase();
      const [a, b] = await Promise.all([
        sb.from("active_sessions").select("*").eq("user_id", user.id).maybeSingle(),
        sb.from("account_locations").select("*").eq("user_id", user.id).maybeSingle()
      ]);
      if (a.error || b.error) throw a.error || b.error;
      setRow((a.data as ActiveSessionRow) || null);
      setLoc((b.data as AccountLocationRow) || null);
    } catch {
      setLoadErr(true); setRow((x) => (x === undefined ? null : x)); setLoc((x) => (x === undefined ? null : x));
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  async function doRefresh() {
    setBusy("refresh"); setMsg(null);
    const r = await refreshLocation();
    await load();
    setMsg(r ? { ok: true, text: "Location updated." } : { ok: false, text: "Couldn't check your location. Check your connection and try again." });
    setBusy("");
  }

  async function doEndAway() {
    setBusy("end"); setMsg(null);
    try { await endAway(); await load(); setMsg({ ok: true, text: "Travel mode is off. Paid lessons play in your home area again." }); }
    catch (e: any) { setMsg({ ok: false, text: e?.message || "Couldn't end Travel mode. Try again." }); }
    setBusy("");
  }

  async function useHere() {
    setBusy("claim"); setMsg(null);
    await claimSession(true);
    await load();
    setBusy("");
  }

  const rules = settings.location_rules;
  const L = sess.location;
  const enforce = L ? L.enforce : rules?.enforce !== false;
  const radius = rules?.home_radius_miles ?? 100;
  const homeName = place(loc?.home_city ?? L?.home_city, loc?.home_region ?? L?.home_region);
  const awayUntil = loc?.away_until ?? L?.away_until ?? null;
  const awayOn = !!awayUntil && new Date(awayUntil).getTime() > Date.now();
  const awayName = place(loc?.away_city ?? L?.away_city, loc?.away_region ?? L?.away_region);
  const changeAfter = L?.can_change_home_after
    || (loc?.home_set_at && rules?.home_change_days ? new Date(new Date(loc.home_set_at).getTime() + rules.home_change_days * 864e5).toISOString() : null);
  const canChangeHome = !changeAfter || new Date(changeAfter).getTime() <= Date.now();
  const passesLeft = typeof L?.away_passes_left === "number" ? L.away_passes_left
    : rules ? Math.max(0, rules.away_passes_per_90_days - (loc?.away_history || []).filter((t) => new Date(t).getTime() > Date.now() - 90 * 864e5).length) : null;
  const now = whereNow(L);
  const thisIsActive = !!row && !!sess.sessionId && row.session_id === sess.sessionId;
  const otherActive = !!row && !thisIsActive && (sess.status === "in_use" || sess.status === "replaced");

  return (
    <div className={s.stack}>
      {flow && <TravelModeFlow intent={flow} reason="manage" onClose={() => { setFlow(null); load(); refreshLocation(); }} />}

      <div className={`card ${s.card} ${s.why}`}>
        <div className={s.cardHead}>
          <h2><ShieldCheck aria-hidden="true" /> Why we do this</h2>
        </div>
        <ul className={s.whyList}>
          <li><b>One device at a time.</b> Your account can be open on one phone or computer at a time. If you open it somewhere new, we ask first, and the other device pauses.</li>
          {enforce && <li><b>Home area.</b> Paid lessons and classes play within about {radius} miles of home. Traveling for work? Turn on Travel mode.</li>}
          <li>These rules keep accounts from being shared, so what you paid for stays yours.</li>
        </ul>
        {!enforce && <p className={s.muted}><Info aria-hidden="true" /> Home area rules are off right now, so paid lessons play anywhere.</p>}
      </div>

      {/* This device */}
      <div className={`card ${s.card}`}>
        <div className={s.cardHead}><h2><MonitorSmartphone aria-hidden="true" /> This device</h2></div>
        <div className={s.kv}>
          <div><span className="label">Device</span><b>{device}</b></div>
          <div>
            <span className="label">Status</span>
            {sess.status === "ok" ? <b className={s.okText}>Active here</b>
              : sess.status === "in_use" ? <b className={s.warnText}>Open on another device</b>
              : sess.status === "replaced" ? <b className={s.warnText}>Paused: opened on another device</b>
              : sess.status === "error" ? <b className={s.warnText}>Couldn&rsquo;t check</b>
              : <b>Checking…</b>}
          </div>
          <div><span className="label">Where you are</span><b>{place(L?.city, L?.region) || "Unknown"}</b></div>
          {row && (
            <div>
              <span className="label">{thisIsActive ? "Active since" : "Last active device"}</span>
              <b>{thisIsActive ? timeAgo(row.started_at) : `${row.device || "Another device"}${place(row.city, row.region) ? ` in ${place(row.city, row.region)}` : ""}, ${timeAgo(row.last_seen)}`}</b>
            </div>
          )}
        </div>
        {(otherActive || sess.status === "in_use" || sess.status === "replaced") && (
          <div className={s.actionsRow}>
            <button type="button" className="btn primary cta" onClick={useHere} disabled={busy === "claim"}>{busy === "claim" ? "Switching…" : "Use it here instead"}</button>
            <span className={s.muted}>If that wasn&rsquo;t you, change your password on the Profile tab.</span>
          </div>
        )}
        {sess.status === "error" && (
          <div className={s.actionsRow}>
            <span className="err">{sess.error}</span>
            <button type="button" className="btn sm" onClick={() => claimSession(false)}>Try again</button>
          </div>
        )}
      </div>

      {/* Home area */}
      <div className={`card ${s.card}`}>
        <div className={s.cardHead}><h2><Home aria-hidden="true" /> Home area</h2></div>
        {loc === undefined ? <span className={s.skel} /> : (
          <div className={s.kv}>
            <div><span className="label">Home</span><b>{homeName || "Not set yet"}</b></div>
            {loc?.home_set_at && <div><span className="label">Set on</span><b>{fmtDate(loc.home_set_at)}</b></div>}
            {changeAfter && !canChangeHome && <div><span className="label">Can move it after</span><b>{fmtDate(changeAfter)}</b></div>}
          </div>
        )}
        <p className={`${s.status} ${s[now.tone]}`}><MapPin aria-hidden="true" />{now.text}</p>
        <div className={s.actionsRow}>
          <button type="button" className="btn outline-navy" onClick={() => setFlow("home")} disabled={!!homeName && !canChangeHome}>
            <Home aria-hidden="true" /> Move my home here
          </button>
          {homeName && !canChangeHome && <span className={s.muted}>Home can be moved once every {rules?.home_change_days ?? 30} days.</span>}
        </div>
      </div>

      {/* Travel mode */}
      <div className={`card ${s.card}`}>
        <div className={s.cardHead}><h2><Plane aria-hidden="true" /> Travel mode</h2></div>
        {awayOn ? (
          <p className={`${s.status} ${s.ok}`}><Plane aria-hidden="true" />On{awayName ? ` in ${awayName}` : ""} until {fmtDate(awayUntil)}.</p>
        ) : (
          <p className={`${s.status} ${s.muted}`}><Plane aria-hidden="true" />Off. Turn it on when you&rsquo;re working away from home{rules?.away_max_days ? ` (up to ${rules.away_max_days} days at a time)` : ""}.</p>
        )}
        {passesLeft !== null && <p className={s.muted}>{passesLeft} travel pass{passesLeft === 1 ? "" : "es"} left in the next 90 days.</p>}
        <div className={s.actionsRow}>
          {awayOn
            ? <button type="button" className="btn outline-navy" onClick={doEndAway} disabled={busy === "end"}>{busy === "end" ? "Ending…" : "End travel mode"}</button>
            : <button type="button" className="btn primary cta" onClick={() => setFlow("away")} disabled={passesLeft === 0}><Plane aria-hidden="true" /> Turn on Travel mode</button>}
        </div>
      </div>

      <div className={s.refreshRow}>
        <button type="button" className="btn" onClick={doRefresh} disabled={busy === "refresh"}>
          <RefreshCw aria-hidden="true" className={busy === "refresh" ? s.spinning : undefined} />{busy === "refresh" ? "Checking…" : "Refresh location"}
        </button>
        <span className={s.muted}>Location comes from your internet connection, not GPS.</span>
        {msg && <span className={msg.ok ? s.ok : "err"} role={msg.ok ? "status" : "alert"}>{msg.text}</span>}
        {loadErr && <span className="err" role="alert">Couldn&rsquo;t load your device details. Check your connection.</span>}
      </div>
    </div>
  );
}
