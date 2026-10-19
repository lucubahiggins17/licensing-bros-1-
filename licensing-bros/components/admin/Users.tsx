"use client";
// Students: search accounts, see devices and home areas, grant/revoke courses, reset devices, manage admins.
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, GraduationCap, LogOut, MapPin, MonitorSmartphone, Search, Shield, ShieldOff, Users as UsersIcon, Gauge } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { TRADE_LABELS } from "@/lib/types";
import { errMsg, fmtDate, num, q, relTime } from "./format";
import { useAdmin, useMounted, ConfirmButton, Drawer, Empty, ErrorBox, Loading, SectionHead } from "./ui";
import s from "./admin.module.css";

export type AdminUser = {
  id: string; email: string; full_name: string | null; state: string | null; trade: string | null; created_at: string;
  last_sign_in_at: string | null; is_admin: boolean; enrolled_count: number; paid: boolean; device: string | null;
  device_city: string | null; last_seen: string | null; home_city: string | null; home_region: string | null;
};
const PAGE = 25;
const place = (city?: string | null, region?: string | null) => [city, region].filter(Boolean).join(", ");

export default function UsersSection() {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AdminUser[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<AdminUser | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setTerm(search.trim()); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const data = ((await q(supabase().rpc("admin_list_users", { p_search: term, p_limit: PAGE + 1, p_offset: page * PAGE }))) as AdminUser[]) || [];
      setHasMore(data.length > PAGE);
      setRows(data.slice(0, PAGE));
    } catch (e) { setErr(errMsg(e, "Couldn't load students.")); }
    setLoading(false);
  }, [term, page]);
  useEffect(() => { load(); }, [load]);

  const closeDrawer = useCallback(() => setOpen(null), []);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <SectionHead eyebrow="Students" title="Students &" accent="accounts"
        sub="Find anyone by name or email. Open a student to give them a course, sign out their device or reset their home area." />

      <label className={s.searchBox}>
        <Search aria-hidden="true" />
        <input className="input" type="search" placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search students" />
        {loading && rows && <span className={`spin ${s.spinSm}`} aria-label="Searching" />}
      </label>

      {err ? <ErrorBox text={err} onRetry={load} /> : !rows ? <Loading text="Loading students…" /> : !rows.length ? (
        <div className="card">
          <Empty icon={UsersIcon} title={term ? `No one matches “${term}”` : "No students yet"}>
            {term ? "Check the spelling, or search part of the email." : "When people sign up, they show up here."}
          </Empty>
        </div>
      ) : (
        <>
          <div className={s.tableWrap}>
            <table className={`${s.table} ${loading ? s.dim : ""}`}>
              <thead>
                <tr><th>Student</th><th>Plan</th><th>State &amp; trade</th><th>Joined</th><th>Last seen</th><th>Home area</th><th><span className={s.srOnly}>Actions</span></th></tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td data-label="Student">
                      <button type="button" className={s.linkBtn} onClick={() => setOpen(u)}>{u.full_name || u.email.split("@")[0]}</button>
                      <small className={s.cellSub}>{u.email}</small>
                    </td>
                    <td data-label="Plan">
                      <span className="row" style={{ gap: 4 }}>
                        {u.is_admin && <span className="badge ai">Admin</span>}
                        {u.paid && !u.is_admin ? <span className="badge paid">Paid</span> : !u.is_admin && <span className="badge free">Free</span>}
                      </span>
                      <small className={s.cellSub}>{u.enrolled_count ? `${num(u.enrolled_count)} course${u.enrolled_count === 1 ? "" : "s"}` : "No courses"}</small>
                    </td>
                    <td data-label="State & trade">{u.state || "—"}<small className={s.cellSub}>{TRADE_LABELS[u.trade as keyof typeof TRADE_LABELS] || "—"}</small></td>
                    <td data-label="Joined">{fmtDate(u.created_at)}</td>
                    <td data-label="Last seen">
                      {relTime(u.last_seen || u.last_sign_in_at)}
                      <small className={s.cellSub}>{[u.device, u.device_city].filter(Boolean).join(" · ") || "No active device"}</small>
                    </td>
                    <td data-label="Home area">{place(u.home_city, u.home_region) || <span className="note">Not set yet</span>}</td>
                    <td data-label=""><button type="button" className="btn sm" onClick={() => setOpen(u)}>Manage</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row between">
            <span className="note">Page {page + 1}{rows.length ? ` · showing ${page * PAGE + 1}–${page * PAGE + rows.length}` : ""}</span>
            <span className="row" style={{ gap: 8 }}>
              <button type="button" className="btn sm" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronLeft aria-hidden="true" />Previous</button>
              <button type="button" className="btn sm" disabled={!hasMore || loading} onClick={() => setPage((p) => p + 1)}>Next<ChevronRight aria-hidden="true" /></button>
            </span>
          </div>
        </>
      )}

      <Drawer open={!!open} onClose={closeDrawer} eyebrow="Student" title={open ? open.full_name || open.email : ""}>
        {open && <UserPanel key={open.id} user={open} onChanged={load} />}
      </Drawer>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
