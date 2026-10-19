"use client";
// Setup check: tests the live configuration from the browser and says exactly what to fix.
// Visitors get the public checks (keys, Supabase, sign-ups, database); signed-in admins also see the server keys.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CircleCheck, CircleAlert, CircleX, LoaderCircle, RefreshCw } from "lucide-react";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/lib/auth";
import { accessToken } from "@/lib/supabaseClient";
import { BASE_PATH, routes } from "@/lib/nav";
import { decodeJwtPayload } from "@/lib/jwt";
import { RAW_SUPABASE_KEY, RAW_SUPABASE_URL, SUPABASE_KEY, SUPABASE_URL } from "@/lib/env";
import s from "./StatusPage.module.css";

type Level = "pass" | "warn" | "fail" | "wait";
type Check = { id: string; title: string; level: Level; detail: string; fix?: string };

const URL_ = SUPABASE_URL;
const KEY = SUPABASE_KEY;
const URL_CLEANED = !!RAW_SUPABASE_URL && RAW_SUPABASE_URL.trim().replace(/\/+$/, "").toLowerCase() !== SUPABASE_URL;
const KEY_CLEANED = !!RAW_SUPABASE_KEY && RAW_SUPABASE_KEY !== SUPABASE_KEY;

function keyKind(k: string): "publishable" | "anon" | "secret" | "unknown" {
  if (k.startsWith("sb_publishable_")) return "publishable";
  if (k.startsWith("sb_secret_")) return "secret";
  const role = decodeJwtPayload(k)?.role;
  if (role === "anon") return "anon";
  if (role === "service_role") return "secret";
  return "unknown";
}

async function timed(url: string, init: RequestInit, ms = 12000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(t); }
}

