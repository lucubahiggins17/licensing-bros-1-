"use client";
// Studio: push calls to action to students (course offer, link, poll, message) and manage what's on screen.
import { useEffect, useMemo, useState } from "react";
import { GraduationCap, Link2, BarChart3, Megaphone, Plus, X, Send } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { money, type Course, type LiveCta } from "@/lib/types";
import { useLiveCtas, usePollResults } from "@/components/live/useLiveData";
import { PollBars } from "@/components/live/LiveBits";
import { isHttpUrl, timeAgo } from "@/components/live/liveUtils";
import st from "./Studio.module.css";

type Kind = LiveCta["kind"];
type CourseLite = Pick<Course, "id" | "title" | "price_cents" | "is_free" | "published">;

const KINDS: { k: Kind; label: string; Icon: any }[] = [
  { k: "course", label: "Course offer", Icon: GraduationCap },
  { k: "link", label: "Link", Icon: Link2 },
  { k: "poll", label: "Poll", Icon: BarChart3 },
  { k: "message", label: "Message", Icon: Megaphone }
];
const KIND_NAME: Record<Kind, string> = { course: "Course offer", link: "Link", poll: "Poll", message: "Message" };

export default function CtaConsole({ liveId }: { liveId: string }) {
  const { ctas, upsert } = useLiveCtas(liveId, true, false);
  const [kind, setKind] = useState<Kind>("course");
  const [courses, setCourses] = useState<CourseLite[] | null>(null);
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  // form fields
  const [courseId, setCourseId] = useState("");
  const [promo, setPromo] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    supabase().from("courses").select("id,title,price_cents,is_free,published").order("sort").order("title")
      .then(({ data }) => setCourses((data as CourseLite[]) || []));
  }, []);

  useEffect(() => { if (!ok) return; const t = setTimeout(() => setOk(""), 3000); return () => clearTimeout(t); }, [ok]);

  const course = courses?.find((c) => c.id === courseId) || null;
  const onScreenId = useMemo(() => ctas.find((c) => c.active)?.id || null, [ctas]);

  function switchKind(k: Kind) { setKind(k); setErr(""); setTitle(""); setBody(""); setLabel(""); }

  function validate(): string | null {
    if (kind === "course") {
      if (!courseId) return "Pick a course to offer.";
    }
    if (kind === "link") {
      if (!title.trim()) return "Give the link a title.";
      if (!isHttpUrl(url)) return "Enter a full web address that starts with https://";
    }
    if (kind === "poll") {
      if (!question.trim()) return "Write the poll question.";
      if (options.map((o) => o.trim()).filter(Boolean).length < 2) return "A poll needs at least 2 answers.";
    }
    if (kind === "message" && !message.trim()) return "Write the message.";
    return null;
  }

  async function deactivateOthers(exceptId?: string) {
    let q = supabase().from("live_ctas").update({ active: false }).eq("live_id", liveId).eq("active", true);
    if (exceptId) q = q.neq("id", exceptId);
    const { error } = await q;
    if (error) throw error;
    ctas.filter((c) => c.active && c.id !== exceptId).forEach((c) => upsert({ ...c, active: false }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate();
    if (v) { setErr(v); return; }
    setBusy(true); setErr("");
    const row: Partial<LiveCta> & { live_id: string; kind: Kind } = { live_id: liveId, kind, active: true };
    if (kind === "course") {
      Object.assign(row, { title: title.trim() || course?.title || "Course offer", body: body.trim(), button_label: label.trim() || "Get it now", course_id: courseId, promo_code: promo.trim() || null });
    } else if (kind === "link") {
      Object.assign(row, { title: title.trim(), body: body.trim(), url: url.trim(), button_label: label.trim() || "Open link" });
    } else if (kind === "poll") {
      Object.assign(row, { title: question.trim(), options: options.map((o) => o.trim()).filter(Boolean).slice(0, 5) });
    } else {
      Object.assign(row, { title: message.trim(), body: "" });
    }
    try {
      if (replace) await deactivateOthers();
      const { data, error } = await supabase().from("live_ctas").insert(row).select().single();
      if (error) throw error;
      if (data) upsert({ ...(data as LiveCta), options: Array.isArray((data as any).options) ? (data as any).options : [] });
      setOk("Sent. Students see it now.");
      // reset what's specific to this push
      setTitle(""); setBody(""); setUrl(""); setLabel(""); setQuestion(""); setOptions(["", ""]); setMessage(""); setPromo("");
    } catch (e: any) {
      setErr(navigator.onLine === false ? "You're offline. Nothing was sent." : `Couldn't send it. ${e?.message || ""}`.trim());
    }
    setBusy(false);
  }

  async function toggle(c: LiveCta) {
    setErr("");
    const next = !c.active;
    upsert({ ...c, active: next });
    try {
      if (next && replace) await deactivateOthers(c.id);
      const { error } = await supabase().from("live_ctas").update({ active: next }).eq("id", c.id);
      if (error) throw error;
    } catch {
      upsert({ ...c, active: c.active });
      setErr("Couldn't change that. Try again.");
    }
  }

  return (
    <section className={st.console} aria-labelledby="cta-title">
      <form className="formcs" onSubmit={submit} noValidate>
        <div className="hazard" />
        <div className="formhead">
          <b id="cta-title">Calls to action</b>
          <p className="note" style={{ margin: "2px 0 0" }}>Push an offer, link, poll or message onto every student&rsquo;s screen.</p>
        </div>
        <div className="formbody">
          <div className={st.kindSeg} role="group" aria-label="What to send">
            {KINDS.map(({ k, label: l, Icon }) => (
              <button key={k} type="button" aria-pressed={kind === k} className={st.kindBtn} onClick={() => switchKind(k)}>
                <Icon aria-hidden="true" /> {l}
              </button>
            ))}
          </div>

          {kind === "course" && (
            <>
              <label className="field">
                <span><span className="stepnum">1</span>Course</span>
                <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                  <option value="">{courses === null ? "Loading courses…" : courses.length ? "Pick a course" : "No courses yet"}</option>
                  {(courses || []).map((c) => (
                    <option key={c.id} value={c.id}>{c.title} · {c.is_free ? "Free" : money(c.price_cents)}{c.published ? "" : " (draft)"}</option>
                  ))}
                </select>
                {course && !course.published && <span className="hint" style={{ color: "var(--warn)" }}>This course is a draft. Students can&rsquo;t buy it until it&rsquo;s published.</span>}
                {course && course.published && (course.is_free || course.price_cents <= 0) && <span className="hint">Free course: students get a &ldquo;Start free&rdquo; button instead of checkout.</span>}
              </label>
              <label className="field">
                <span><span className="stepnum">2</span>Promo code <span className="hint">(optional)</span></span>
                <input value={promo} onChange={(e) => setPromo(e.target.value.replace(/\s/g, ""))} placeholder="e.g. LIVE20" maxLength={40} autoCapitalize="characters" />
                <span className="hint">Create the code in Stripe first. Students see &ldquo;Use code {promo || "X"} at checkout&rdquo;.</span>
              </label>
              <div className={st.two}>
                <label className="field">
                  <span><span className="stepnum">3</span>Headline <span className="hint">(optional)</span></span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={course?.title || "Defaults to the course title"} maxLength={90} />
                </label>
                <label className="field">
                  <span>Button <span className="hint">(optional)</span></span>
                  <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Get it now" maxLength={30} />
                </label>
              </div>
              <label className="field">
                <span>Short pitch <span className="hint">(optional)</span></span>
                <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Tonight only: 20% off the full course." maxLength={160} />
              </label>
            </>
          )}

          {kind === "link" && (
            <>
              <label className="field">
                <span><span className="stepnum">1</span>Title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Download tonight's cheat sheet" maxLength={90} />
              </label>
              <label className="field">
                <span><span className="stepnum">2</span>Web address</span>
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" inputMode="url" type="url" />
              </label>
              <div className={st.two}>
                <label className="field">
                  <span><span className="stepnum">3</span>Button</span>
                  <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Open link" maxLength={30} />
                </label>
                <label className="field">
                  <span>Note <span className="hint">(optional)</span></span>
                  <input value={body} onChange={(e) => setBody(e.target.value)} maxLength={160} />
                </label>
              </div>
            </>
          )}

          {kind === "poll" && (
            <>
              <label className="field">
                <span><span className="stepnum">1</span>Question</span>
                <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Which topic should we cover next?" maxLength={140} />
              </label>
              <div className={st.optsField} role="group" aria-labelledby={`poll-opts-${liveId}`}>
                <span id={`poll-opts-${liveId}`} className={st.groupLabel}><span className="stepnum">2</span>Answers (2 to 5)</span>
                {options.map((o, i) => (
                  <div key={i} className={st.optRow}>
                    <span className={st.optLetter} aria-hidden="true">{String.fromCharCode(65 + i)}</span>
                    <input className="input" value={o} onChange={(e) => setOptions((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Answer ${i + 1}`} maxLength={80} aria-label={`Answer ${i + 1}`} />
                    {options.length > 2 && (
                      <button type="button" className={st.optDel} onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))} aria-label={`Remove answer ${i + 1}`}><X size={16} aria-hidden="true" /></button>
                    )}
                  </div>
                ))}
                {options.length < 5 && (
                  <button type="button" className="btn sm" onClick={() => setOptions((prev) => [...prev, ""])} style={{ alignSelf: "flex-start" }}><Plus aria-hidden="true" /> Add answer</button>
                )}
              </div>
            </>
          )}

          {kind === "message" && (
            <label className="field">
              <span><span className="stepnum">1</span>Message</span>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="5-minute break. Back at 8:05!" maxLength={300} style={{ minHeight: 80 }} />
            </label>
          )}

          <label className={st.check}>
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            <span>Replace current <span className="hint">(hide whatever is on screen now)</span></span>
          </label>

          {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
          {ok && <p className="ok-text" role="status" style={{ margin: 0, fontWeight: 700 }}>{ok}</p>}
          <button type="submit" className="btn navy cta block" disabled={busy}><Send aria-hidden="true" /> {busy ? "Sending…" : "Send to students"}</button>
        </div>
      </form>

      <div className={st.ctaList}>
        <h3 className={st.listTitle}>Sent this class</h3>
        {ctas.length === 0 ? (
          <p className="empty" style={{ margin: 0 }}>Nothing sent yet.</p>
        ) : (
          <ul>
            {ctas.map((c) => <CtaRow key={c.id} cta={c} onScreen={c.id === onScreenId} onToggle={() => toggle(c)} />)}
          </ul>
        )}
      </div>
    </section>
  );
}

function CtaRow({ cta, onScreen, onToggle }: { cta: LiveCta; onScreen: boolean; onToggle: () => void }) {
  const Icon = KINDS.find((k) => k.k === cta.kind)?.Icon || Megaphone;
  const { counts } = usePollResults(cta.kind === "poll" ? cta.id : null, cta.options.length, cta.kind === "poll", cta.active ? 3000 : 30000);
  return (
    <li className={`${st.ctaRow}${cta.active ? "" : ` ${st.ctaOff}`}`}>
      <div className={st.ctaRowTop}>
        <span className={st.ctaIcon}><Icon aria-hidden="true" /></span>
        <div className={st.ctaRowText}>
          <b>{cta.title}</b>
          <span>{KIND_NAME[cta.kind]}{cta.promo_code ? ` · code ${cta.promo_code}` : ""} · {timeAgo(cta.created_at)}</span>
        </div>
        {onScreen && <span className="badge live">On screen</span>}
        <button type="button" role="switch" aria-checked={cta.active} className={st.switch} onClick={onToggle} aria-label={`${cta.active ? "Hide" : "Show"} “${cta.title}”`}>
          <span className={st.knob} />
          <span className={st.switchText}>{cta.active ? "Active" : "Off"}</span>
        </button>
      </div>
      {cta.kind === "poll" && cta.options.length > 0 && (
        <div className={st.pollWrap}><PollBars options={cta.options} counts={counts} /></div>
      )}
    </li>
  );
}
