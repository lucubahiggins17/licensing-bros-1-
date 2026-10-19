"use client";
// Course editor: details (Form CS-1 style) + curriculum (modules & lessons).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ExternalLink, Loader2, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { routes } from "@/lib/nav";
import { TRADE_LABELS, type Course, type TradeOrAll } from "@/lib/types";
import { errMsg, q, slugify, SLUG_RE, plural } from "./format";
import { useAdmin, useDirty, ConfirmButton, ErrorBox, FormPanel, Loading, SaveBar, Step, Toggle } from "./ui";
import { CoverUpload, ListEditor, StatePicker } from "./fields";
import Curriculum from "./Curriculum";
import s from "./admin.module.css";

type Form = {
  title: string; slug: string; subtitle: string; description: string; trade: TradeOrAll; states: string[]; level: string;
  price: string; is_free: boolean; est_hours: string; what_you_learn: string[]; cover_url: string | null; published: boolean; sort: string;
};
const EMPTY: Form = {
  title: "", slug: "", subtitle: "", description: "", trade: "gc", states: [], level: "Exam prep", price: "", is_free: false,
  est_hours: "", what_you_learn: [], cover_url: null, published: false, sort: "0"
};
const LEVELS = ["Exam prep", "Beginner", "Intermediate", "Advanced", "Business & Law", "Continuing education"];

const toForm = (c: Course): Form => ({
  title: c.title || "", slug: c.slug || "", subtitle: c.subtitle || "", description: c.description || "", trade: c.trade || "gc",
  states: c.states || [], level: c.level || "", price: c.price_cents ? (c.price_cents / 100).toFixed(c.price_cents % 100 ? 2 : 0) : "",
  is_free: !!c.is_free, est_hours: c.est_hours == null ? "" : String(c.est_hours), what_you_learn: c.what_you_learn || [],
  cover_url: c.cover_url || null, published: !!c.published, sort: String(c.sort ?? 0)
});

const priceCents = (p: string) => Math.round((parseFloat(p.replace(/[$,\s]/g, "")) || 0) * 100);

const toRow = (f: Form) => ({
  title: f.title.trim(), slug: f.slug.trim(), subtitle: f.subtitle.trim(), description: f.description.trim(), trade: f.trade,
  states: f.states, level: f.level.trim() || "Exam prep", price_cents: f.is_free ? 0 : priceCents(f.price), is_free: f.is_free,
  est_hours: f.est_hours.trim() === "" ? null : Number(f.est_hours), what_you_learn: f.what_you_learn.map((x) => x.trim()).filter(Boolean),
  cover_url: f.cover_url, published: f.published, sort: parseInt(f.sort, 10) || 0, updated_at: new Date().toISOString()
});

function validate(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.title.trim()) e.title = "Give the course a name.";
  else if (f.title.trim().length > 160) e.title = "Keep the name under 160 characters.";
  if (!f.slug.trim()) e.slug = "Add a short name (letters, numbers and dashes).";
  else if (!SLUG_RE.test(f.slug.trim())) e.slug = "Use only lowercase letters, numbers and single dashes, like tn-gc-exam-prep.";
  if (!f.is_free) {
    const p = priceCents(f.price);
    if (!f.price.trim() || isNaN(parseFloat(f.price.replace(/[$,\s]/g, "")))) e.price = "Set a price, or turn on Free.";
    else if (p < 50) e.price = "Paid courses must cost at least $0.50 (a card-payment minimum). Or turn on Free.";
    else if (p > 10000000) e.price = "That price looks too high.";
  }
  if (f.est_hours.trim() && (isNaN(Number(f.est_hours)) || Number(f.est_hours) < 0)) e.est_hours = "Use a number of hours, like 12 or 2.5.";
  if (f.sort.trim() && !/^-?\d+$/.test(f.sort.trim())) e.sort = "Use a whole number.";
  return e;
}

