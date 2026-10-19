"use client";
// Lesson editor: outline fields (lessons table) + protected content (lesson_content):
// video link or uploaded video, Markdown notes with live preview, attachments and a quiz (hand-written or AI).
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Film, FileText, Link2, Paperclip, Play, Plus, Sparkles, Trash2, Upload, X, Lock } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { callFn } from "@/lib/api";
import { routes } from "@/lib/nav";
import type { Lesson, LessonContent, Module, QuizItem } from "@/lib/types";
import { errMsg, q } from "./format";
import { useAdmin, useDirty, useMounted, ConfirmButton, ErrorBox, FormPanel, Loading, SaveBar, Step, Toggle } from "./ui";
import { ChoiceRows, MarkdownEditor, MoveButtons, UploadProgress } from "./fields";
import { fmtBytes, signedUrl, storageFileName, uploadPrivate, type UploadJob } from "./storage";
import s from "./admin.module.css";

type Att = { name: string; url: string };
type Form = {
  title: string; kind: Lesson["kind"]; is_preview: boolean; duration: string; summary: string; module_id: string;
  video_url: string; body_md: string; quiz: QuizItem[]; attachments: Att[];
};
const EMPTY: Form = { title: "", kind: "video", is_preview: false, duration: "", summary: "", module_id: "", video_url: "", body_md: "", quiz: [], attachments: [] };
const MAX_VIDEO = 5 * 1024 ** 3;
const MAX_FILE = 200 * 1024 ** 2;

