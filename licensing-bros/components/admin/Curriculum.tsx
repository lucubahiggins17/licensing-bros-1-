"use client";
// Curriculum editor: modules and lessons with add / rename / delete and up/down ordering.
// Order is saved as module.sort = position and lesson.sort = position across the whole course
// (module order first, then lessons inside each module; lessons without a module come last),
// so lessons sort correctly whether a page groups them by module or not.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Video, FileText, ListChecks, Eye, Layers } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import type { Lesson, Module } from "@/lib/types";
import { errMsg, q, plural } from "./format";
import { useAdmin, ConfirmButton, Empty, ErrorBox, Loading } from "./ui";
import { MoveButtons } from "./fields";
import LessonEditor from "./LessonEditor";
import s from "./admin.module.css";

const KIND: Record<Lesson["kind"], { label: string; Icon: any }> = {
  video: { label: "Video", Icon: Video },
  text: { label: "Reading", Icon: FileText },
  quiz: { label: "Quiz", Icon: ListChecks }
};

export default function Curriculum({ courseId, onCount }: { courseId: string; onCount?: (n: number) => void }) {
  const { toast, guardLeave } = useAdmin();
  const [mods, setMods] = useState<Module[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => { onCount?.(lessons.length); }, [lessons.length, onCount]);

  /** Save the order shown on screen. `prev*` are the rows as last saved, to skip unchanged ones. */
  const persist = useCallback(async (nextMods: Module[], nextLessons: Lesson[], prevMods: Module[], prevLessons: Lesson[]) => {
    const known = new Set(nextMods.map((m) => m.id));
    const flat: Lesson[] = [];
    nextMods.forEach((m) => flat.push(...nextLessons.filter((l) => l.module_id === m.id)));
    flat.push(...nextLessons.filter((l) => !l.module_id || !known.has(l.module_id)));
    const ms = nextMods.map((m, i) => ({ ...m, sort: i }));
    const ls = flat.map((l, i) => ({ ...l, sort: i }));
    setMods(ms);
    setLessons(ls);
    const pm = new Map(prevMods.map((m) => [m.id, m.sort]));
    const pl = new Map(prevLessons.map((l) => [l.id, l.sort]));
    const sb = supabase();
    const jobs = [
      ...ms.filter((m) => pm.get(m.id) !== m.sort).map((m) => q(sb.from("modules").update({ sort: m.sort }).eq("id", m.id))),
      ...ls.filter((l) => pl.get(l.id) !== l.sort).map((l) => q(sb.from("lessons").update({ sort: l.sort }).eq("id", l.id)))
    ];
    if (!jobs.length) return true;
    setBusy(true);
    try { await Promise.all(jobs); return true; }
    catch (e) { toast(errMsg(e, "Couldn't save the new order."), "bad"); return false; }
    finally { setBusy(false); }
  }, [toast]);

  const load = useCallback(async (normalize = false) => {
    setErr("");
    try {
      const sb = supabase();
      const [m, l] = await Promise.all([
        q(sb.from("modules").select("*").eq("course_id", courseId).order("sort", { ascending: true })),
        q(sb.from("lessons").select("*").eq("course_id", courseId).order("sort", { ascending: true }).order("created_at", { ascending: true }))
      ]);
      const ms = (m as Module[]) || [];
      const ls = (l as Lesson[]) || [];
      setMods(ms); setLessons(ls);
      if (normalize) await persist(ms, ls, ms, ls);
    } catch (e) { setErr(errMsg(e, "Couldn't load modules and lessons.")); }
    setLoading(false);
  }, [courseId, persist]);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const known = new Set(mods.map((m) => m.id));
    return {
      list: mods.map((m) => ({ module: m, items: lessons.filter((l) => l.module_id === m.id) })),
      loose: lessons.filter((l) => !l.module_id || !known.has(l.module_id))
    };
  }, [mods, lessons]);

  async function addModule() {
    setBusy(true);
    try {
      const row = (await q(supabase().from("modules").insert({ course_id: courseId, title: `Module ${mods.length + 1}`, sort: mods.length }).select().single())) as Module;
      setMods((m) => [...m, row]);
      setRenaming(row.id);
      toast("Module added. Type its name.", "info");
    } catch (e) { toast(errMsg(e), "bad"); }
    setBusy(false);
  }

  async function renameModule(m: Module, title: string) {
    setRenaming(null);
    const t = title.trim();
    if (!t || t === m.title) return;
    setMods((ms) => ms.map((x) => (x.id === m.id ? { ...x, title: t } : x)));
    try { await q(supabase().from("modules").update({ title: t }).eq("id", m.id)); toast("Module renamed."); }
    catch (e) { setMods((ms) => ms.map((x) => (x.id === m.id ? { ...x, title: m.title } : x))); toast(errMsg(e), "bad"); }
  }

  async function deleteModule(m: Module) {
    try {
      await q(supabase().from("modules").delete().eq("id", m.id));
      setMods((ms) => ms.filter((x) => x.id !== m.id));
      setLessons((ls) => ls.map((l) => (l.module_id === m.id ? { ...l, module_id: null } : l)));
      toast("Module deleted. Its lessons are under “Lessons without a module”.");
    } catch (e) { toast(errMsg(e), "bad"); }
  }

  function moveModule(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= mods.length) return;
    const next = [...mods];
    [next[i], next[j]] = [next[j], next[i]];
    persist(next, lessons, mods, lessons);
  }

  function moveLesson(lesson: Lesson, group: Lesson[], d: number) {
    const gi = group.findIndex((l) => l.id === lesson.id);
    const other = group[gi + d];
    if (!other) return;
    const next = [...lessons];
    const a = next.findIndex((l) => l.id === lesson.id), b = next.findIndex((l) => l.id === other.id);
    [next[a], next[b]] = [next[b], next[a]];
    persist(mods, next, mods, lessons);
  }

  async function addLesson(moduleId: string | null) {
    setBusy(true);
    try {
      const sb = supabase();
      const row = (await q(sb.from("lessons").insert({ course_id: courseId, module_id: moduleId, title: "New lesson", kind: "video", sort: 100000 + lessons.length }).select().single())) as Lesson;
      try { await q(sb.from("lesson_content").upsert({ lesson_id: row.id }, { onConflict: "lesson_id" })); } catch { /* the editor creates it on save */ }
      await persist(mods, [...lessons, row], mods, lessons);
      setOpen(row.id);
    } catch (e) { toast(errMsg(e), "bad"); }
    setBusy(false);
  }

  async function deleteLesson(l: Lesson) {
    try {
      await q(supabase().from("lessons").delete().eq("id", l.id));
      setLessons((ls) => ls.filter((x) => x.id !== l.id));
      toast("Lesson deleted.");
    } catch (e) { toast(errMsg(e), "bad"); }
  }

  if (open) {
    return (
      <LessonEditor
        lessonId={open}
        modules={mods}
        onBack={(moved) => guardLeave(() => { setOpen(null); load(moved); })}
        onDeleted={() => { setOpen(null); load(true); }}
      />
    );
  }
  if (loading) return <Loading text="Loading modules and lessons…" />;
  if (err) return <ErrorBox text={err} onRetry={() => load()} />;

  const lessonRow = (l: Lesson, group: Lesson[], li: number) => {
    const K = KIND[l.kind] || KIND.video;
    return (
      <li key={l.id} className={s.lessonRow}>
        <span className={s.kindIco} title={K.label}><K.Icon aria-hidden="true" /></span>
        <button type="button" className={s.lessonTitle} onClick={() => setOpen(l.id)}>
          <b>{l.title}</b>
          <small>
            {K.label}{l.duration_min ? ` · ${l.duration_min} min` : ""}
            {l.is_preview && <span className={s.previewTag}><Eye aria-hidden="true" />Free preview</span>}
          </small>
        </button>
        <span className={s.lessonActions}>
          <MoveButtons what="lesson" disabled={busy} onUp={() => moveLesson(l, group, -1)} onDown={() => moveLesson(l, group, 1)} upDisabled={li === 0} downDisabled={li === group.length - 1} />
          <button type="button" className="btn sm" onClick={() => setOpen(l.id)}><Pencil aria-hidden="true" />Edit</button>
          <ConfirmButton className={s.iconBtn} title={`Delete lesson ${l.title}`} onConfirm={() => deleteLesson(l)} message={<>Delete “{l.title}”?</>}>
            <Trash2 aria-hidden="true" />
          </ConfirmButton>
        </span>
      </li>
    );
  };

  if (!mods.length && !lessons.length) {
    return (
      <div className="card">
        <Empty icon={Layers} title="No lessons yet"
          action={<div className="row" style={{ justifyContent: "center" }}>
            <button type="button" className="btn primary" onClick={addModule} disabled={busy}><Plus aria-hidden="true" />Add a module</button>
            <button type="button" className="btn" onClick={() => addLesson(null)} disabled={busy}><Plus aria-hidden="true" />Add a lesson</button>
          </div>}>
          Modules are chapters, like &ldquo;Business &amp; Law&rdquo; or &ldquo;Code navigation&rdquo;. Add a module, then lessons inside it. Short courses can skip modules.
        </Empty>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row between">
        <p className="note" style={{ margin: 0 }}>{plural(mods.length, "module")} · {plural(lessons.length, "lesson")}. Use the arrows to change the order; it saves right away.</p>
        <button type="button" className="btn sm primary" onClick={addModule} disabled={busy}><Plus aria-hidden="true" />Add module</button>
      </div>

      {groups.list.map(({ module: m, items }, gi) => (
        <section key={m.id} className={s.module} aria-label={`Module ${gi + 1}: ${m.title}`}>
          <header className={s.moduleHead}>
            <span className={s.moduleNum}>{gi + 1}</span>
            {renaming === m.id ? (
              <input className={`input ${s.moduleInput}`} autoFocus defaultValue={m.title} aria-label="Module name" maxLength={160}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => renameModule(m, e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
                  if (e.key === "Escape") { e.preventDefault(); setRenaming(null); }
                }} />
            ) : (
              <button type="button" className={s.moduleTitle} onClick={() => setRenaming(m.id)} title="Rename module">
                {m.title}<Pencil aria-hidden="true" />
              </button>
            )}
            <span className={s.moduleActions}>
              <MoveButtons what="module" disabled={busy} onUp={() => moveModule(gi, -1)} onDown={() => moveModule(gi, 1)} upDisabled={gi === 0} downDisabled={gi === mods.length - 1} />
              <ConfirmButton className={s.iconBtn} title={`Delete module ${m.title}`} onConfirm={() => deleteModule(m)}
                message={items.length ? <>Delete “{m.title}”? Its {plural(items.length, "lesson")} will move to &ldquo;Lessons without a module&rdquo;.</> : <>Delete “{m.title}”?</>}>
                <Trash2 aria-hidden="true" />
              </ConfirmButton>
            </span>
          </header>
          <ol className={s.lessonList}>
            {items.map((l, li) => lessonRow(l, items, li))}
            {!items.length && <li className={s.lessonEmpty}>No lessons in this module yet.</li>}
          </ol>
          <div><button type="button" className="btn sm" onClick={() => addLesson(m.id)} disabled={busy}><Plus aria-hidden="true" />Add lesson</button></div>
        </section>
      ))}

      {(groups.loose.length > 0 || !mods.length) && (
        <section className={`${s.module} ${s.moduleLoose}`} aria-label="Lessons without a module">
          <header className={s.moduleHead}>
            <span className={s.moduleTitleStatic}>{mods.length ? "Lessons without a module" : "Lessons"}</span>
          </header>
          {mods.length > 0 && <p className="note" style={{ margin: 0 }}>Open a lesson and pick a module to move it.</p>}
          <ol className={s.lessonList}>
            {groups.loose.map((l, li) => lessonRow(l, groups.loose, li))}
            {!groups.loose.length && <li className={s.lessonEmpty}>No lessons yet.</li>}
          </ol>
          <div><button type="button" className="btn sm" onClick={() => addLesson(null)} disabled={busy}><Plus aria-hidden="true" />Add lesson</button></div>
        </section>
      )}
    </div>
  );
}