export default function StatusPage() {
  const { user, account, ready } = useAuth();
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);
  const [ranAt, setRanAt] = useState<Date | null>(null);
  const here = typeof window !== "undefined" ? `${window.location.origin}${BASE_PATH}` : "";

  const run = useCallback(async () => {
    setRunning(true);
    const out: Check[] = [];
    const push = (c: Check) => { out.push(c); setChecks([...out]); };
    setChecks([]);

    // 1. Build settings
    if (!URL_ || !KEY) {
      push({ id: "config", title: "Website settings", level: "fail", detail: "This build of the site has no Supabase address or key.",
        fix: "Add the SUPABASE_URL and SUPABASE_ANON_KEY variables in GitHub (Settings → Secrets and variables → Actions → Variables), then rerun Publish website." });
      setRunning(false); setRanAt(new Date()); return;
    }
    const kind = keyKind(KEY);
    const host = URL_.replace(/^https?:\/\//, "");
    if (kind === "secret") {
      push({ id: "config", title: "Website settings", level: "fail", detail: `Connected to ${host}, but the key in SUPABASE_ANON_KEY is a SECRET key. Anyone visiting the site can read it.`,
        fix: "Right away: put the publishable key (sb_publishable_…) in SUPABASE_ANON_KEY, rerun Publish website, then create a new secret key in Supabase (Settings → API Keys) and delete the exposed one." });
    } else if (URL_CLEANED || KEY_CLEANED) {
      push({ id: "config", title: "Website settings", level: "warn",
        detail: `Connected to ${host}. ${URL_CLEANED ? `The SUPABASE_URL variable isn't in the expected form ("${RAW_SUPABASE_URL.trim().slice(0, 80)}"); the site fixed it automatically.` : ""}${KEY_CLEANED ? " The SUPABASE_ANON_KEY variable had extra spaces, line breaks or quotes; the site removed them." : ""}`,
        fix: `Tidy the GitHub variables so they're exact: SUPABASE_URL = ${SUPABASE_URL}${KEY_CLEANED ? ", and the key pasted on one line with nothing around it" : ""}.` });
    } else {
      push({ id: "config", title: "Website settings", level: kind === "unknown" ? "warn" : "pass",
        detail: `Connected to ${host} with ${kind === "publishable" ? "the publishable key" : kind === "anon" ? "the legacy anon key" : "a key that doesn't look like a Supabase key"}.`,
        fix: kind === "unknown" ? "Copy the publishable key (sb_publishable_…) from Supabase → Connect into SUPABASE_ANON_KEY, then rerun Publish website." : undefined });
    }
    const headers = { apikey: KEY, "content-type": "application/json" };

    // 2. Supabase reachable + key accepted, and the sign-up settings
    let settings: any = null;
    try {
      const r = await timed(`${URL_}/auth/v1/settings`, { headers });
      if (r.ok) {
        settings = await r.json();
        push({ id: "reach", title: "Supabase project", level: "pass", detail: "The project answers and accepts the site's key." });
      } else if (r.status === 401 || r.status === 403) {
        push({ id: "reach", title: "Supabase project", level: "fail", detail: "The project answered but rejected the site's key.",
          fix: "Copy the publishable key again from Supabase → Connect into the SUPABASE_ANON_KEY variable, then rerun Publish website." });
      } else {
        push({ id: "reach", title: "Supabase project", level: "fail", detail: `The project answered with an error (${r.status}).`, fix: "Open your Supabase dashboard and check the project isn't paused." });
      }
    } catch {
      push({ id: "reach", title: "Supabase project", level: "fail", detail: "Couldn't reach the Supabase project.",
        fix: "Check your internet, that SUPABASE_URL is exactly the Project URL (https://xxxx.supabase.co), and that the project isn't paused (free projects pause after a week without use)." });
    }

    if (settings) {
      const emailOn = settings?.external?.email !== false;
      if (settings.disable_signup || !emailOn) {
        push({ id: "signup", title: "Sign-ups", level: "fail", detail: settings.disable_signup ? "New sign-ups are turned off." : "Email sign-in is turned off.",
          fix: "In Supabase, open Authentication → Sign In / Providers, turn on Email and \"Allow new users to sign up\"." });
      } else {
        push({ id: "signup", title: "Sign-ups", level: "pass", detail: "New students can create accounts with email and password." });
      }
      if (settings.mailer_autoconfirm) {
        push({ id: "email", title: "Confirmation emails", level: "warn", detail: "\"Confirm email\" is off, so accounts work right away without an email. Fine for testing.",
          fix: "Before launch, connect an email sender (Authentication → Email → SMTP Settings) and turn \"Confirm email\" back on. Security codes for Travel mode and password resets still need email." });
      } else {
        push({ id: "email", title: "Confirmation emails", level: "warn", detail: "New accounts must confirm by email. The website can't see which email sender Supabase uses.",
          fix: "Make sure custom SMTP is connected (Authentication → Email → SMTP Settings). Supabase's built-in sender only emails people on your Supabase team, about 2 an hour, which is the usual reason sign-ups fail. To test before that, turn off \"Confirm email\" under Authentication → Sign In / Providers → Email." });
      }
    }

    // 3. Database script
    let hasAdmin: boolean | null = null;
    try {
      const r = await timed(`${URL_}/rest/v1/rpc/admin_setup_status`, { method: "POST", headers, body: "{}" });
      if (r.ok) {
        const j = await r.json();
        hasAdmin = !!j?.has_admin;
        push({ id: "db", title: "Database", level: "pass", detail: "schema.sql has been run: tables, security rules and admin tools are in place." });
      } else if (r.status === 404) {
        push({ id: "db", title: "Database", level: "fail", detail: "The database tables aren't there yet.",
          fix: "In Supabase, open SQL Editor → New query, paste all of supabase/schema.sql and click Run. It also shows your admin code." });
      } else if (r.status === 401) {
        push({ id: "db", title: "Database", level: "fail", detail: "The database rejected the site's key.", fix: "Fix the key first (see above)." });
      } else {
        push({ id: "db", title: "Database", level: "warn", detail: `The database answered with an error (${r.status}).`, fix: "Run supabase/schema.sql again in the SQL Editor; it's safe to rerun." });
      }
    } catch {
      push({ id: "db", title: "Database", level: "fail", detail: "Couldn't reach the database.", fix: "Fix the Supabase connection first (see above)." });
    }
    if (hasAdmin !== null) {
      push({ id: "admin", title: "Admin account", level: hasAdmin ? "pass" : "warn",
        detail: hasAdmin ? "The site has an admin." : "No one has claimed admin yet.",
        fix: hasAdmin ? undefined : "Create your account, open /admin and enter the admin code shown when you ran schema.sql." });
    }

    // 4. Backend functions (and, for admins, which server keys are set)
    const token = user ? await accessToken() : null;
    try {
      const r = await timed(`${URL_}/functions/v1/generate`, {
        method: "POST",
        headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ kind: "health" })
      });
      if (r.status === 404) {
        push({ id: "fn", title: "Backend functions", level: "fail", detail: "The backend functions aren't deployed.",
          fix: "Add the SUPABASE_ACCESS_TOKEN secret and SUPABASE_PROJECT_REF variable in GitHub, then run the Build Android app workflow; it deploys them." });
      } else if (r.ok) {
        const h = await r.json();
        push({ id: "fn", title: "Backend functions", level: "pass", detail: "Deployed and answering." });
        push({ id: "ai", title: "AI tutor key", level: h.ai ? "pass" : "fail", detail: h.ai ? `Set (model ${h.model}${h.fast_model ? `; quick answers and voice use ${h.fast_model}` : ""}).` : "ANTHROPIC_API_KEY isn't set, so the tutor and AI builders won't work.",
          fix: h.ai ? undefined : "Add the ANTHROPIC_API_KEY secret in GitHub and rerun Build Android app." });
        push({ id: "stripe", title: "Payments", level: h.stripe && h.stripe_webhook ? "pass" : "fail",
          detail: h.stripe && h.stripe_webhook ? `Stripe is connected in ${h.stripe_live ? "live mode: real payments" : "test mode: practice payments only"}.` : `Missing ${[!h.stripe && "STRIPE_SECRET_KEY", !h.stripe_webhook && "STRIPE_WEBHOOK_SECRET"].filter(Boolean).join(" and ")}.`,
          fix: h.stripe && h.stripe_webhook ? undefined : "Add the Stripe secrets in GitHub and rerun Build Android app (guide Step 5)." });
        push({ id: "live", title: "Live classes", level: h.livekit ? "pass" : "warn", detail: h.livekit ? "LiveKit is connected for going live from the browser." : "LiveKit keys aren't set. Classes can still use a YouTube or StreamYard stream link.",
          fix: h.livekit ? undefined : "Add LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in GitHub and rerun Build Android app." });
        push({ id: "mail", title: "Email from the server", level: h.email ? "pass" : "warn", detail: h.email ? "Set up. The command center and automations can send email." : "RESEND_API_KEY and EMAIL_FROM aren't set, so the command center and automations can't send email. In-app announcements still work.",
          fix: h.email ? undefined : "Create a Resend account (resend.com), verify your domain, then add the RESEND_API_KEY secret and EMAIL_FROM (for example Licensing Bro's <team@yourdomain.com>) in GitHub and rerun Build Android app." });
        const siteOk = !!h.site_url && h.site_url.replace(/\/+$/, "") === here.replace(/\/+$/, "");
        push({ id: "site", title: "Website address on the server", level: siteOk ? "pass" : "warn",
          detail: siteOk ? `SITE_URL matches this site (${here}).` : `SITE_URL is ${h.site_url ? `"${h.site_url}"` : "not set"}, but this site is ${here}. Payment and email links use SITE_URL.`,
          fix: siteOk ? undefined : `Set the SITE_URL variable in GitHub to ${here} and rerun Build Android app.` });
      } else if (r.status === 401 || r.status === 403) {
        push({ id: "fn", title: "Backend functions", level: "pass", detail: user ? "Deployed. Server keys are only shown to admins." : "Deployed. Sign in as the admin to check the AI, payment and live-class keys." });
      } else {
        push({ id: "fn", title: "Backend functions", level: "warn", detail: `They answered with an error (${r.status}).`, fix: "Rerun the Build Android app workflow and check its Deploy functions step." });
      }
    } catch {
      // Browsers can't read Supabase's "function not found" answer (it has no CORS headers), so it shows up as a network
      // failure. If the project itself answered above, a missing deploy is the explanation.
      if (settings) {
        push({ id: "fn", title: "Backend functions", level: "fail", detail: "The backend functions aren't deployed, so the AI tutor, AI builders, lessons, checkout and live classes can't work yet.",
          fix: "In GitHub, add the SUPABASE_ACCESS_TOKEN secret (from supabase.com/dashboard/account/tokens) and the SUPABASE_PROJECT_REF variable, plus the ANTHROPIC_API_KEY secret, then run the Build Android app workflow; it deploys them." });
      } else {
        push({ id: "fn", title: "Backend functions", level: "warn", detail: "Couldn't reach them.",
          fix: "Fix the Supabase connection first (see above). If they're missing, add SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF in GitHub and run the Build Android app workflow." });
      }
    }

    push({ id: "urls", title: "Email links", level: "warn", detail: `Confirmation links bring students back to ${here}. The website can't read Supabase's allowed addresses.`,
      fix: `In Supabase → Authentication → URL Configuration, set Site URL to ${here} and add ${here}/** under Redirect URLs.` });
    setRunning(false);
    setRanAt(new Date());
  }, [user, here]);

  useEffect(() => { if (ready) run(); }, [ready, account?.is_admin]); // eslint-disable-line react-hooks/exhaustive-deps

  const fails = checks.filter((c) => c.level === "fail").length;
  const warns = checks.filter((c) => c.level === "warn").length;

  return (
    <AppShell active="none" blueprint>
      <main className={`wrap ${s.wrap}`}>
        <div className="eyebrow orange">Site owner</div>
        <h1 className={s.h1}>Setup <span>check</span></h1>
        <p className={s.lede}>
          Tests this site's connection to Supabase and the server from your browser. {account?.is_admin ? "You're signed in as an admin, so the server keys are checked too." : "Sign in as the admin to also check the AI, payment and live-class keys."}
        </p>
        <div className={s.summary} role="status" aria-live="polite">
          {running ? <span><LoaderCircle className={s.spin} aria-hidden="true" />Checking…</span>
            : fails ? <span className={s.bad}><CircleX aria-hidden="true" />{fails} thing{fails === 1 ? "" : "s"} to fix</span>
            : <span className={s.good}><CircleCheck aria-hidden="true" />Nothing broken{warns ? `, ${warns} to double-check` : ""}</span>}
          <button type="button" className="btn sm" onClick={run} disabled={running}><RefreshCw aria-hidden="true" />Check again</button>
        </div>
        <ul className={s.list}>
          {checks.map((c) => (
            <li key={c.id} className={`card ${s.row} ${s[c.level]}`}>
              <span className={s.ico} aria-hidden="true">
                {c.level === "pass" ? <CircleCheck /> : c.level === "warn" ? <CircleAlert /> : c.level === "fail" ? <CircleX /> : <LoaderCircle className={s.spin} />}
              </span>
              <div>
                <b>{c.title}</b>
                <p>{c.detail}</p>
                {c.fix && <p className={s.fix}><b>{c.level === "fail" ? "Fix:" : "Check:"}</b> {c.fix}</p>}
              </div>
            </li>
          ))}
        </ul>
        {ranAt && <p className="note">Last checked {ranAt.toLocaleTimeString()}. <Link href={routes.admin()}>Admin control center</Link></p>}
      </main>
    </AppShell>
  );
}