export function videoInfo(u: string): { label: string; ok: boolean; embed?: string; file?: boolean } | null {
  const v = (u || "").trim();
  if (!v) return null;
  if (v.startsWith("storage:")) return { label: "Uploaded video (private)", ok: true, file: true };
  if (!/^https?:\/\//i.test(v)) return { label: "Links start with https://", ok: false };
  const yt = v.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|live\/|shorts\/)|youtu\.be\/)([\w-]{11})/i);
  if (yt) return { label: "YouTube video", ok: true, embed: `https://www.youtube-nocookie.com/embed/${yt[1]}` };
  const vm = v.match(/vimeo\.com\/(?:.*\/)?(?:video\/)?(\d{5,})/i);
  if (vm) return { label: "Vimeo video", ok: true, embed: `https://player.vimeo.com/video/${vm[1]}` };
  if (/\.(mp4|webm|m4v|mov|m3u8)(\?|#|$)/i.test(v)) return { label: "Video file link", ok: true, file: true };
  return { label: "We don't recognize this link. YouTube, Vimeo or a direct .mp4 link works best.", ok: false };
}

const cleanQuiz = (items: QuizItem[]): QuizItem[] =>
  items.map((x) => ({ q: x.q.trim(), c: [0, 1, 2, 3].map((k) => (x.c[k] ?? "").trim()), a: x.a, why: (x.why || "").trim() }));
const quizProblem = (items: QuizItem[]): string | null => {
  for (let i = 0; i < items.length; i++) {
    const x = items[i];
    if (!x.q.trim()) return `Quiz question ${i + 1} needs the question text.`;
    if ([0, 1, 2, 3].some((k) => !(x.c[k] ?? "").trim())) return `Quiz question ${i + 1} needs all 4 choices filled in.`;
    if (!(x.a >= 0 && x.a <= 3)) return `Pick the correct answer for quiz question ${i + 1}.`;
  }
  return null;
};
const normQuiz = (raw: any): QuizItem | null => {
  if (!raw || typeof raw.q !== "string" || !Array.isArray(raw.c) || raw.c.length < 4) return null;
  const a = Number(raw.a);
  return { q: raw.q, c: raw.c.slice(0, 4).map((c: any) => String(c ?? "")), a: a >= 0 && a <= 3 ? a : 0, why: String(raw.why ?? "") };
};

export default function LessonEditor({ lessonId, modules, onBack, onDeleted }: {
  lessonId: string; modules: Module[]; onBack: (moved: boolean) => void; onDeleted: () => void;
}) {
  const { toast } = useAdmin();
  const mounted = useMounted();
  const [form, setForm] = useState<Form>(EMPTY);
  const [saved, setSaved] = useState<Form>(EMPTY);
  const [courseId, setCourseId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [videoMode, setVideoMode] = useState<"link" | "upload" | "none">("link");
  const [videoUp, setVideoUp] = useState<{ pct: number; name: string; job: UploadJob } | null>(null);
  const [fileUp, setFileUp] = useState<{ pct: number; name: string; job: UploadJob } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const moved = useRef(false);
  const videoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  useDirty("lesson", dirty || !!videoUp || !!fileUp);

  const load = useCallback(async () => {
    setLoading(true); setLoadErr("");
    try {
      const sb = supabase();
      const [l, c] = await Promise.all([
        q(sb.from("lessons").select("*").eq("id", lessonId).single()),
        q(sb.from("lesson_content").select("*").eq("lesson_id", lessonId).maybeSingle())
      ]);
      const lesson = l as Lesson;
      const content = (c as LessonContent | null) || null;
      const f: Form = {
        title: lesson.title || "", kind: lesson.kind || "video", is_preview: !!lesson.is_preview,
        duration: lesson.duration_min == null ? "" : String(lesson.duration_min), summary: lesson.summary || "", module_id: lesson.module_id || "",
        video_url: content?.video_url || "", body_md: content?.body_md || "",
        quiz: (Array.isArray(content?.quiz) ? content!.quiz : []).map(normQuiz).filter(Boolean) as QuizItem[],
        attachments: (Array.isArray(content?.attachments) ? content!.attachments : []).filter((a: any) => a && a.url).map((a: any) => ({ name: String(a.name || ""), url: String(a.url) }))
      };
      setCourseId(lesson.course_id);
      setForm(f); setSaved(f);
      setVideoMode(f.video_url.startsWith("storage:") ? "upload" : f.video_url ? "link" : lesson.kind === "video" ? "link" : "none");
    } catch (e) { setLoadErr(errMsg(e, "Couldn't load this lesson.")); }
    setLoading(false);
  }, [lessonId]);
  useEffect(() => { load(); }, [load]);

  // stop any running uploads if the editor closes
  const jobs = useRef<UploadJob[]>([]);
  useEffect(() => () => { jobs.current.forEach((j) => j.abort()); }, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k as string]) setErrors((e) => { const n = { ...e }; delete n[k as string]; return n; });
  };

  // ------------------------------------------------------------------ uploads
  function startVideo(file: File) {
    if (!file.type.startsWith("video/") && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) { toast("Pick a video file (MP4 works everywhere).", "bad"); return; }
    if (file.size > MAX_VIDEO) { toast("That video is over 5 GB. Compress it or use a Vimeo/YouTube link.", "bad"); return; }
    const job = uploadPrivate(file, `lessons/${lessonId}`, (pct) => { if (mounted.current) setVideoUp((u) => (u ? { ...u, pct } : u)); });
    jobs.current.push(job);
    setVideoUp({ pct: 0, name: `${file.name} (${fmtBytes(file.size)})`, job });
    setPreview(null);
    job.promise
      .then((ref) => { if (!mounted.current) return; set("video_url", ref); toast("Video uploaded. Save the lesson to keep it."); })
      .catch((e) => { if (mounted.current && e?.name !== "AbortError") toast(errMsg(e), "bad"); })
      .finally(() => { if (mounted.current) setVideoUp(null); });
  }

  function startFile(file: File) {
    if (file.size > MAX_FILE) { toast("That file is over 200 MB. Use a smaller file or add it as a link.", "bad"); return; }
    const job = uploadPrivate(file, `lessons/${lessonId}/files`, (pct) => { if (mounted.current) setFileUp((u) => (u ? { ...u, pct } : u)); });
    jobs.current.push(job);
    setFileUp({ pct: 0, name: file.name, job });
    job.promise
      .then((ref) => {
        if (!mounted.current) return;
        const name = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || file.name;
        setForm((f) => ({ ...f, attachments: [...f.attachments, { name, url: ref }] }));
        toast("File attached. Save the lesson to keep it.");
      })
      .catch((e) => { if (mounted.current && e?.name !== "AbortError") toast(errMsg(e), "bad"); })
      .finally(() => { if (mounted.current) setFileUp(null); });
  }

  async function showPreview() {
    const v = form.video_url.trim();
    const info = videoInfo(v);
    if (!info?.ok) return;
    if (info.embed) { setPreview(info.embed); return; }
    const url = await signedUrl(v);
    if (url) setPreview(url); else toast("Couldn't open that video. Try uploading it again.", "bad");
  }

  // ------------------------------------------------------------------ quiz
  const setQuiz = (i: number, patch: Partial<QuizItem>) => set("quiz", form.quiz.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const moveQuiz = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= form.quiz.length) return;
    const n = [...form.quiz];
    [n[i], n[j]] = [n[j], n[i]];
    set("quiz", n);
  };

  async function aiQuiz() {
    setAiBusy(true);
    try {
      const res = await callFn<{ quiz: any[] }>("generate", { kind: "lesson_quiz", lesson_id: lessonId });
      const items = (res?.quiz || []).map(normQuiz).filter(Boolean) as QuizItem[];
      if (!items.length) throw new Error("The AI didn't return any questions. Try again.");
      if (!mounted.current) return;
      setForm((f) => ({ ...f, quiz: [...f.quiz, ...items] }));
      toast(`Added ${items.length} AI question${items.length === 1 ? "" : "s"}. Read them over, fix anything, then save.`);
    } catch (e) { if (mounted.current) toast(errMsg(e, "The AI couldn't write a quiz right now."), "bad"); }
    if (mounted.current) setAiBusy(false);
  }

  // ------------------------------------------------------------------ save / delete
  async function save() {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = "Give the lesson a title.";
    if (form.duration.trim() && !/^\d{1,4}$/.test(form.duration.trim())) e.duration = "Use whole minutes, like 12.";
    const vi = videoMode === "link" ? videoInfo(form.video_url) : null;
    if (vi && !vi.ok && !/^https?:\/\//i.test(form.video_url.trim())) e.video_url = vi.label;
    const qp = quizProblem(form.quiz);
    if (qp) e.quiz = qp;
    if (form.attachments.some((a) => !a.url.trim())) e.attachments = "Every attachment needs a link or an uploaded file.";
    setErrors(e);
    if (Object.keys(e).length) { toast(Object.values(e)[0], "bad"); return; }

    setSaving(true);
    try {
      const sb = supabase();
      const moduleChanged = (form.module_id || "") !== (saved.module_id || "");
      const lessonRow: Record<string, any> = {
        title: form.title.trim(), kind: form.kind, is_preview: form.is_preview,
        duration_min: form.duration.trim() ? parseInt(form.duration, 10) : null, summary: form.summary.trim(), module_id: form.module_id || null
      };
      if (moduleChanged) lessonRow.sort = 100000; // lands at the end of its new module; the curriculum renumbers on return
      const videoUrl = videoMode === "none" ? null : form.video_url.trim() || null;
      const content = {
        lesson_id: lessonId, video_url: videoUrl, body_md: form.body_md,
        quiz: cleanQuiz(form.quiz),
        attachments: form.attachments.map((a) => ({ name: a.name.trim() || storageFileName(a.url), url: a.url.trim() }))
      };
      await q(sb.from("lessons").update(lessonRow).eq("id", lessonId));
      await q(sb.from("lesson_content").upsert(content, { onConflict: "lesson_id" }));
      if (moduleChanged) moved.current = true;
      const f: Form = { ...form, title: lessonRow.title, summary: lessonRow.summary, video_url: videoUrl || "", quiz: content.quiz, attachments: content.attachments };
      setForm(f); setSaved(f);
      if (videoMode === "none") setVideoMode("link");
      toast("Lesson saved.");
    } catch (err) { toast(errMsg(err), "bad"); }
    setSaving(false);
  }

  async function remove() {
    try {
      await q(supabase().from("lessons").delete().eq("id", lessonId));
      setSaved(form);
      toast("Lesson deleted.");
      onDeleted();
    } catch (e) { toast(errMsg(e), "bad"); }
  }

  if (loading) return <Loading text="Loading lesson…" />;
  if (loadErr) return <div className="stack"><BackBtn onClick={() => onBack(false)} /><ErrorBox text={loadErr} onRetry={load} /></div>;

  const vi = videoInfo(form.video_url);
  const busyUpload = !!videoUp || !!fileUp;
  const fieldErr = (k: string) => errors[k] ? <span className={s.fieldErr} role="alert">{errors[k]}</span> : null;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className={s.editorTop}>
        <BackBtn onClick={() => onBack(moved.current)} />
        <div className={s.editorTitle}>
          <div className="eyebrow orange">Edit lesson</div>
          <h2 className={s.h2}>{saved.title || "Untitled lesson"}</h2>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            {saved.is_preview && <span className="badge free">Free preview</span>}
            <Link className="btn sm ghost" href={routes.lesson(lessonId)}><ExternalLink aria-hidden="true" />View as student</Link>
          </div>
        </div>
      </div>

      <form className="stack" style={{ gap: 18 }} onSubmit={(e) => { e.preventDefault(); save(); }}>
        <FormPanel code="Form CS-2 · Lesson" title="Lesson outline">
          <p className="note" style={{ margin: 0 }}>The outline (title, length, summary) is public so the course page can list it. The video, notes, files and quiz below are protected.</p>
          <Step n={1}>Basics</Step>
          <label className="field"><span>Lesson title <span className="req">*</span></span>
            <input value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={160} placeholder="Mechanic's liens and lien waivers" />
            {fieldErr("title")}
          </label>
          <div className="grid3">
            <label className="field">Type
              <select value={form.kind} onChange={(e) => set("kind", e.target.value as Lesson["kind"])}>
                <option value="video">Video lesson</option>
                <option value="text">Reading</option>
                <option value="quiz">Quiz</option>
              </select>
            </label>
            <label className="field">Length (minutes)
              <input inputMode="numeric" value={form.duration} onChange={(e) => set("duration", e.target.value.replace(/\D/g, ""))} placeholder="12" />
              {fieldErr("duration")}
            </label>
            <label className="field">Module
              <select value={form.module_id} onChange={(e) => set("module_id", e.target.value)}>
                <option value="">No module</option>
                {modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
            </label>
          </div>
          <label className="field">Summary
            <textarea rows={3} value={form.summary} onChange={(e) => set("summary", e.target.value)} placeholder="One or two sentences on what this lesson covers." />
            <span className="hint">Shown in the course outline. The AI also reads it when writing a quiz.</span>
          </label>
          <Toggle checked={form.is_preview} onChange={(v) => set("is_preview", v)} label="Free preview"
            hint="Anyone with a free account can open this lesson, even if they haven't bought the course. Great for the first lesson." />
        </FormPanel>

        <FormPanel code="Form CS-3 · Protected content" title="Video, notes & files" aside={<span className="badge"><Lock aria-hidden="true" size={11} />Students only</span>}>
          <Step n={2}>Video</Step>
          <div className="seg" role="group" aria-label="Video source">
            <button type="button" aria-pressed={videoMode === "link"} onClick={() => { setVideoMode("link"); if (form.video_url.startsWith("storage:")) set("video_url", ""); setPreview(null); }}>Paste a link</button>
            <button type="button" aria-pressed={videoMode === "upload"} onClick={() => { setVideoMode("upload"); if (form.video_url && !form.video_url.startsWith("storage:")) set("video_url", ""); setPreview(null); }}>Upload a file</button>
            <button type="button" aria-pressed={videoMode === "none"} onClick={() => { setVideoMode("none"); set("video_url", ""); setPreview(null); }}>No video</button>
          </div>

          {videoMode === "link" && (
            <label className="field">Video link
              <input type="url" value={form.video_url} onChange={(e) => { set("video_url", e.target.value); setPreview(null); }}
                placeholder="https://vimeo.com/123456789 or https://youtu.be/…" />
              {vi && <span className={`hint ${vi.ok ? "ok-text" : "err"}`}>{vi.label}</span>}
              <span className="hint">For paid lessons, use a private Vimeo video (with embedding limited to your site) or upload the file, so the link can&rsquo;t be shared.</span>
              {fieldErr("video_url")}
            </label>
          )}

          {videoMode === "upload" && (
            <div className="stack" style={{ gap: 10 }}>
              <input ref={videoInput} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.mov,.m4v,.webm" hidden
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) startVideo(f); }} />
              {videoUp ? (
                <UploadProgress pct={videoUp.pct} name={videoUp.name} onCancel={() => videoUp.job.abort()} />
              ) : form.video_url.startsWith("storage:") ? (
                <div className={s.fileCard}>
                  <Film aria-hidden="true" />
                  <span className={s.fileCardText}><b>{storageFileName(form.video_url)}</b><small>Private video in your course storage</small></span>
                  <button type="button" className="btn sm" onClick={() => videoInput.current?.click()}><Upload aria-hidden="true" />Replace</button>
                  <button type="button" className="btn sm ghost" onClick={() => { set("video_url", ""); setPreview(null); }}><X aria-hidden="true" />Remove</button>
                </div>
              ) : (
                <button type="button" className={s.dropBtn} onClick={() => videoInput.current?.click()}>
                  <Upload aria-hidden="true" />
                  <b>Choose a video file</b>
                  <small>MP4 plays on every phone. Your Supabase plan sets the largest file you can upload (50 MB on the free plan).</small>
                </button>
              )}
            </div>
          )}

          {videoMode !== "none" && vi?.ok && !videoUp && (
            <div className="stack" style={{ gap: 10 }}>
              {!preview ? (
                <div><button type="button" className="btn sm" onClick={showPreview}><Play aria-hidden="true" />Preview video</button></div>
              ) : (
                <div className={s.videoBox}>
                  {vi.embed ? (
                    <iframe src={preview} title="Video preview" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />
                  ) : (
                    <video src={preview} controls playsInline preload="metadata" />
                  )}
                </div>
              )}
            </div>
          )}

          <Step n={3}>Lesson notes</Step>
          <MarkdownEditor label="Notes students read with the lesson" value={form.body_md} onChange={(v) => set("body_md", v)} />

          <Step n={4}>Attachments</Step>
          <div className="stack" style={{ gap: 8 }}>
            {!form.attachments.length && !fileUp && <p className="note" style={{ margin: 0 }}>No files yet. Attach worksheets, PDFs or code tables students can download.</p>}
            {form.attachments.map((a, i) => {
              const isFile = a.url.startsWith("storage:");
              return (
                <div key={i} className={s.attRow}>
                  {isFile ? <Paperclip aria-hidden="true" /> : <Link2 aria-hidden="true" />}
                  <input className="input" value={a.name} placeholder="File name students see" aria-label={`Attachment ${i + 1} name`}
                    onChange={(e) => set("attachments", form.attachments.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                  {isFile ? (
                    <span className={s.attMeta} title={storageFileName(a.url)}><Lock aria-hidden="true" />{storageFileName(a.url)}</span>
                  ) : (
                    <input className="input" type="url" value={a.url} placeholder="https://…" aria-label={`Attachment ${i + 1} link`}
                      onChange={(e) => set("attachments", form.attachments.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)))} />
                  )}
                  <button type="button" className={s.iconBtn} aria-label={`Remove attachment ${i + 1}`} title="Remove"
                    onClick={() => set("attachments", form.attachments.filter((_, k) => k !== i))}><Trash2 /></button>
                </div>
              );
            })}
            {fileUp && <UploadProgress pct={fileUp.pct} name={fileUp.name} onCancel={() => fileUp.job.abort()} />}
            <input ref={fileInput} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) startFile(f); }} />
            <div className="row">
              <button type="button" className="btn sm" onClick={() => fileInput.current?.click()} disabled={!!fileUp}><Upload aria-hidden="true" />Upload a file</button>
              <button type="button" className="btn sm ghost" onClick={() => set("attachments", [...form.attachments, { name: "", url: "" }])}><Plus aria-hidden="true" />Add a link</button>
            </div>
            {fieldErr("attachments")}
          </div>
        </FormPanel>

        <FormPanel code="Form CS-4 · Quiz" title={`Lesson quiz${form.quiz.length ? ` (${form.quiz.length})` : ""}`}>
          <p className="note" style={{ margin: 0 }}>Optional. A few questions at the end of the lesson help students check what they learned.</p>
          <div className={s.aiBox}>
            <Sparkles aria-hidden="true" />
            <div style={{ flex: 1, minWidth: 200 }}>
              <b>Write a quiz with AI</b>
              <p className="note" style={{ margin: "2px 0 0" }}>
                {dirty ? "Save the lesson first so the AI reads your latest summary and notes." : "The AI reads this lesson's summary and notes and adds questions below for you to review."}
              </p>
            </div>
            <button type="button" className="btn primary" onClick={aiQuiz} disabled={aiBusy || dirty || saving}>
              {aiBusy ? <><span className={`spin ${s.spinSm}`} aria-hidden="true" />Writing… (up to a minute)</> : <><Sparkles aria-hidden="true" />Write quiz</>}
            </button>
          </div>

          {form.quiz.map((item, i) => (
            <div key={i} className={s.qCard}>
              <div className={s.qHead}>
                <span className={s.qNum}>Q{i + 1}</span>
                <span className={s.qHeadActions}>
                  <MoveButtons what="question" onUp={() => moveQuiz(i, -1)} onDown={() => moveQuiz(i, 1)} upDisabled={i === 0} downDisabled={i === form.quiz.length - 1} />
                  <button type="button" className={s.iconBtn} aria-label={`Delete question ${i + 1}`} title="Delete question"
                    onClick={() => set("quiz", form.quiz.filter((_, k) => k !== i))}><Trash2 /></button>
                </span>
              </div>
              <label className="field">Question
                <textarea rows={2} value={item.q} onChange={(e) => setQuiz(i, { q: e.target.value })} placeholder="When does a conditional lien waiver take effect?" />
              </label>
              <ChoiceRows choices={item.c} answer={item.a} onChoices={(c) => setQuiz(i, { c })} onAnswer={(a) => setQuiz(i, { a })} />
              <label className="field"><span>Explanation <span className="hint" style={{ display: "inline" }}>(shown after they answer)</span></span>
                <textarea rows={2} value={item.why} onChange={(e) => setQuiz(i, { why: e.target.value })} placeholder="Why the right answer is right." />
              </label>
            </div>
          ))}
          {fieldErr("quiz")}
          <div><button type="button" className="btn sm" onClick={() => set("quiz", [...form.quiz, { q: "", c: ["", "", "", ""], a: 0, why: "" }])}><Plus aria-hidden="true" />Add a question</button></div>

          <button type="submit" className="btn navy cta block" disabled={saving || busyUpload || !dirty}>
            {saving ? "Saving…" : busyUpload ? "Wait for the upload to finish" : dirty ? "Save lesson" : "All changes saved"}
          </button>
        </FormPanel>
      </form>

      <section className={`card ${s.danger}`}>
        <h3>Delete this lesson</h3>
        <p className="note" style={{ margin: "4px 0 10px" }}>Removes the lesson, its notes, quiz and students&rsquo; progress on it.</p>
        <ConfirmButton onConfirm={remove} confirmLabel="Yes, delete lesson" busyLabel="Deleting…" message={<>Delete “{saved.title}”? This can&rsquo;t be undone.</>}>
          Delete lesson
        </ConfirmButton>
      </section>

      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => { setForm(saved); setErrors({}); setPreview(null); setVideoMode(saved.video_url.startsWith("storage:") ? "upload" : "link"); }}
        label="Save lesson" disabledReason={busyUpload ? "Uploading… wait for it to finish before saving" : undefined} />
    </div>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return <button type="button" className={`btn sm ghost ${s.back}`} onClick={onClick}><ArrowLeft aria-hidden="true" />Back to lessons</button>;
}
