"use client";
import { useAuth } from "@/lib/auth";
// Settings: homepage text and stats, plan limits, location rules, admin code and support contact.
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import type { Limits, SiteSettings } from "@/lib/types";
import { errMsg, q } from "./format";
import { useAdmin, useDirty, ErrorBox, FormPanel, Loading, SectionHead, Toggle } from "./ui";
import { MoveButtons } from "./fields";
import { AdminCodeCard } from "./AdminCode";
import s from "./admin.module.css";

const DEFAULTS: SiteSettings = {
  home_stats: [
    { value: "50", label: "States + DC covered" },
    { value: "4", label: "Trades: GC, electrical, plumbing, HVAC" }
  ],
  hero: { badge_top: "2026 Edition", badge_main: "Industry-leading contractor education", headline_1: "Master your", headline_2: "Contractor license", sub: "" },
  free_limits: { ai_daily: 5, exam_max_questions: 10, ai_exams: false, practice_sets: false },
  paid_limits: { ai_daily: 60, exam_max_questions: 50, ai_exams: true, practice_sets: true },
  location_rules: { enforce: true, home_radius_miles: 100, home_change_days: 30, away_max_days: 30, away_default_days: 14, away_passes_per_90_days: 3, session_timeout_seconds: 120 },
  support: { email: "", phone: "" }
};
type Key = keyof SiteSettings;

