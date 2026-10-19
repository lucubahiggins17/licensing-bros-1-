"use client";
// Live classes: schedule, edit stream settings, open the studio.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarPlus, Clapperboard, Eye, ImageOff, MonitorPlay, Pencil, Radio, Link2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { routes } from "@/lib/nav";
import { TRADE_LABELS, type Live, type LivePrivate, type TradeOrAll } from "@/lib/types";
import { errMsg, fmtDateTime, fromLocalInput, q, relTime, timeZoneName, toLocalInput } from "./format";
import { useAdmin, useDirty, ConfirmButton, Empty, ErrorBox, FormPanel, Intent, Loading, SaveBar, SectionHead, StatusBadge, Step, Toggle } from "./ui";
import { CoverUpload } from "./fields";
import s from "./admin.module.css";

type CourseOpt = { id: string; title: string; published: boolean };

export default function Lives({ intent }: { intent: Intent }) {
  const { guardLeave } = useAdmin();
  const [editing, setEditing] = useState<string | null | undefined>(
    intent?.action === "new" ? null : intent?.action === "edit" ? intent.id : undefined
  );
  const [rows, setRows] = useState<Live[] | null>(null);
  const [err, setErr] = useState("");
  const [view, setView] = useState<"upcoming" | "past">("upcoming");

  const load = useCallback(async () => {
    setErr("");
    try { setRows(((await q(supabase().from("lives").select("*").order("starts_at", { ascending: false }).limit(300))) as Live[]) || []); }
    catch (e) { setErr(errMsg(e, "Couldn't load live classes.")); }
  }, []);
  useEffect(() => { if (editing === undefined) load(); }, [editing, load]);

  const shown = useMemo(() => {
    const r = rows || [];
    return view === "upcoming"
      ? r.filter((l) => l.status !== "ended").sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      : r.filter((l) => l.status === "ended");
  }, [rows, view]);

  if (editing !== undefined) {
    return <LiveEditor id={editing} onClose={() => guardLeave(() => setEditing(undefined))} onDeleted={() => setEditing(undefined)} />;
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <SectionHead eyebrow="Live classes" title="Live" accent="classes"
        sub="Schedule a class, then open the studio at class time to go live from your browser or show your stream."
        actions={<button type="button" className="btn primary" onClick={() => setEditing(null)}><CalendarPlus aria-hidden="true" />Schedule live</button>} />

      <div className="seg" role="group" aria-label="Show">
        <button type="button" aria-pressed={view === "upcoming"} onClick={() => setView("upcoming")}>Upcoming &amp; live</button>
        <button type="button" aria-pressed={view === "past"} onClick={() => setView("past")}>Past</button>
      </div>

      {err ? <ErrorBox text={err} onRetry={load} /> : !rows ? <Loading text="Loading classes…" /> : !shown.length ? (
        <div className="card">
          <Empty icon={Radio} title={view === "upcoming" ? "No classes scheduled. Schedule your first live class." : "No past classes yet."}
            action={view === "upcoming" ? <button type="button" className="btn primary cta" onClick={() => setEditing(null)}><CalendarPlus aria-hidden="true" />Schedule a class</button> : undefined}>
            {view === "upcoming" ? "Students see upcoming classes on the Live page and can join when you go live." : "Classes show here after they end."}
          </Empty>
        </div>
      ) : (
        <ul className={s.cardList}>
          {shown.map((l) => (
            <li key={l.id} className={`card ${s.liveRow}`}>
              <span className={s.thumbWide}>{l.cover_url ? <img src={l.cover_url} alt="" /> : <ImageOff aria-hidden="true" />}</span>
              <div className={s.liveInfo}>
                <div className="row" style={{ gap: 6 }}>
                  <StatusBadge status={l.status} />
                  {l.is_free ? <span className="badge free">Free</span> : <span className="badge paid">Students</span>}
                  <span className="badge">{l.provider === "embed" ? "Stream link" : "Browser"}</span>
                </div>
                <b className={s.liveTitle}>{l.title}</b>
                <span className="note">{fmtDateTime(l.starts_at)} · {relTime(l.starts_at)} · {TRADE_LABELS[l.trade] || l.trade}</span>
              </div>
              <div className={s.liveActions}>
                <button type="button" className="btn sm" onClick={() => setEditing(l.id)}><Pencil aria-hidden="true" />Edit</button>
                <Link className="btn sm navy" href={routes.studio(l.id)}><Clapperboard aria-hidden="true" />Open studio</Link>
                <Link className="btn sm ghost" href={routes.watch(l.id)}><Eye aria-hidden="true" />View as student</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
type Form = {
  title: string; description: string; trade: TradeOrAll; is_free: boolean; course_id: string; starts_local: string;
  provider: Live["provider"]; embed_url: string; replay_url: string; cover_url: string | null; status: Live["status"];
};
const defaultStart = () => {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  d.setHours(19, 0, 0, 0);
  return toLocalInput(d.toISOString());
};
const blank = (): Form => ({ title: "", description: "", trade: "all", is_free: false, course_id: "", starts_local: defaultStart(), provider: "livekit", embed_url: "", replay_url: "", cover_url: null, status: "scheduled" });

function LiveEditor({ id: initialId, onClose, onDeleted }: { id: string | null; onClose: () => void; onDeleted: () => void }) {
  const { toast, userId } = useAdmin();
  const [id, setId] = useState<string | null>(initialId);
  const [form, setForm] = useState<Form>(blank);
  const [saved, setSaved] = useState<Form>(form);
  const [courses, setCourses] = useState<CourseOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  useDirty("live", dirty);

  const load = useCallback(async () => {
    setLoading(true); setLoadErr("");
    try {
      const sb = supabase();
      const cs = (await q(sb.from("courses").select("id,title,published").order("title", { ascending: true }))) as CourseOpt[];
      setCourses(cs || []);
      if (initialId) {
        const [l, p] = await Promise.all([
          q(sb.from("lives").select("*").eq("id", initialId).single()),
          q(sb.from("live_private").select("*").eq("live_id", initialId).maybeSingle())
        ]);
        const live = l as Live, priv = (p as LivePrivate | null) || null;
        const f: Form = {
          title: live.title || "", description: live.description || "", trade: live.trade || "all", is_free: !!live.is_free,
          course_id: live.course_id || "", starts_local: toLocalInput(live.starts_at), provider: live.provider || "livekit",
          embed_url: priv?.embed_url || "", replay_url: priv?.replay_url || "", cover_url: live.cover_url || null, status: live.status || "scheduled"
        };
        setForm(f); setSaved(f);
      } else {
        const f = blank();
        setForm(f); setSaved(f);
      }
    } catch (e) { setLoadErr(errMsg(e, "Couldn't load this class.")); }
    setLoading(false);
  }, [initialId]);
  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k as string]) setErrors((e) => { const n = { ...e }; delete n[k as string]; return n; });
  };

  async function save() {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = "Give the class a title.";
    const iso = fromLocalInput(form.starts_local);
    if (!iso) e.starts_local = "Pick the date and start time.";
    for (const k of ["embed_url", "replay_url"] as const) {
      const v = form[k].trim();
      if (v && !/^https?:\/\//i.test(v)) e[k] = "Links start with https://";
    }
    setErrors(e);
    if (Object.keys(e).length) { toast(Object.values(e)[0], "bad"); return; }
    setSaving(true);
    try {
      const sb = supabase();
      const row: Record<string, any> = {
        title: form.title.trim(), description: form.description.trim(), trade: form.trade, is_free: form.is_free,
        course_id: form.course_id || null, starts_at: iso, provider: form.provider, cover_url: form.cover_url, status: form.status
      };
      let liveId = id;
      if (id) await q(sb.from("lives").update(row).eq("id", id));
      else {
        const created = (await q(sb.from("lives").insert({ ...row, host_id: userId }).select().single())) as Live;
        liveId = created.id;
      }
      await q(sb.from("live_private").upsert({ live_id: liveId, embed_url: form.embed_url.trim() || null, replay_url: form.replay_url.trim() || null }, { onConflict: "live_id" }));
      const f = { ...form, title: row.title, description: row.description, embed_url: form.embed_url.trim(), replay_url: form.replay_url.trim() };
      setForm(f); setSaved(f);
      if (!id) { setId(liveId); toast("Class scheduled. Open the studio at class time to go live."); }
      else toast("Class saved.");
    } catch (err) { toast(errMsg(err), "bad"); }
    setSaving(false);
  }

  async function remove() {
    try {
      await q(supabase().from("lives").delete().eq("id", id));
      setSaved(form);
      toast("Class deleted.");
      onDeleted();
    } catch (e) { toast(errMsg(e), "bad"); }
  }

  if (loading) return <Loading text="Loading class…" />;
  if (loadErr) return <div className="stack"><BackBtn onClick={onClose} /><ErrorBox text={loadErr} onRetry={load} /></div>;

  const course = courses.find((c) => c.id === form.course_id);
  const access = form.is_free
    ? "Anyone with a free account can watch."
    : course ? `Students who own “${course.title}” can watch.` : "Any student who has bought at least one course can watch.";
  const fieldErr = (k: string) => errors[k] ? <span className={s.fieldErr} role="alert">{errors[k]}</span> : null;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className={s.editorTop}>
        <BackBtn onClick={onClose} />
        <div className={s.editorTitle}>
          <div className="eyebrow orange">{id ? "Edit live class" : "Schedule a live class"}</div>
          <h2 className={s.h2}>{saved.title || form.title || "New"} <span>{saved.title || form.title ? "" : "live class"}</span></h2>
          {id && (
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              <StatusBadge status={saved.status} />
              <Link className="btn sm navy" href={routes.studio(id)}><Clapperboard aria-hidden="true" />Open studio</Link>
              <Link className="btn sm" href={routes.watch(id)}><Eye aria-hidden="true" />View as student</Link>
            </div>
          )}
        </div>
      </div>

      <form className="stack" style={{ gap: 18 }} onSubmit={(e) => { e.preventDefault(); save(); }}>
        <FormPanel code="Form LV-1 · Live class" title={id ? "Class details" : "New class"}>
          <Step n={1}>What it&rsquo;s about</Step>
          <label className="field"><span>Class title <span className="req">*</span></span>
            <input value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={160} placeholder="Lien Law Live Q&A" />
            {fieldErr("title")}
          </label>
          <label className="field">Description
            <textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What you'll cover and who should come." />
          </label>
          <label className="field" style={{ maxWidth: 320 }}>Trade
            <select value={form.trade} onChange={(e) => set("trade", e.target.value as TradeOrAll)}>
              {(Object.keys(TRADE_LABELS) as TradeOrAll[]).map((t) => <option key={t} value={t}>{TRADE_LABELS[t]}</option>)}
            </select>
          </label>

          <Step n={2}>When</Step>
          <label className="field" style={{ maxWidth: 320 }}><span>Starts <span className="req">*</span></span>
            <input type="datetime-local" value={form.starts_local} onChange={(e) => set("starts_local", e.target.value)} />
            <span className="hint">In your time ({timeZoneName()}). Students see it in their own time zone.</span>
            {fieldErr("starts_local")}
          </label>

          <Step n={3}>Who can watch</Step>
          <Toggle checked={form.is_free} onChange={(v) => set("is_free", v)} label="Free class" hint="Anyone with a free account can join. Great for bringing in new students." />
          <label className="field">Linked course (optional)
            <select value={form.course_id} onChange={(e) => set("course_id", e.target.value)}>
              <option value="">No course — any paying student</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.title}{c.published ? "" : " (draft)"}</option>)}
            </select>
          </label>
          <p className={s.accessNote}><b>Access:</b> {access} Admins can always watch.</p>

          <Step n={4}>How you&rsquo;ll stream</Step>
          <div className={s.providerPick} role="radiogroup" aria-label="How you'll stream">
            <button type="button" role="radio" aria-checked={form.provider === "livekit"} className={s.providerOpt} onClick={() => set("provider", "livekit")}>
              <MonitorPlay aria-hidden="true" />
              <b>Go live from browser</b>
              <small>Use your laptop camera and mic in the studio. Nothing to install.</small>
            </button>
            <button type="button" role="radio" aria-checked={form.provider === "embed"} className={s.providerOpt} onClick={() => set("provider", "embed")}>
              <Link2 aria-hidden="true" />
              <b>Stream link</b>
              <small>Already streaming on YouTube Live, Vimeo or StreamYard? Paste the embed link.</small>
            </button>
          </div>
          {form.provider === "embed" && (
            <label className="field">Stream link
              <input type="url" value={form.embed_url} onChange={(e) => set("embed_url", e.target.value)} placeholder="https://www.youtube.com/embed/live_stream?channel=…" />
              <span className="hint">Kept private: only students who can watch get it.</span>
              {fieldErr("embed_url")}
            </label>
          )}

          <Step n={5}>Replay (after class)</Step>
          <label className="field">Replay link (optional)
            <input type="url" value={form.replay_url} onChange={(e) => set("replay_url", e.target.value)} placeholder="https://vimeo.com/…" />
            <span className="hint">When the class has ended, students who missed it can watch this recording.</span>
            {fieldErr("replay_url")}
          </label>

          <Step n={6}>Cover image</Step>
          <CoverUpload value={form.cover_url} onChange={(v) => set("cover_url", v)} folder="covers/lives" />

          {id && (
            <>
              <Step n={7}>Status</Step>
              <label className="field" style={{ maxWidth: 320 }}>Status
                <select value={form.status} onChange={(e) => set("status", e.target.value as Live["status"])}>
                  <option value="scheduled">Scheduled</option>
                  <option value="live">Live now</option>
                  <option value="ended">Ended</option>
                </select>
                <span className="hint">The studio sets this when you go live and end. Change it here only if a class got stuck.</span>
              </label>
            </>
          )}

          <button type="submit" className="btn navy cta block" disabled={saving || (!dirty && !!id)}>
            {saving ? "Saving…" : id ? (dirty ? "Save class" : "All changes saved") : "Schedule class"}
          </button>
        </FormPanel>
      </form>

      {id && (
        <section className={`card ${s.danger}`}>
          <h3>Delete this class</h3>
          <p className="note" style={{ margin: "4px 0 10px" }}>Removes it from the schedule, along with its chat and polls.</p>
          <ConfirmButton onConfirm={remove} confirmLabel="Yes, delete class" busyLabel="Deleting…" message={<>Delete “{saved.title}”?</>}>Delete class</ConfirmButton>
        </section>
      )}

      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={id ? () => { setForm(saved); setErrors({}); } : undefined} label={id ? "Save class" : "Schedule class"} />
    </div>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return <button type="button" className={`btn sm ghost ${s.back}`} onClick={onClick}><ArrowLeft aria-hidden="true" />All classes</button>;
}
