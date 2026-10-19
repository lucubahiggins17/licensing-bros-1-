"use client";
// Courses: the list of every course (published or draft) and the course editor.
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Plus, Pencil, Search, ImageOff } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { TRADE_LABELS, type Course } from "@/lib/types";
import { errMsg, q, usd } from "./format";
import { useAdmin, Empty, ErrorBox, Intent, Loading, SectionHead, Toggle } from "./ui";
import CourseEditor from "./CourseEditor";
import s from "./admin.module.css";

type CourseRow = Course & { lessons?: { id: string }[] };

export default function Courses({ intent }: { intent: Intent }) {
  const { guardLeave, toast } = useAdmin();
  // undefined = list, null = new course, string = editing that course
  const [editing, setEditing] = useState<string | null | undefined>(
    intent?.action === "new" ? null : intent?.action === "edit" ? intent.id : undefined
  );
  const [rows, setRows] = useState<CourseRow[] | null>(null);
  const [err, setErr] = useState("");
  const [find, setFind] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr("");
    try {
      const data = await q(supabase().from("courses").select("*, lessons(id)").order("sort", { ascending: true }).order("created_at", { ascending: true }));
      setRows((data as CourseRow[]) || []);
    } catch (e) { setErr(errMsg(e, "Couldn't load courses.")); }
  }, []);
  useEffect(() => { if (editing === undefined) load(); }, [editing, load]);

  async function setPublished(c: CourseRow, published: boolean) {
    setBusy(c.id);
    setRows((r) => r?.map((x) => (x.id === c.id ? { ...x, published } : x)) ?? r);
    try {
      await q(supabase().from("courses").update({ published, updated_at: new Date().toISOString() }).eq("id", c.id));
      toast(published ? `“${c.title}” is live in the catalog.` : `“${c.title}” is hidden from the catalog.`);
    } catch (e) {
      setRows((r) => r?.map((x) => (x.id === c.id ? { ...x, published: !published } : x)) ?? r);
      toast(errMsg(e), "bad");
    }
    setBusy(null);
  }

  const shown = useMemo(() => {
    const f = find.trim().toLowerCase();
    return (rows || []).filter((c) => !f || c.title.toLowerCase().includes(f) || c.slug.includes(f));
  }, [rows, find]);

  if (editing !== undefined) {
    return (
      <CourseEditor
        id={editing}
        onClose={() => guardLeave(() => setEditing(undefined))}
        onDeleted={() => setEditing(undefined)}
      />
    );
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <SectionHead eyebrow="Courses" title="Courses &" accent="lessons"
        sub="Create a course, add modules and lessons, upload videos, then publish it to the catalog."
        actions={<button type="button" className="btn primary" onClick={() => setEditing(null)}><Plus aria-hidden="true" />New course</button>} />

      {err ? <ErrorBox text={err} onRetry={load} /> : !rows ? <Loading text="Loading courses…" /> : !rows.length ? (
        <div className="card">
          <Empty icon={BookOpen} title="No courses yet. Create your first course."
            action={<button type="button" className="btn primary cta" onClick={() => setEditing(null)}><Plus aria-hidden="true" />Create a course</button>}>
            Give it a name and price, add lessons and videos, then turn on Published when it&rsquo;s ready.
          </Empty>
        </div>
      ) : (
        <>
          {rows.length > 5 && (
            <label className={s.searchBox}>
              <Search aria-hidden="true" />
              <input className="input" placeholder="Find a course" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find a course" />
            </label>
          )}
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr><th>Course</th><th>Trade</th><th>Price</th><th>Lessons</th><th>Published</th><th><span className={s.srOnly}>Actions</span></th></tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Course">
                      <div className={s.courseCell}>
                        <span className={s.thumb}>{c.cover_url ? <img src={c.cover_url} alt="" /> : <ImageOff aria-hidden="true" />}</span>
                        <span style={{ minWidth: 0 }}>
                          <button type="button" className={s.linkBtn} onClick={() => setEditing(c.id)}>{c.title}</button>
                          <small className={s.cellSub}>{c.subtitle || c.slug}</small>
                        </span>
                      </div>
                    </td>
                    <td data-label="Trade">{TRADE_LABELS[c.trade] || c.trade}{c.states?.length ? <small className={s.cellSub}>{c.states.length === 1 ? c.states[0] : `${c.states.length} states`}</small> : <small className={s.cellSub}>All states</small>}</td>
                    <td data-label="Price">{c.is_free ? <span className="badge free">Free</span> : usd(c.price_cents)}</td>
                    <td data-label="Lessons">{c.lessons?.length ?? 0}</td>
                    <td data-label="Published">
                      <Toggle small checked={c.published} disabled={busy === c.id} onChange={(v) => setPublished(c, v)} label={c.published ? "Published" : "Draft"} />
                    </td>
                    <td data-label="">
                      <button type="button" className="btn sm" onClick={() => setEditing(c.id)}><Pencil aria-hidden="true" />Edit</button>
                    </td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={6} className="note">No course matches “{find}”.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