export default function SettingsSection() {
  const [data, setData] = useState<SiteSettings | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const rows = ((await q(supabase().from("site_settings").select("key,value"))) as { key: string; value: any }[]) || [];
      const got = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      const merged: any = {};
      (Object.keys(DEFAULTS) as Key[]).forEach((k) => {
        const d = DEFAULTS[k], v = got[k];
        merged[k] = Array.isArray(d) ? (Array.isArray(v) ? v : d) : { ...(d as object), ...(v && typeof v === "object" ? v : {}) };
      });
      setData(merged as SiteSettings);
    } catch (e) { setErr(errMsg(e, "Couldn't load settings.")); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <SectionHead eyebrow="Settings" title="Site" accent="settings"
        sub="Each box saves on its own. Changes show on the site right away (students may need to reload)." />
      {err ? <ErrorBox text={err} onRetry={load} /> : !data ? <Loading text="Loading settings…" /> : (
        <>
          <HeroCard initial={data.hero} />
          <StatsCard initial={data.home_stats} />
          <div className={s.limitsGrid}>
            <LimitsCard k="free_limits" title="Free account limits" code="Form ST-3 · Free plan" initial={data.free_limits}
              intro="What someone gets with a free account (no course bought)." />
            <LimitsCard k="paid_limits" title="Paid student limits" code="Form ST-4 · Paid plan" initial={data.paid_limits}
              intro="What students get once they've bought any course." />
          </div>
          <LocationCard initial={data.location_rules} />
          <AdminCodeCard />
          <SupportCard initial={data.support} />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
/** Keeps one site_settings row: value, saved copy, dirty flag and save(). */
function useSetting<T>(key: Key, initial: T, validate?: (v: T) => string) {
  const { toast } = useAdmin();
  const { refreshSettings } = useAuth();
  const [value, setValue] = useState<T>(initial);
  const [saved, setSaved] = useState<T>(initial);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  useDirty(`settings-${key}`, dirty);
  async function save(clean?: (v: T) => T) {
    const v = clean ? clean(value) : value;
    const p = validate?.(v) || "";
    setProblem(p);
    if (p) { toast(p, "bad"); return; }
    setSaving(true);
    try {
      await q(supabase().from("site_settings").upsert({ key, value: v, updated_at: new Date().toISOString() }, { onConflict: "key" }));
      setValue(v); setSaved(v);
      refreshSettings();
      toast("Saved.");
    } catch (e) { toast(errMsg(e), "bad"); }
    setSaving(false);
  }
  return { value, setValue, dirty, saving, save, problem, discard: () => { setValue(saved); setProblem(""); } };
}

function Actions({ dirty, saving, onSave, onDiscard, problem }: { dirty: boolean; saving: boolean; onSave: () => void; onDiscard: () => void; problem?: string }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {problem && <p className="err" role="alert" style={{ margin: 0 }}>{problem}</p>}
      <div className={s.cardActions}>
        {dirty && <button type="button" className="btn" onClick={onDiscard} disabled={saving}>Discard</button>}
        <button type="button" className="btn navy cta" onClick={onSave} disabled={!dirty || saving}>{saving ? "Saving…" : dirty ? "Save" : "Saved"}</button>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange, hint, suffix, min = 0, max = 100000 }: {
  label: string; value: number; onChange: (n: number) => void; hint?: React.ReactNode; suffix?: string; min?: number; max?: number;
}) {
  const [txt, setTxt] = useState(String(value ?? ""));
  useEffect(() => { setTxt((t) => (t !== "" && Number(t) === value ? t : String(value ?? ""))); }, [value]);
  const n = Number(txt);
  const bad = txt === "" || n < min || n > max;
  return (
    <label className="field">{label}
      <span className={s.numWrap}>
        <input inputMode="numeric" value={txt} aria-invalid={bad}
          onChange={(e) => { const t = e.target.value.replace(/[^0-9]/g, "").slice(0, 7); setTxt(t); if (t !== "") onChange(Number(t)); }}
          onBlur={() => { if (txt === "") setTxt(String(value)); }} />
        {suffix && <span>{suffix}</span>}
      </span>
      {hint && <span className="hint">{hint}</span>}
      {bad && txt !== "" && <span className={s.fieldErr}>Use a number from {min} to {max.toLocaleString()}.</span>}
    </label>
  );
}

// ------------------------------------------------------------------------------------------------
function HeroCard({ initial }: { initial: SiteSettings["hero"] }) {
  const st = useSetting("hero", initial, (v) => (!v.headline_1.trim() && !v.headline_2.trim() ? "The headline can't be empty." : ""));
  const v = st.value;
  const set = (k: keyof SiteSettings["hero"], x: string) => st.setValue({ ...v, [k]: x });
  return (
    <FormPanel code="Form ST-1 · Homepage" title="Homepage headline">
      <div className={s.settingsSplit}>
        <div className="stack" style={{ gap: 12 }}>
          <div className="grid2">
            <label className="field">Small badge
              <input value={v.badge_top} onChange={(e) => set("badge_top", e.target.value)} maxLength={40} placeholder="2026 Edition" />
            </label>
            <label className="field">Badge text
              <input value={v.badge_main} onChange={(e) => set("badge_main", e.target.value)} maxLength={80} placeholder="Industry-leading contractor education" />
            </label>
          </div>
          <div className="grid2">
            <label className="field">Headline, line 1 (navy)
              <input value={v.headline_1} onChange={(e) => set("headline_1", e.target.value)} maxLength={40} placeholder="Master your" />
            </label>
            <label className="field">Headline, line 2 (orange)
              <input value={v.headline_2} onChange={(e) => set("headline_2", e.target.value)} maxLength={40} placeholder="Contractor license" />
            </label>
          </div>
          <label className="field">Text under the headline
            <textarea rows={3} value={v.sub} onChange={(e) => set("sub", e.target.value)} maxLength={300} />
          </label>
        </div>
        <div className={`blueprint ${s.heroPreview}`} aria-label="Preview">
          <span className="label">Preview</span>
          <div className={s.heroBadge}>{v.badge_top && <small>{v.badge_top}</small>}<b>{v.badge_main || "Badge text"}</b></div>
          <div className={s.heroH}><span>{v.headline_1 || "Line one"}</span><span className={s.orange}>{v.headline_2 || "Line two"}</span></div>
          {v.sub && <p>{v.sub}</p>}
        </div>
      </div>
      <Actions dirty={st.dirty} saving={st.saving} onSave={() => st.save((x) => ({ badge_top: x.badge_top.trim(), badge_main: x.badge_main.trim(), headline_1: x.headline_1.trim(), headline_2: x.headline_2.trim(), sub: x.sub.trim() }))} onDiscard={st.discard} problem={st.problem} />
    </FormPanel>
  );
}

function StatsCard({ initial }: { initial: SiteSettings["home_stats"] }) {
  const st = useSetting("home_stats", initial, (v) => (v.some((r) => !r.value || !r.label) ? "Every stat needs a number and a label (or remove the empty row)." : ""));
  const rows = st.value;
  const upd = (i: number, p: Partial<{ value: string; label: string }>) => st.setValue(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= rows.length) return; const n = [...rows]; [n[i], n[j]] = [n[j], n[i]]; st.setValue(n); };
  return (
    <FormPanel code="Form ST-2 · Homepage" title="Homepage stats">
      <div className={s.warnBox} role="note">
        <TriangleAlert aria-hidden="true" />
        <p><b>Only show numbers that are true today.</b> Don&rsquo;t round up student counts or invent pass rates or reviews. Made-up claims break FTC advertising rules and cost you trust. &ldquo;50 states + DC covered&rdquo; is great; &ldquo;10,000 students passed&rdquo; is not, unless you can prove it.</p>
      </div>
      {!rows.length && <p className="note" style={{ margin: 0 }}>No stats. The homepage hides the stats row.</p>}
      {rows.map((r, i) => (
        <div key={i} className={s.statRow}>
          <span className={s.listNum} aria-hidden="true">{i + 1}</span>
          <input className={`input ${s.statValue}`} value={r.value} onChange={(e) => upd(i, { value: e.target.value })} maxLength={12} placeholder="50" aria-label={`Stat ${i + 1} number`} />
          <input className="input" value={r.label} onChange={(e) => upd(i, { label: e.target.value })} maxLength={60} placeholder="States + DC covered" aria-label={`Stat ${i + 1} label`} />
          <MoveButtons what="stat" onUp={() => move(i, -1)} onDown={() => move(i, 1)} upDisabled={i === 0} downDisabled={i === rows.length - 1} />
          <button type="button" className={s.iconBtn} onClick={() => st.setValue(rows.filter((_, k) => k !== i))} aria-label={`Remove stat ${i + 1}`} title="Remove"><Trash2 /></button>
        </div>
      ))}
      <div><button type="button" className="btn sm" disabled={rows.length >= 6} onClick={() => st.setValue([...rows, { value: "", label: "" }])}><Plus aria-hidden="true" />Add a stat</button></div>
      <Actions dirty={st.dirty} saving={st.saving} onSave={() => st.save((x) => x.map((r) => ({ value: r.value.trim(), label: r.label.trim() })).filter((r) => r.value || r.label))} onDiscard={st.discard} problem={st.problem} />
    </FormPanel>
  );
}

function LimitsCard({ k, title, code, initial, intro }: { k: "free_limits" | "paid_limits"; title: string; code: string; initial: Limits; intro: string }) {
  const st = useSetting<Limits>(k, initial, (v) =>
    v.ai_daily < 0 || v.ai_daily > 10000 ? "AI questions per day must be 0 to 10,000." :
    v.exam_max_questions < 5 || v.exam_max_questions > 200 ? "Longest practice exam must be 5 to 200 questions." : "");
  const v = st.value;
  return (
    <FormPanel code={code} title={title}>
      <p className="note" style={{ margin: 0 }}>{intro}</p>
      <NumField label="AI questions per day" value={v.ai_daily} min={0} max={10000} onChange={(n) => st.setValue({ ...v, ai_daily: n })}
        hint="Tutor chats, voice questions and AI-written exams all count. Resets every day." />
      <NumField label="Longest practice exam" suffix="questions" value={v.exam_max_questions} min={5} max={200} onChange={(n) => st.setValue({ ...v, exam_max_questions: n })} />
      <Toggle checked={v.ai_exams} onChange={(x) => st.setValue({ ...v, ai_exams: x })} label="AI-written mock exams" hint="Fresh exams the AI writes for their state and trade." />
      <Toggle checked={v.practice_sets} onChange={(x) => st.setValue({ ...v, practice_sets: x })} label="Practice tests from the AI test builder" hint="Tests you mark Free are open to everyone either way." />
      <Actions dirty={st.dirty} saving={st.saving} onSave={() => st.save()} onDiscard={st.discard} problem={st.problem} />
    </FormPanel>
  );
}

function LocationCard({ initial }: { initial: SiteSettings["location_rules"] }) {
  const st = useSetting("location_rules", initial, (v) => {
    if (v.home_radius_miles < 5 || v.home_radius_miles > 3000) return "Home area size must be 5 to 3,000 miles.";
    if (v.away_default_days > v.away_max_days) return "The default Travel mode length can't be longer than the longest Travel mode.";
    if (v.away_max_days < 1 || v.away_max_days > 365) return "Longest Travel mode must be 1 to 365 days.";
    if (v.away_passes_per_90_days < 0 || v.away_passes_per_90_days > 30) return "Travel passes must be 0 to 30.";
    if (v.home_change_days < 0 || v.home_change_days > 365) return "Days between home moves must be 0 to 365.";
    if (v.session_timeout_seconds < 60 || v.session_timeout_seconds > 3600) return "Device timeout must be 60 to 3,600 seconds.";
    return "";
  });
  const v = st.value;
  const set = (p: Partial<SiteSettings["location_rules"]>) => st.setValue({ ...v, ...p });
  return (
    <FormPanel code="Form ST-5 · Sharing protection" title="One device & home area rules">
      <p className="note" style={{ margin: 0 }}>
        These rules stop people from sharing one paid account. Free content never checks location, and admins are never blocked.
      </p>
      <Toggle checked={v.enforce} onChange={(x) => set({ enforce: x })} label="Lock paid content to each student's home area"
        hint="On: paid lessons and paid live classes only play near the student's home (set automatically the first time they watch). Off: they play anywhere." />
      <div className={`grid2 ${v.enforce ? "" : s.dim}`}>
        <NumField label="Home area size" suffix="miles" value={v.home_radius_miles} min={5} max={3000} onChange={(n) => set({ home_radius_miles: n })}
          hint="How far from home they can be and still watch. 100 miles covers a metro area and a normal work commute." />
        <NumField label="Days between home moves" suffix="days" value={v.home_change_days} min={0} max={365} onChange={(n) => set({ home_change_days: n })}
          hint="How often a student can move their home area on their own (they confirm with an email code)." />
        <NumField label="Travel passes every 90 days" suffix="passes" value={v.away_passes_per_90_days} min={0} max={30} onChange={(n) => set({ away_passes_per_90_days: n })}
          hint="How many times they can turn on Travel mode to study away from home." />
        <NumField label="Longest Travel mode" suffix="days" value={v.away_max_days} min={1} max={365} onChange={(n) => set({ away_max_days: n })}
          hint="The most days one Travel pass can last." />
        <NumField label="Default Travel mode length" suffix="days" value={v.away_default_days} min={1} max={365} onChange={(n) => set({ away_default_days: n })}
          hint="Pre-filled when they turn on Travel mode. They can pick less." />
        <NumField label="Device timeout" suffix="seconds" value={v.session_timeout_seconds} min={60} max={3600} onChange={(n) => set({ session_timeout_seconds: n })}
          hint="If a device goes quiet this long, another device can sign in without the “account in use” message. 120 is a good balance." />
      </div>
      <Actions dirty={st.dirty} saving={st.saving} onSave={() => st.save()} onDiscard={st.discard} problem={st.problem} />
    </FormPanel>
  );
}

function SupportCard({ initial }: { initial: SiteSettings["support"] }) {
  const st = useSetting("support", initial, (v) =>
    v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) ? "That email address doesn't look right." : "");
  const v = st.value;
  return (
    <FormPanel code="Form ST-6 · Contact" title="Support contact">
      <p className="note" style={{ margin: 0 }}>Shown to students who need help. Leave empty to hide.</p>
      <div className="grid2">
        <label className="field">Support email
          <input type="email" value={v.email} onChange={(e) => st.setValue({ ...v, email: e.target.value })} placeholder="help@yourdomain.com" autoComplete="off" />
        </label>
        <label className="field">Support phone
          <input type="tel" value={v.phone} onChange={(e) => st.setValue({ ...v, phone: e.target.value })} placeholder="(615) 555-0100" autoComplete="off" />
        </label>
      </div>
      <Actions dirty={st.dirty} saving={st.saving} onSave={() => st.save((x) => ({ email: x.email.trim(), phone: x.phone.trim() }))} onDiscard={st.discard} problem={st.problem} />
    </FormPanel>
  );
}
