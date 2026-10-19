"use client";
// Dashboard: the numbers that matter, signups, weakest topics, recent payments and upcoming classes.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Users, UserPlus, CreditCard, DollarSign, Banknote, Activity, Bot, Plus, CalendarPlus, Sparkles, Megaphone,
  RefreshCw, Radio, TrendingDown, Receipt, Clapperboard, Gamepad2, ShieldCheck
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { routes } from "@/lib/nav";
import type { Live } from "@/lib/types";
import { errMsg, fmtDateTime, num, q, relTime, usd } from "./format";
import { useAdmin, Empty, ErrorBox, Loading, SectionHead, StatusBadge } from "./ui";
import SignupsChart from "./SignupsChart";
import s from "./admin.module.css";

type Stats = {
  users: number; new_7d: number; paying: number; revenue_cents: number; revenue_30d_cents: number; online_now: number;
  ai_today: number; courses: number; enrollments: number;
  signups_by_day: { day: string; n: number }[];
  weak_topics: { topic: string; answered: number; accuracy: number }[];
};
type PaymentRow = { id: string; amount_cents: number; currency: string; status: "paid" | "refunded"; created_at: string; user_id: string | null; course_id: string | null; courseTitle: string | null; name: string | null };

export default function Dashboard() {
  const { nav } = useAdmin();
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsErr, setStatsErr] = useState("");
  const [payments, setPayments] = useState<PaymentRow[] | null>(null);
  const [payErr, setPayErr] = useState("");
  const [lives, setLives] = useState<Live[] | null>(null);
  const [livesErr, setLivesErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = supabase();
    const [st, pay, lv] = await Promise.allSettled([
      q(sb.rpc("admin_stats")),
      q(sb.from("payments").select("id,amount_cents,currency,status,created_at,user_id,course_id,courses(title)").order("created_at", { ascending: false }).limit(8)),
      q(sb.from("lives").select("*").neq("status", "ended").order("starts_at", { ascending: true }).limit(6))
    ]);
    if (st.status === "fulfilled") { setStats(st.value as Stats); setStatsErr(""); } else setStatsErr(errMsg(st.reason, "Couldn't load the numbers."));
    if (lv.status === "fulfilled") { setLives((lv.value as Live[]) || []); setLivesErr(""); } else setLivesErr(errMsg(lv.reason, "Couldn't load classes."));
    if (pay.status === "fulfilled") {
      const rows = (pay.value as any[]) || [];
      const ids = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));
      let names: Record<string, string> = {};
      if (ids.length) {
        try {
          const ps = await q(sb.from("profiles").select("id,full_name").in("id", ids));
          names = Object.fromEntries((ps || []).map((p: any) => [p.id, p.full_name]));
        } catch { /* names are optional */ }
      }
      setPayments(rows.map((r) => {
        const c = Array.isArray(r.courses) ? r.courses[0] : r.courses;
        return { ...r, courseTitle: c?.title ?? null, name: r.user_id ? names[r.user_id] || null : null };
      }));
      setPayErr("");
    } else setPayErr(errMsg(pay.reason, "Couldn't load payments."));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const cards: { label: string; value: string; Icon: any; hint?: string; navy?: boolean }[] = stats ? [
    { label: "Students", value: num(stats.users), Icon: Users, hint: `${num(stats.enrollments)} course enrollments` },
    { label: "New this week", value: num(stats.new_7d), Icon: UserPlus, hint: "Accounts made in the last 7 days" },
    { label: "Paying students", value: num(stats.paying), Icon: CreditCard, hint: "Bought at least one course" },
    { label: "Revenue, all time", value: usd(stats.revenue_cents), Icon: Banknote, hint: "Refunded payments not counted", navy: true },
    { label: "Revenue, last 30 days", value: usd(stats.revenue_30d_cents), Icon: DollarSign, navy: true },
    { label: "Online now", value: num(stats.online_now), Icon: Activity, hint: "Active in the last 2 minutes" },
    { label: "AI questions today", value: num(stats.ai_today), Icon: Bot, hint: "Tutor, exams and other AI use" }
  ] : [];

  return (
    <div className="stack" style={{ gap: 22 }}>
      <SectionHead eyebrow="Dashboard" title="How it's" accent="going"
        sub="Live numbers from your database. Nothing here is estimated."
        actions={<button type="button" className="btn sm" onClick={load} disabled={loading}><RefreshCw aria-hidden="true" />{loading ? "Refreshing…" : "Refresh"}</button>} />

      {/* Quick actions */}
      <div className={`plate ${s.quick}`}>
        <span className="label">Quick actions</span>
        <div className={s.quickGrid}>
          <button type="button" className="btn primary" onClick={() => nav("courses", { action: "new" })}><Plus aria-hidden="true" />New course</button>
          <button type="button" className="btn navy" onClick={() => nav("lives", { action: "new" })}><CalendarPlus aria-hidden="true" />Schedule live</button>
          <button type="button" className="btn" onClick={() => nav("tests", { action: "new" })}><Sparkles aria-hidden="true" />Build a test with AI</button>
          <button type="button" className="btn" onClick={() => nav("tests", { action: "new-deck" })}><Gamepad2 aria-hidden="true" />Build a game with AI</button>
          <Link className="btn" href={routes.status}><ShieldCheck aria-hidden="true" />Setup check</Link>
          <button type="button" className="btn" onClick={() => nav("notify")}><Megaphone aria-hidden="true" />Send announcement</button>
        </div>
        <span className="bolts" />
      </div>

      {/* Stat cards */}
      {statsErr ? <ErrorBox text={statsErr} onRetry={load} /> : !stats ? <Loading text="Loading numbers…" /> : (
        <div className={s.statGrid}>
          {cards.map((c) => (
            <div key={c.label} className={`statcard ${c.navy ? "navy" : ""} ${s.stat}`}>
              <div className="ico"><c.Icon aria-hidden="true" /></div>
              <div className={s.statText}>
                <b>{c.value}</b>
                <span className={s.statLabel}>{c.label}</span>
                {c.hint && <span className={s.statHint}>{c.hint}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={s.dashGrid}>
        {/* Signups */}
        <section className={`card hard ${s.span2}`}>
          <div className={s.cardHead}><h3>New accounts per day</h3></div>
          {stats ? <SignupsChart data={stats.signups_by_day || []} /> : statsErr ? <p className="note">Chart unavailable.</p> : <Loading />}
        </section>

        {/* Weak topics */}
        <section className="card">
          <div className={s.cardHead}><h3><TrendingDown aria-hidden="true" className={s.h3Ico} />Weakest topics</h3><span className="note">All students</span></div>
          {!stats ? (statsErr ? <p className="note">Unavailable.</p> : <Loading />) : !stats.weak_topics?.length ? (
            <Empty title="Not enough answers yet">Topics show up here once students have answered at least 10 questions in them.</Empty>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {stats.weak_topics.map((t) => {
                const acc = Math.max(0, Math.min(100, Number(t.accuracy) || 0));
                return (
                  <div key={t.topic} className="tbar">
                    <span className={s.topicName}>{t.topic}<small>{num(t.answered)} answers</small></span>
                    <div className={`bar ${acc < 60 ? "low" : acc < 75 ? "mid" : "ok"}`} role="img" aria-label={`${acc}% correct`}><i style={{ width: `${acc}%` }} /></div>
                    <em>{acc}%</em>
                  </div>
                );
              })}
              <p className="note" style={{ margin: 0 }}>Percent of answers that were correct. Low topics are good ideas for a lesson or a live class.</p>
            </div>
          )}
        </section>

        {/* Payments */}
        <section className="card">
          <div className={s.cardHead}><h3><Receipt aria-hidden="true" className={s.h3Ico} />Recent payments</h3></div>
          {payErr ? <ErrorBox text={payErr} onRetry={load} /> : !payments ? <Loading /> : !payments.length ? (
            <Empty title="No payments yet">When a student buys a course, it shows up here.</Empty>
          ) : (
            <ul className={s.rows}>
              {payments.map((p) => (
                <li key={p.id} className={s.rowItem}>
                  <div className={s.rowMain}>
                    <b>{p.courseTitle || "Course no longer exists"}</b>
                    <span className="note">{p.name || "Student"} · {relTime(p.created_at)}</span>
                  </div>
                  <div className={s.rowEnd}>
                    <b className={p.status === "refunded" ? s.struck : ""}>{usd(p.amount_cents)}</b>
                    {p.status === "refunded" && <span className="badge warn">Refunded</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Upcoming lives */}
        <section className={`card ${s.span2}`}>
          <div className={s.cardHead}>
            <h3><Radio aria-hidden="true" className={s.h3Ico} />Upcoming &amp; live classes</h3>
            <button type="button" className="btn sm ghost" onClick={() => nav("lives")}>All classes</button>
          </div>
          {livesErr ? <ErrorBox text={livesErr} onRetry={load} /> : !lives ? <Loading /> : !lives.length ? (
            <Empty title="No classes scheduled" action={<button type="button" className="btn sm primary" onClick={() => nav("lives", { action: "new" })}><CalendarPlus aria-hidden="true" />Schedule a live class</button>}>
              Schedule one and students see it on the Live page.
            </Empty>
          ) : (
            <ul className={s.rows}>
              {lives.map((l) => (
                <li key={l.id} className={s.rowItem}>
                  <div className={s.rowMain}>
                    <b>{l.title}</b>
                    <span className="note">{fmtDateTime(l.starts_at)} · {relTime(l.starts_at)}{l.is_free ? " · Free" : ""}</span>
                  </div>
                  <div className={s.rowEnd}>
                    <StatusBadge status={l.status} />
                    <Link className="btn sm navy" href={routes.studio(l.id)}><Clapperboard aria-hidden="true" />Open studio</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
