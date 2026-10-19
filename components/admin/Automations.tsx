"use client";
// Automations: jobs that run on their own. Admins switch them on, pick when they run and who hears about it,
// and can run one now to see what it does.
import { useCallback, useEffect, useState } from "react";
import { BellRing, CalendarClock, Clock, Play, Sparkles, UserPlus, Users } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { callFn } from "@/lib/api";
import { errMsg, fmtDateTime, q } from "./format";
import { useAdmin, useMounted, ErrorBox, FormPanel, Loading, SectionHead, Toggle } from "./ui";
import s from "./admin.module.css";

type Kind = "weekly_digest" | "at_risk_alert" | "inactive_nudge" | "exam_countdown" | "new_signup_alert";
type Row = { kind: Kind; enabled: boolean; config: Record<string, any>; last_run_at: string | null; last_result: string | null };

const META: Record<Kind, { title: string; what: string; Icon: any; who?: boolean; weekly?: boolean; days?: boolean; hourly?: boolean; studentEmail?: boolean }> = {
  weekly_digest: { title: "Weekly team digest", what: "Every week: new signups, who's studying, who's at risk and why, the toughest topics across students, and next week's live classes.", Icon: Sparkles, who: true, weekly: true },
  at_risk_alert: { title: "At-risk alerts", what: "Each morning, tells your team about students who newly look likely to fail (exam soon with low scores, few practice questions, or gone quiet). Each student once a week at most.", Icon: BellRing, who: true },
  inactive_nudge: { title: "Study nudges", what: "A friendly in-app nudge to students who stopped studying, pointing them at their weakest topic. Each student once a week at most.", Icon: Users, days: true, studentEmail: true },
  exam_countdown: { title: "Exam countdown", what: "Tips for each student 14, 7, 3 and 1 day(s) before the exam date they set.", Icon: CalendarClock, studentEmail: false },
  new_signup_alert: { title: "New signup alerts", what: "Every hour, tells admins who just created an account.", Icon: UserPlus, who: true, hourly: true }
};
const ORDER: Kind[] = ["weekly_digest", "at_risk_alert", "inactive_nudge", "exam_countdown", "new_signup_alert"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];
const hourLabel = (h: number) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? "AM" : "PM"}`;

export default function Automations() {
  const { toast } = useAdmin();
  const mounted = useMounted();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr("");
    try {
      const data = (await q(supabase().from("automations").select("kind,enabled,config,last_run_at,last_result"))) as Row[];
      if (mounted.current) setRows(ORDER.map((k) => data.find((r) => r.kind === k)).filter(Boolean) as Row[]);
    } catch (e: any) {
      if (mounted.current) setErr(/automations|does not exist|schema cache/i.test(String(e?.message)) ? "Automations aren't set up in your database yet. In Supabase, open SQL Editor, paste all of supabase/schema.sql and click Run (safe to rerun), then reload." : errMsg(e));
    }
  }, [mounted]);
  useEffect(() => { load(); }, [load]);

  async function save(r: Row, patch: Partial<Pick<Row, "enabled" | "config">>, msg: string) {
    const next = { ...r, ...patch, config: { ...r.config, ...(patch.config || {}) } };
    setRows((x) => x?.map((y) => (y.kind === r.kind ? next : y)) ?? x);
    try {
      await q(supabase().from("automations").update({ enabled: next.enabled, config: next.config, updated_at: new Date().toISOString() }).eq("kind", r.kind));
      toast(msg);
    } catch (e) {
      setRows((x) => x?.map((y) => (y.kind === r.kind ? r : y)) ?? x);
      toast(errMsg(e), "bad");
    }
  }

  async function runNow(r: Row) {
    setBusy(r.kind);
    try {
      const res = await callFn<{ ran: string[] }>("automations", { action: "run_now", kind: r.kind });
      toast(res.ran?.[0] || "Done.");
      await load();
    } catch (e) { toast(errMsg(e, "Couldn't run it. Check that Build Android app has deployed the functions."), "bad"); }
    if (mounted.current) setBusy(null);
  }

  const browserTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "America/Chicago"; } })();
  const zones = ZONES.includes(browserTz) ? ZONES : [browserTz, ...ZONES];

  return (
    <div className="stack" style={{ gap: 18 }}>
      <SectionHead eyebrow="Runs on its own" title="Automations" accent="autopilot"
        sub="Jobs that keep students on track and your team in the loop without anyone remembering to do it. Ask Bro Command to change any of these too." />
      <div className={s.warnBox}><Clock aria-hidden="true" />
        <p>These run every hour from GitHub. One-time setup: add an <b>AUTOMATION_SECRET</b> secret in GitHub (any long random text), then run <b>Build Android app</b>. Team emails need <b>RESEND_API_KEY</b> and <b>EMAIL_FROM</b>; without them, messages arrive as in-app notifications. They also run whenever someone on your team opens this area.</p>
      </div>
      {err ? <ErrorBox text={err} onRetry={load} /> : !rows ? <Loading text="Loading automations…" /> : rows.map((r) => {
        const m = META[r.kind];
        const c = r.config || {};
        return (
          <FormPanel key={r.kind} code={r.enabled ? "On" : "Off"} title={m.title}>
            <div className={s.actionRow}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <m.Icon aria-hidden="true" style={{ width: 22, height: 22, color: "var(--orange)", flex: "none", marginTop: 2 }} />
                <p className="note" style={{ margin: 0 }}>{m.what}</p>
              </div>
              <Toggle checked={r.enabled} label={r.enabled ? "On" : "Off"} onChange={(v) => save(r, { enabled: v }, `${m.title} ${v ? "on" : "off"}.`)} />
            </div>
            <div className="grid2">
              {m.weekly && (
                <label className="field">Day
                  <select value={c.weekday ?? 1} onChange={(e) => save(r, { config: { weekday: Number(e.target.value) } }, "Saved.")}>
                    {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                </label>
              )}
              {!m.hourly && (
                <label className="field">Time
                  <select value={c.hour ?? 8} onChange={(e) => save(r, { config: { hour: Number(e.target.value) } }, "Saved.")}>
                    {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                  </select>
                </label>
              )}
              {!m.hourly && (
                <label className="field">Time zone
                  <select value={c.tz || "America/Chicago"} onChange={(e) => save(r, { config: { tz: e.target.value } }, "Saved.")}>
                    {zones.map((z) => <option key={z} value={z}>{z.replace("America/", "").replace("Pacific/", "").replace(/_/g, " ")}</option>)}
                  </select>
                </label>
              )}
              {m.who && (
                <label className="field">Who hears about it
                  <select value={c.audience || (r.kind === "new_signup_alert" ? "admins" : r.kind === "at_risk_alert" ? "instructors" : "staff")} onChange={(e) => save(r, { config: { audience: e.target.value } }, "Saved.")}>
                    <option value="staff">Admins and instructors</option>
                    <option value="instructors">Instructors (and admins)</option>
                    <option value="admins">Admins only</option>
                  </select>
                </label>
              )}
              {m.days && (
                <label className="field">Nudge after
                  <select value={c.days ?? 5} onChange={(e) => save(r, { config: { days: Number(e.target.value) } }, "Saved.")}>
                    {[3, 5, 7, 10, 14].map((d) => <option key={d} value={d}>{d} days without studying</option>)}
                  </select>
                </label>
              )}
            </div>
            {(m.who || m.studentEmail) && (
              <Toggle small checked={m.who ? c.email !== false : c.email === true} label={m.who ? "Send by email (otherwise in-app)" : "Also email students"}
                hint={m.who ? undefined : "In-app nudges always go out. Email only if students expect it."}
                onChange={(v) => save(r, { config: { email: v } }, "Saved.")} />
            )}
            <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
              <span className="note">{r.last_run_at ? <>Last run {fmtDateTime(r.last_run_at)}{r.last_result ? ` · ${r.last_result}` : ""}</> : "Hasn't run yet."}</span>
              <button type="button" className="btn sm" onClick={() => runNow(r)} disabled={busy === r.kind}><Play aria-hidden="true" />{busy === r.kind ? "Running…" : "Run now"}</button>
            </div>
          </FormPanel>
        );
      })}
    </div>
  );
}
