"use client";
// Announcements: send a notification to everyone or one student, and manage what was sent.
import { useCallback, useEffect, useState } from "react";
import { Bell, Megaphone, Search, Send, Trash2, User, Users, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { routes } from "@/lib/nav";
import type { Notification } from "@/lib/types";
import { errMsg, fmtDate, fmtDateTime, q, relTime } from "./format";
import { useAdmin, useDirty, ConfirmButton, Empty, ErrorBox, FormPanel, Loading, SectionHead, Step } from "./ui";
import type { AdminUser } from "./Users";
import s from "./admin.module.css";

type LinkKind = "none" | "course" | "live" | "custom";
type Opt = { id: string; title: string; extra?: string };

export default function Notify() {
  const { toast } = useAdmin();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [linkKind, setLinkKind] = useState<LinkKind>("none");
  const [courseId, setCourseId] = useState("");
  const [liveId, setLiveId] = useState("");
  const [custom, setCustom] = useState("");
  const [audience, setAudience] = useState<"everyone" | "one">("everyone");
  const [who, setWho] = useState<AdminUser | null>(null);
  const [find, setFind] = useState("");
  const [found, setFound] = useState<AdminUser[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [courses, setCourses] = useState<Opt[]>([]);
  const [lives, setLives] = useState<Opt[]>([]);
  const [sent, setSent] = useState<Notification[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [listErr, setListErr] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");

  useDirty("notify", !!(title.trim() || body.trim()));

  const loadSent = useCallback(async () => {
    setListErr("");
    try {
      const rows = ((await q(supabase().from("notifications").select("*").order("created_at", { ascending: false }).limit(50))) as Notification[]) || [];
      setSent(rows);
      const ids = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean))) as string[];
      if (ids.length) {
        try {
          const ps = (await q(supabase().from("profiles").select("id,full_name").in("id", ids))) as any[];
          setNames(Object.fromEntries((ps || []).map((p) => [p.id, p.full_name])));
        } catch { /* optional */ }
      }
    } catch (e) { setListErr(errMsg(e, "Couldn't load sent announcements.")); }
  }, []);

  useEffect(() => {
    loadSent();
    (async () => {
      const sb = supabase();
      const [c, l] = await Promise.allSettled([
        q(sb.from("courses").select("id,title,published").order("title", { ascending: true })),
        q(sb.from("lives").select("id,title,starts_at,status").order("starts_at", { ascending: false }).limit(50))
      ]);
      if (c.status === "fulfilled") setCourses(((c.value as any[]) || []).map((x) => ({ id: x.id, title: x.title, extra: x.published ? "" : " (draft)" })));
      if (l.status === "fulfilled") setLives(((l.value as any[]) || []).map((x) => ({ id: x.id, title: x.title, extra: ` · ${fmtDate(x.starts_at)}${x.status === "ended" ? " (ended)" : ""}` })));
    })();
  }, [loadSent]);

  // Find one student by email or name
  useEffect(() => {
    if (audience !== "one" || who) return;
    const term = find.trim();
    if (term.length < 2) { setFound(null); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try { setFound(((await q(supabase().rpc("admin_list_users", { p_search: term, p_limit: 8, p_offset: 0 }))) as AdminUser[]) || []); }
      catch { setFound([]); }
      setSearching(false);
    }, 350);
    return () => { clearTimeout(t); setSearching(false); };
  }, [find, audience, who]);

  const link = linkKind === "course" ? (courseId ? routes.course(courseId) : null)
    : linkKind === "live" ? (liveId ? routes.watch(liveId) : null)
    : linkKind === "custom" ? custom.trim() || null : null;
  const linkLabel = linkKind === "course" ? courses.find((c) => c.id === courseId)?.title
    : linkKind === "live" ? lives.find((l) => l.id === liveId)?.title
    : linkKind === "custom" ? custom.trim() : "";

  function check(): string {
    if (!title.trim()) return "Write a title.";
    if (title.trim().length > 120) return "Keep the title under 120 characters.";
    if (audience === "one" && !who) return "Pick the student to send it to.";
    if (linkKind === "course" && !courseId) return "Pick the course to link to, or choose No link.";
    if (linkKind === "live" && !liveId) return "Pick the live class to link to, or choose No link.";
    if (linkKind === "custom" && !/^(\/|https?:\/\/)/i.test(custom.trim())) return "Links start with / (a page on this site) or https://";
    return "";
  }

  async function send() {
    const p = check();
    setProblem(p);
    if (p) { toast(p, "bad"); return; }
    setSending(true);
    try {
      const row = (await q(supabase().from("notifications").insert({ user_id: audience === "one" ? who!.id : null, title: title.trim(), body: body.trim(), link }).select().single())) as Notification;
      setSent((x) => [row, ...(x || [])]);
      if (who) setNames((n) => ({ ...n, [who.id]: who.full_name || who.email }));
      toast(audience === "one" ? `Sent to ${who?.full_name || who?.email}.` : "Sent to everyone. They'll see it under the bell.");
      setTitle(""); setBody(""); setLinkKind("none"); setCourseId(""); setLiveId(""); setCustom(""); setProblem("");
    } catch (e) { toast(errMsg(e), "bad"); }
    setSending(false);
  }

  async function remove(n: Notification) {
    try { await q(supabase().from("notifications").delete().eq("id", n.id)); setSent((x) => x?.filter((y) => y.id !== n.id) ?? x); toast("Announcement deleted."); }
    catch (e) { toast(errMsg(e), "bad"); }
  }

  const ready = !check();

  return (
    <div className="stack" style={{ gap: 18 }}>
      <SectionHead eyebrow="Announcements" title="Send an" accent="announcement"
        sub="It shows up under the bell for students. Use it for new courses, live classes and important updates." />

      <div className={s.notifyGrid}>
        <FormPanel code="Form NT-1 · Announcement" title="Write it">
          <Step n={1}>Message</Step>
          <label className="field"><span>Title <span className="req">*</span></span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="New course: Tennessee GC Exam Master Course" />
          </label>
          <label className="field">Message
            <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} placeholder="One or two short sentences. Say what's new and what to do next." />
          </label>

          <Step n={2}>Link (optional)</Step>
          <div className="seg" role="group" aria-label="Link to">
            {(["none", "course", "live", "custom"] as LinkKind[]).map((k) => (
              <button key={k} type="button" aria-pressed={linkKind === k} onClick={() => setLinkKind(k)}>
                {k === "none" ? "No link" : k === "course" ? "A course" : k === "live" ? "A live class" : "Other link"}
              </button>
            ))}
          </div>
          {linkKind === "course" && (
            <label className="field">Course
              <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                <option value="">Pick a course…</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.title}{c.extra}</option>)}
              </select>
            </label>
          )}
          {linkKind === "live" && (
            <label className="field">Live class
              <select value={liveId} onChange={(e) => setLiveId(e.target.value)}>
                <option value="">Pick a class…</option>
                {lives.map((l) => <option key={l.id} value={l.id}>{l.title}{l.extra}</option>)}
              </select>
            </label>
          )}
          {linkKind === "custom" && (
            <label className="field">Link
              <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="/learn/#exam or https://…" />
              <span className="hint">A page on this site (starts with /) or a full https:// link.</span>
            </label>
          )}

          <Step n={3}>Who gets it</Step>
          <div className="seg" role="group" aria-label="Audience">
            <button type="button" aria-pressed={audience === "everyone"} onClick={() => setAudience("everyone")}><Users aria-hidden="true" size={15} /> Everyone</button>
            <button type="button" aria-pressed={audience === "one"} onClick={() => setAudience("one")}><User aria-hidden="true" size={15} /> One student</button>
          </div>
          {audience === "one" && (
            who ? (
              <div className={s.fileCard}>
                <User aria-hidden="true" />
                <span className={s.fileCardText}><b>{who.full_name || who.email}</b><small>{who.email}</small></span>
                <button type="button" className="btn sm ghost" onClick={() => { setWho(null); setFind(""); }}><X aria-hidden="true" />Change</button>
              </div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                <label className={s.searchBox}>
                  <Search aria-hidden="true" />
                  <input className="input" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type their email or name" aria-label="Find a student" />
                  {searching && <span className={`spin ${s.spinSm}`} aria-label="Searching" />}
                </label>
                {found && (found.length ? (
                  <ul className={s.pickList}>
                    {found.map((u) => (
                      <li key={u.id}><button type="button" onClick={() => setWho(u)}><b>{u.full_name || u.email.split("@")[0]}</b><small>{u.email}</small></button></li>
                    ))}
                  </ul>
                ) : <p className="note" style={{ margin: 0 }}>No one matches “{find.trim()}”.</p>)}
              </div>
            )
          )}

          {problem && <p className="err" role="alert" style={{ margin: 0 }}>{problem}</p>}
          {audience === "everyone" ? (
            <ConfirmButton className="btn navy cta block" disabled={!ready || sending} onConfirm={send} confirmLabel="Yes, send to everyone" busyLabel="Sending…"
              message="Every student will see this under the bell.">
              <Send aria-hidden="true" />Send to everyone
            </ConfirmButton>
          ) : (
            <button type="button" className="btn navy cta block" disabled={!ready || sending} onClick={send}><Send aria-hidden="true" />{sending ? "Sending…" : "Send to this student"}</button>
          )}
        </FormPanel>

        <aside className={s.previewCol} aria-label="Preview">
          <span className="label">Preview</span>
          <div className={s.notePreview}>
            <span className={s.noteBell}><Bell aria-hidden="true" /></span>
            <div style={{ minWidth: 0 }}>
              <b>{title.trim() || "Your title"}</b>
              {(body.trim() || !title.trim()) && <p>{body.trim() || "Your message shows here."}</p>}
              {link && <small>Opens: {linkLabel || link}</small>}
              <small className="note">just now</small>
            </div>
          </div>
          <p className="note">To: {audience === "everyone" ? "every student" : who ? who.full_name || who.email : "pick a student"}</p>
        </aside>
      </div>

      <section className="card">
        <div className={s.cardHead}><h3><Megaphone aria-hidden="true" className={s.h3Ico} />Sent</h3><span className="note">Last 50</span></div>
        {listErr ? <ErrorBox text={listErr} onRetry={loadSent} /> : !sent ? <Loading /> : !sent.length ? (
          <Empty title="Nothing sent yet">Your announcements show up here.</Empty>
        ) : (
          <ul className={s.rows}>
            {sent.map((n) => (
              <li key={n.id} className={s.rowItem}>
                <div className={s.rowMain}>
                  <b>{n.title}</b>
                  {n.body && <span className={s.rowBody}>{n.body}</span>}
                  <span className="note">
                    {n.user_id ? `To ${names[n.user_id] || "one student"}` : "To everyone"} · <time dateTime={n.created_at} title={fmtDateTime(n.created_at)}>{relTime(n.created_at)}</time>
                    {n.link ? <> · links to <code className={s.code}>{n.link}</code></> : null}
                  </span>
                </div>
                <div className={s.rowEnd}>
                  <ConfirmButton className={s.iconBtn} title="Delete announcement" onConfirm={() => remove(n)} message="Delete it for everyone?"><Trash2 aria-hidden="true" /></ConfirmButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