export default function CourseEditor({ id: initialId, onClose, onDeleted }: { id: string | null; onClose: () => void; onDeleted: () => void }) {
  const { toast } = useAdmin();
  const [id, setId] = useState<string | null>(initialId);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saved, setSaved] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(!!initialId);
  const [loadErr, setLoadErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [slugTouched, setSlugTouched] = useState(!!initialId);
  const [slugState, setSlugState] = useState<"" | "checking" | "ok" | "taken">("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"details" | "curriculum">("details");
  const [enrolled, setEnrolled] = useState<number | null>(null);
  const [lessonCount, setLessonCount] = useState<number | null>(null);

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  useDirty("course", dirty);

  const load = useCallback(async () => {
    if (!initialId) return;
    setLoading(true); setLoadErr("");
    try {
      const c = await q(supabase().from("courses").select("*").eq("id", initialId).single());
      const f = toForm(c as Course);
      setForm(f); setSaved(f);
      const [en, ls] = await Promise.allSettled([
        q(supabase().from("enrollments").select("user_id").eq("course_id", initialId).limit(10000)),
        q(supabase().from("lessons").select("id").eq("course_id", initialId))
      ]);
      if (en.status === "fulfilled") setEnrolled(((en.value as any[]) || []).length);
      if (ls.status === "fulfilled") setLessonCount(((ls.value as any[]) || []).length);
    } catch (e) { setLoadErr(errMsg(e, "Couldn't load this course.")); }
    setLoading(false);
  }, [initialId]);
  useEffect(() => { load(); }, [load]);

  // Live check that the short name (slug) isn't used by another course
  useEffect(() => {
    const slug = form.slug.trim();
    if (!slug || !SLUG_RE.test(slug)) { setSlugState(""); return; }
    if (id && slug === saved.slug) { setSlugState("ok"); return; }
    setSlugState("checking");
    const t = setTimeout(async () => {
      try {
        const rows = await q(supabase().from("courses").select("id").eq("slug", slug).limit(2));
        setSlugState(((rows as any[]) || []).some((r) => r.id !== id) ? "taken" : "ok");
      } catch { setSlugState(""); }
    }, 450);
    return () => clearTimeout(t);
  }, [form.slug, id, saved.slug]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => {
      const n = { ...f, [k]: v };
      if (k === "title" && !slugTouched) n.slug = slugify(String(v));
      return n;
    });
    if (errors[k as string]) setErrors((e) => { const n = { ...e }; delete n[k as string]; return n; });
  };

  async function save() {
    const errs = validate(form);
    if (!errs.slug && slugState === "taken") errs.slug = `Another course already uses “${form.slug}”. Try “${form.slug}-2”.`;
    setErrors(errs);
    if (Object.keys(errs).length) {
      setTab("details");
      toast("Fix the highlighted fields first.", "bad");
      setTimeout(() => document.querySelector<HTMLElement>(`[data-err="1"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      return;
    }
    setSaving(true);
    try {
      const slug = form.slug.trim();
      const dup = (await q(supabase().from("courses").select("id").eq("slug", slug).limit(2))) as any[];
      if ((dup || []).some((r) => r.id !== id)) {
        setErrors({ slug: `Another course already uses “${slug}”. Try “${slug}-2”.` });
        setSlugState("taken");
        toast("That short name is taken.", "bad");
        setSaving(false);
        return;
      }
      const row = toRow(form);
      const data = id
        ? await q(supabase().from("courses").update(row).eq("id", id).select().single())
        : await q(supabase().from("courses").insert(row).select().single());
      const f = toForm(data as Course);
      setForm(f); setSaved(f); setSlugTouched(true);
      if (!id) {
        setId((data as Course).id);
        setEnrolled(0); setLessonCount(0);
        toast("Course created. Next: add modules and lessons.");
        setTab("curriculum");
      } else toast("Course saved.");
    } catch (e: any) {
      const m = errMsg(e);
      if (/already exists/i.test(m)) { setErrors({ slug: "Another course already uses this short name." }); setSlugState("taken"); }
      toast(m, "bad");
    }
    setSaving(false);
  }

  async function remove() {
    try {
      await q(supabase().from("courses").delete().eq("id", id));
      setSaved(form); // nothing left to save
      toast("Course deleted.");
      onDeleted();
    } catch (e) { toast(errMsg(e), "bad"); }
  }

  if (loading) return <Loading text="Loading course…" />;
  if (loadErr) return <div className="stack"><BackBtn onClick={onClose} /><ErrorBox text={loadErr} onRetry={load} /></div>;

  const err = (k: string) => errors[k] ? <span className={s.fieldErr} role="alert">{errors[k]}</span> : null;
  const errAttr = (k: string) => (errors[k] ? { "data-err": "1", className: `field ${s.invalid}` } : {});

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className={s.editorTop}>
        <BackBtn onClick={onClose} />
        <div className={s.editorTitle}>
          <div className="eyebrow orange">{id ? "Edit course" : "New course"}</div>
          <h2 className={s.h2}>{saved.title || form.title || "Untitled"} <span>{id ? "" : "course"}</span></h2>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            {id && (saved.published ? <span className="badge v">Published</span> : <span className="badge">Draft — hidden</span>)}
            {saved.is_free && id && <span className="badge free">Free</span>}
            {id && <Link className="btn sm ghost" href={routes.course(id)}><ExternalLink aria-hidden="true" />View course page</Link>}
          </div>
        </div>
      </div>

      <div className={`seg ${s.tabs}`} role="group" aria-label="Course editor">
        <button type="button" aria-pressed={tab === "details"} onClick={() => setTab("details")}>1 · Details</button>
        <button type="button" aria-pressed={tab === "curriculum"} disabled={!id}
          title={!id ? "Save the course first" : undefined} onClick={() => setTab("curriculum")}>
          2 · Modules &amp; lessons{lessonCount != null ? ` (${lessonCount})` : ""}
        </button>
      </div>

      {tab === "curriculum" && id ? (
        <Curriculum courseId={id} onCount={setLessonCount} />
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="stack" style={{ gap: 18 }}>
          <FormPanel code="Form CS-1 · Course details" title={id ? "Course details" : "Create a course"}>
            <Step n={1}>Name it</Step>
            <label className="field" {...errAttr("title")}><span>Course name <span className="req">*</span></span>
              <input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Tennessee GC Exam Master Course" maxLength={160} />
              {err("title")}
            </label>
            <label className="field" {...errAttr("slug")}><span>Short name (slug) <span className="req">*</span></span>
              <div className={s.inputWithStatus}>
                <input value={form.slug} onChange={(e) => { setSlugTouched(true); set("slug", e.target.value.toLowerCase().replace(/\s+/g, "-")); }} placeholder="tn-gc-master" maxLength={80} />
                <span className={s.inputStatus} aria-live="polite">
                  {slugState === "checking" && <><Loader2 className={s.spinIco} aria-hidden="true" />Checking</>}
                  {slugState === "ok" && <><Check aria-hidden="true" className="ok-text" />Available</>}
                  {slugState === "taken" && <><X aria-hidden="true" className="err" />Taken</>}
                </span>
              </div>
              <span className="hint">
                A unique ID for this course. Made from the name automatically.
                {!id && slugTouched && form.title && slugify(form.title) !== form.slug && <> <button type="button" className={s.inlineLink} onClick={() => { setSlugTouched(false); set("slug", slugify(form.title)); }}>Use “{slugify(form.title)}”</button></>}
              </span>
              {err("slug")}
            </label>
            <label className="field">Subtitle
              <input value={form.subtitle} onChange={(e) => set("subtitle", e.target.value)} placeholder="Business & Law plus the trade exam, start to finish" maxLength={200} />
              <span className="hint">One line under the name in the catalog.</span>
            </label>

            <Step n={2}>Who it&rsquo;s for</Step>
            <div className="grid2">
              <label className="field">Trade
                <select value={form.trade} onChange={(e) => set("trade", e.target.value as TradeOrAll)}>
                  {(Object.keys(TRADE_LABELS) as TradeOrAll[]).map((t) => <option key={t} value={t}>{TRADE_LABELS[t]}</option>)}
                </select>
              </label>
              <label className="field">Level
                <input value={form.level} onChange={(e) => set("level", e.target.value)} list="course-levels" placeholder="Exam prep" />
                <datalist id="course-levels">{LEVELS.map((l) => <option key={l} value={l} />)}</datalist>
              </label>
            </div>
            <div className="field" role="group" aria-label="States">States
              <StatePicker value={form.states} onChange={(v) => set("states", v)} />
              <span className="hint">Students searching for these states see the course. &ldquo;All states&rdquo; fits national topics like OSHA.</span>
            </div>

            <Step n={3}>Price</Step>
            <Toggle checked={form.is_free} onChange={(v) => set("is_free", v)} label="Free course"
              hint="Anyone with a free account can take it. Turn off to charge for it." />
            <div className="grid2">
              <label className="field" {...errAttr("price")}>Price (US dollars)
                <div className={s.money}>
                  <span aria-hidden="true">$</span>
                  <input inputMode="decimal" value={form.is_free ? "" : form.price} disabled={form.is_free}
                    onChange={(e) => set("price", e.target.value.replace(/[^0-9.]/g, ""))} placeholder={form.is_free ? "Free" : "299"} />
                </div>
                <span className="hint">{form.is_free ? "Free courses don't charge." : "What students pay once at checkout."}</span>
                {err("price")}
              </label>
              <label className="field" {...errAttr("est_hours")}>Estimated hours
                <input inputMode="decimal" value={form.est_hours} onChange={(e) => set("est_hours", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="12" />
                <span className="hint">About how long it takes to finish.</span>
                {err("est_hours")}
              </label>
            </div>

            <Step n={4}>Describe it</Step>
            <label className="field">Description
              <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={5}
                placeholder="Who this course is for, what exam it prepares them for, and how it's taught." />
            </label>
            <div className="field" role="group" aria-label="What you'll learn">What you&rsquo;ll learn
              <ListEditor items={form.what_you_learn} onChange={(v) => set("what_you_learn", v)} what="point"
                placeholder="Navigate your code book fast" addLabel="Add a point" />
              <span className="hint">Short bullet points shown on the course page. 3 to 6 works best.</span>
            </div>

            <Step n={5}>Cover image</Step>
            <CoverUpload value={form.cover_url} onChange={(v) => set("cover_url", v)} folder="covers/courses" />

            <Step n={6}>Publish</Step>
            <Toggle checked={form.published} onChange={(v) => set("published", v)} label="Published"
              hint="On = students can see it in the catalog (and buy it). Off = only admins can see it." />
            <label className="field" {...errAttr("sort")} style={{ maxWidth: 260 }}>Catalog order
              <input inputMode="numeric" value={form.sort} onChange={(e) => set("sort", e.target.value.replace(/[^0-9-]/g, ""))} />
              <span className="hint">Lower numbers show first.</span>
              {err("sort")}
            </label>

            <button type="submit" className="btn navy cta block" disabled={saving || (!dirty && !!id)}>
              {saving ? "Saving…" : id ? (dirty ? "Save course" : "All changes saved") : "Create course"}
            </button>
          </FormPanel>

          {id && (
            <section className={`card ${s.danger}`}>
              <h3>Delete this course</h3>
              <p className="note" style={{ margin: "4px 0 10px" }}>
                {enrolled ? <><b>{plural(enrolled, "student")}</b> {enrolled === 1 ? "has" : "have"} access to this course. Deleting it removes their access, lessons and progress. </> : "Deleting removes the course, its modules, lessons and quizzes. "}
                To hide it but keep students&rsquo; access, turn off <b>Published</b> instead.
              </p>
              <ConfirmButton onConfirm={remove} confirmLabel="Yes, delete forever" busyLabel="Deleting…"
                message={<>Delete “{saved.title}” forever? This can&rsquo;t be undone.</>}>
                Delete course
              </ConfirmButton>
            </section>
          )}
        </form>
      )}

      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={id ? () => { setForm(saved); setErrors({}); } : undefined}
        label={id ? "Save course" : "Create course"} />
    </div>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return <button type="button" className={`btn sm ghost ${s.back}`} onClick={onClick}><ArrowLeft aria-hidden="true" />All courses</button>;
}
