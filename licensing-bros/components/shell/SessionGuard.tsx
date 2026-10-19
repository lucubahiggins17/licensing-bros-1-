"use client";
// Dialogs for "one device at a time" and the home-location rule. Shown over any page.
import { useEffect, useState } from "react";
import Link from "next/link";
import { MonitorSmartphone, MapPin, Plane, Home } from "lucide-react";
import { useSession, claimSession, updateLocation, refreshLocation, type LocationInfo } from "@/lib/session";
import { useAuth } from "@/lib/auth";
import { routes } from "@/lib/nav";
import TravelModeFlow from "@/components/shell/TravelModeFlow";

const place = (city?: string | null, region?: string | null) => [city, region].filter(Boolean).join(", ") || "an unknown location";

export default function SessionGuard() {
  const s = useSession();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [dismissHome, setDismissHome] = useState(false);
  const [travel, setTravel] = useState(false);

  // Listen for paid content asking to explain a blocked location
  useEffect(() => {
    const open = (e: Event) => {
      const loc = (e as CustomEvent<LocationInfo | undefined>).detail;
      if (loc) updateLocation(loc); else refreshLocation();
      setTravel(true);
    };
    window.addEventListener("lb:outside-home", open);
    return () => window.removeEventListener("lb:outside-home", open);
  }, []);

  if (!user) return null;

  if (s.status === "in_use" || s.status === "replaced") {
    const c = s.conflict;
    return (
      <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="sg-title">
        <div className="dialog">
          <div className="hazard thin" />
          <div className="dbody">
            <MonitorSmartphone size={34} color="var(--orange)" aria-hidden="true" />
            <h2 id="sg-title">{s.status === "in_use" ? "Your account is in use" : "Opened on another device"}</h2>
            <p style={{ margin: 0 }}>
              {s.status === "in_use"
                ? <>Licensing Bro&rsquo;s is open on <b>{c?.device || "another device"}</b> in {place(c?.city, c?.region)}. One device can use an account at a time.</>
                : <>Your account was just opened on <b>{c?.device || "another device"}</b> in {place(c?.city, c?.region)}, so it paused here.</>}
            </p>
            <p className="note" style={{ margin: 0 }}>If that wasn&rsquo;t you, change your password in Account settings.</p>
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn primary cta" disabled={busy} onClick={async () => { setBusy(true); await claimSession(true); setBusy(false); }}>
                {busy ? "Switching…" : "Use it here instead"}
              </button>
              <Link className="btn" href={routes.account("devices")}>Manage devices</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (travel) return <TravelModeFlow onClose={() => setTravel(false)} />;

  // First time a home location gets set: tell the student, once
  if (s.status === "ok" && s.location?.home_set_now && !dismissHome) {
    return (
      <div className="toast" role="status">
        <Home size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} aria-hidden="true" />
        Home location set to {place(s.location.home_city, s.location.home_region)}. Change it anytime in <Link href={routes.account("devices")} style={{ color: "var(--hazard)" }} onClick={() => setDismissHome(true)}>Account</Link>.
        <button className="btn sm" style={{ marginLeft: 10 }} onClick={() => setDismissHome(true)}>OK</button>
      </div>
    );
  }
  return null;
}

/** Call from paid content when the server says the student is outside their home area. Pass the error's `location` if you have it. */
export function askForTravelMode(location?: LocationInfo) {
  window.dispatchEvent(new CustomEvent("lb:outside-home", { detail: location }));
}

export const LocationIcons = { MapPin, Plane };