type Enr = { course_id: string; source: string; created_at: string; title: string };
type CourseOpt = { id: string; title: string; published: boolean };
type TopicRow = { trade: string; topic: string; c: number; a: number; pct: number };

function summarize(data: any) {
  const stats = data?.stats && typeof data.stats === "object" ? data.stats : {};
  const topics: TopicRow[] = [];
  let c = 0, a = 0;
  for (const [tr, m] of Object.entries<any>(stats)) {
    if (!m || typeof m !== "object") continue;
    for (const [topic, v] of Object.entries<any>(m)) {
      const vc = Number(v?.c) || 0, va = Number(v?.a) || 0;
      if (!va) continue;
      c += vc; a += va;
      topics.push({ trade: tr, topic, c: vc, a: va, pct: Math.round((100 * vc) / va) });
    }
  }
  const weakest = topics.filter((t) => t.a >= 3).sort((x, y) => x.pct - y.pct || y.a - x.a).slice(0, 5);
  const hist = Array.isArray(data?.hist) ? data.hist : [];
  return { accuracy: a ? Math.round((100 * c) / a) : null, answered: a, topicCount: topics.length, weakest, examDate: data?.examDate || null, last: hist[0] || null };
}

function UserPanel({ user, onChanged }: { user: AdminUser; onChanged: () => void }) {
  const { toast, userId } = useAdmin();
  const mounted = useMounted();
  const [enr, setEnr] = useState<Enr[] | null>(null);
  const [courses, setCourses] = useState<CourseOpt[]>([]);
  const [progress, setProgress] = useState<any>(undefined);
  const [err, setErr] = useState("");
  const [grant, setGrant] = useState("");
  const [granting, setGranting] = useState(false);
  const [isAdmin, setIsAdmin] = useState(user.is_admin);
  const [dev, setDev] = useState({ device: user.device, city: user.device_city, last_seen: user.last_seen, home: place(user.home_city, user.home_region) });

  const load = useCallback(async () => {
    setErr("");
    const sb = supabase();
    try {
      const [e, c, p] = await Promise.all([
        q(sb.from("enrollments").select("course_id,source,created_at,courses(title)").eq("user_id", user.id).order("created_at", { ascending: false })),
        q(sb.from("courses").select("id,title,published").order("title", { ascending: true })),
        q(sb.from("progress").select("data").eq("user_id", user.id).maybeSingle())
      ]);
      if (!mounted.current) return;
      setEnr(((e as any[]) || []).map((r) => {
        const co = Array.isArray(r.courses) ? r.courses[0] : r.courses;
        return { course_id: r.course_id, source: r.source, created_at: r.created_at, title: co?.title || "Deleted course" };
      }));
      setCourses((c as CourseOpt[]) || []);
      setProgress((p as any)?.data ?? null);
    } catch (x) { if (mounted.current) setErr(errMsg(x, "Couldn't load this student's details.")); }
  }, [user.id, mounted]);
  useEffect(() => { load(); }, [load]);

  async function rpc(name: string, args: Record<string, any>, ok: string) {
    try {
      await q(supabase().rpc(name, args));
      toast(ok);
      onChanged();
      return true;
    } catch (e) { toast(errMsg(e), "bad"); return false; }
  }

  async function grantCourse() {
    if (!grant) return;
    setGranting(true);
    const title = courses.find((c) => c.id === grant)?.title || "the course";
    if (await rpc("admin_grant_course", { p_user: user.id, p_course: grant }, `Gave ${user.full_name || "them"} “${title}”. They got a notification.`)) {
      setGrant("");
      await load();
    }
    setGranting(false);
  }

  const owned = new Set((enr || []).map((e) => e.course_id));
  const grantable = courses.filter((c) => !owned.has(c.id));
  const sum = progress ? summarize(progress) : null;
  const daysToExam = sum?.examDate ? Math.ceil((new Date(sum.examDate + "T09:00").getTime() - Date.now()) / 864e5) : null;
  const sourceLabel = (src: string) => (src === "stripe" ? "Bought" : src === "admin" ? "Given by admin" : "Free");

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className={s.userHead}>
        <span className="avatar" style={{ width: 44, height: 44, fontSize: 18 }}>{(user.full_name || user.email).charAt(0).toUpperCase()}</span>
        <div style={{ minWidth: 0 }}>
          <div className={s.wrapText}><b>{user.email}</b></div>
          <div className="row" style={{ gap: 4, marginTop: 4 }}>
            {isAdmin && <span className="badge ai">Admin</span>}
            {user.paid ? <span className="badge paid">Paid access</span> : <span className="badge free">Free account</span>}
            <span className="badge">Joined {fmtDate(user.created_at)}</span>
          </div>
          <div className="note" style={{ marginTop: 4 }}>{user.state || "—"} · {TRADE_LABELS[user.trade as keyof typeof TRADE_LABELS] || "—"}</div>
        </div>
      </div>

      {err && <ErrorBox text={err} onRetry={load} />}

      {/* Courses */}
      <section className={s.panel}>
        <h3 className={s.panelTitle}><GraduationCap aria-hidden="true" />Courses</h3>
        {!enr ? <Loading /> : !enr.length ? <p className="note" style={{ margin: 0 }}>No courses yet.</p> : (
          <ul className={s.rows}>
            {enr.map((e) => (
              <li key={e.course_id} className={s.rowItem}>
                <div className={s.rowMain}><b>{e.title}</b><span className="note">{sourceLabel(e.source)} · {fmtDate(e.created_at)}</span></div>
                <div className={s.rowEnd}>
                  <ConfirmButton onConfirm={async () => { if (await rpc("admin_revoke_course", { p_user: user.id, p_course: e.course_id }, "Access removed.")) await load(); }}
                    confirmLabel="Yes, remove" busyLabel="Removing…"
                    message={e.source === "stripe" ? "They paid for this. Removing access doesn't refund them (refund in Stripe)." : "Remove their access?"}>
                    Revoke
                  </ConfirmButton>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className={s.grantRow}>
          <select className="input" value={grant} onChange={(e) => setGrant(e.target.value)} aria-label="Course to give">
            <option value="">{grantable.length ? "Pick a course to give…" : "They have every course"}</option>
            {grantable.map((c) => <option key={c.id} value={c.id}>{c.title}{c.published ? "" : " (draft)"}</option>)}
          </select>
          <button type="button" className="btn primary" disabled={!grant || granting} onClick={grantCourse}>{granting ? "Giving…" : "Give course"}</button>
        </div>
        <p className="note" style={{ margin: 0 }}>Giving a course is free for them (for comps, partners or fixing a payment problem).</p>
      </section>

      {/* Device & location */}
      <section className={s.panel}>
        <h3 className={s.panelTitle}><MonitorSmartphone aria-hidden="true" />Device &amp; home area</h3>
        <dl className={s.dl}>
          <dt>Device</dt><dd>{dev.device || "None signed in right now"}</dd>
          <dt>Last seen</dt><dd>{dev.last_seen ? `${relTime(dev.last_seen)}${dev.city ? ` in ${dev.city}` : ""}` : "—"}</dd>
          <dt>Home area</dt><dd>{dev.home || "Not set yet (set by their first paid lesson)"}</dd>
        </dl>
        <div className="stack" style={{ gap: 10 }}>
          <div className={s.actionRow}>
            <div><b>Sign out their device</b><p className="note" style={{ margin: 0 }}>Use when they&rsquo;re stuck with &ldquo;account in use&rdquo; on a device they no longer have.</p></div>
            <ConfirmButton className="btn sm" confirmLabel="Yes, sign out" busyLabel="Signing out…" message="They'll sign in again next time."
              onConfirm={async () => { if (await rpc("admin_reset_device", { p_user: user.id, p_reset_home: false }, "Their device was signed out.")) setDev((d) => ({ ...d, device: null, city: null, last_seen: null })); }}>
              <LogOut aria-hidden="true" />Sign out device
            </ConfirmButton>
          </div>
          <div className={s.actionRow}>
            <div><b>Reset device and home location</b><p className="note" style={{ margin: 0 }}>Use when they moved or are blocked as &ldquo;outside home area&rdquo;. Their next device sets a new home area automatically.</p></div>
            <ConfirmButton className="btn sm" confirmLabel="Yes, reset both" busyLabel="Resetting…" message="Signs them out and clears their home area."
              onConfirm={async () => { if (await rpc("admin_reset_device", { p_user: user.id, p_reset_home: true }, "Device signed out and home area cleared.")) setDev({ device: null, city: null, last_seen: null, home: "" }); }}>
              <MapPin aria-hidden="true" />Reset both
            </ConfirmButton>
          </div>
        </div>
      </section>

      {/* Readiness */}
      <section className={s.panel}>
        <h3 className={s.panelTitle}><Gauge aria-hidden="true" />Exam readiness</h3>
        {progress === undefined ? <Loading /> : !sum || !sum.answered ? (
          <p className="note" style={{ margin: 0 }}>No practice answers yet. Their readiness shows up after they take practice exams or play the study games.</p>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            <div className="stat">
              <div><b>{sum.accuracy}%</b><span>Correct overall</span></div>
              <div><b>{num(sum.answered)}</b><span>Questions answered</span></div>
              <div><b>{sum.topicCount}</b><span>Topics practiced</span></div>
              {daysToExam !== null && <div><b>{daysToExam > 0 ? daysToExam : daysToExam === 0 ? "Today" : "Past"}</b><span>{daysToExam > 0 ? "Days to exam" : "Exam date"}</span></div>}
            </div>
            {sum.weakest.length > 0 && (
              <div className="stack" style={{ gap: 8 }}>
                <span className="label">Weakest topics</span>
                {sum.weakest.map((t) => (
                  <div key={t.trade + t.topic} className="tbar">
                    <span className={s.topicName}>{t.topic}<small>{t.c}/{t.a} right</small></span>
                    <div className={`bar ${t.pct < 60 ? "low" : t.pct < 75 ? "mid" : "ok"}`} role="img" aria-label={`${t.pct}% correct`}><i style={{ width: `${t.pct}%` }} /></div>
                    <em>{t.pct}%</em>
                  </div>
                ))}
              </div>
            )}
            {sum.last && <p className="note" style={{ margin: 0 }}>Last activity: {String(sum.last.kind || "Study")}{sum.last.detail ? ` (${sum.last.detail})` : ""}{sum.last.at ? `, ${relTime(new Date(sum.last.at).toISOString())}` : ""}.</p>}
          </div>
        )}
      </section>

      {/* Admin */}
      <section className={s.panel}>
        <h3 className={s.panelTitle}><Shield aria-hidden="true" />Admin access</h3>
        {isAdmin ? (
          user.id === userId ? (
            <p className="note" style={{ margin: 0 }}>This is you. Another admin has to remove your admin access.</p>
          ) : (
            <div className={s.actionRow}>
              <div><b>This person is an admin</b><p className="note" style={{ margin: 0 }}>They can change everything here, including prices and other admins.</p></div>
              <ConfirmButton className="btn sm danger" confirmLabel="Yes, remove admin" busyLabel="Removing…" message="They'll lose access to this control center."
                onConfirm={async () => { if (await rpc("admin_set_admin", { p_user: user.id, p_admin: false }, "Admin access removed.")) setIsAdmin(false); }}>
                <ShieldOff aria-hidden="true" />Remove admin
              </ConfirmButton>
            </div>
          )
        ) : (
          <div className={s.actionRow}>
            <div><b>Make this person an admin</b><p className="note" style={{ margin: 0 }}>Only for people on your team. Admins can change everything here and see every student.</p></div>
            <ConfirmButton className="btn sm" confirmLabel="Yes, make admin" busyLabel="Saving…" message={`Give ${user.email} full admin access?`}
              onConfirm={async () => { if (await rpc("admin_set_admin", { p_user: user.id, p_admin: true }, "They're an admin now.")) setIsAdmin(true); }}>
              <Shield aria-hidden="true" />Make admin
            </ConfirmButton>
          </div>
        )}
      </section>
    </div>
  );
}
