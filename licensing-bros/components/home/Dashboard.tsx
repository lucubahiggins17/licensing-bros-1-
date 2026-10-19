"use client";
// "Your dashboard" for signed-in students: readiness, exam countdown, continue learning, next live class, streak, quick actions.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Mic, Timer, Brain, Flame, CalendarClock, BookOpen, ArrowRight, Award, Radio } from "lucide-react";
import { useAuth, displayName } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { routes } from "@/lib/nav";
import type { Live } from "@/lib/types";
import { whenLabel } from "@/components/notifications/timeAgo";
import s from "./Dashboard.module.css";

type ProgressMod = typeof import("@/lib/progress");
type Continue =
  | { kind: "lesson"; lessonId: string; lessonTitle: string; courseId: string; courseTitle: string; resume: boolean }
  | { kind: "done"; courseId: string; courseTitle: string }
  | { kind: "none" };
type Study = { readiness: number | null; examDate: string; streak: number; today: boolean };

const LOCAL_PROGRESS = "licensingbros.progress"; // offline copy kept by the study workspace

const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

/** Consecutive days (ending today, or yesterday if you haven't studied yet today) with study activity. */
export function studyStreak(hist: { at?: number }[]): { streak: number; today: boolean } {
  const days = new Set(hist.filter((h) => h && typeof h.at === "number").map((h) => dayKey(h.at as number)));
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  const today = days.has(dayKey(d.getTime()));
  if (!today) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(d.getTime())) && n < 400) { n++; d.setDate(d.getDate() - 1); }
  return { streak: n, today };
}

/** The live class happening now, or the next one coming up. */
export function pickNextLive(lives: Live[] | null): Live | null {
  if (!lives?.length) return null;
  return lives.find((l) => l.status === "live")
    || lives.find((l) => l.status === "scheduled" && new Date(l.starts_at).getTime() > Date.now() - 2 * 3600e3)
    || null;
}

async function loadContinue(uid: string): Promise<Continue> {
  const sb = supabase();
  const { data: last, error } = await sb.from("lesson_progress").select("lesson_id,course_id,completed,updated_at")
    .eq("user_id", uid).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!last) return { kind: "none" };
  const courseId = (last as any).course_id as string;
  const [{ data: lessons }, { data: done }, { data: course }] = await Promise.all([
    sb.from("lessons").select("id,title,sort,module_id,modules(sort)").eq("course_id", courseId),
    sb.from("lesson_progress").select("lesson_id").eq("user_id", uid).eq("course_id", courseId).eq("completed", true),
    sb.from("courses").select("id,title").eq("id", courseId).maybeSingle()
  ]);
  const courseTitle = (course as any)?.title || "Your course";
  const modSort = (l: any) => (Array.isArray(l.modules) ? l.modules[0]?.sort : l.modules?.sort) ?? -1;
  const list = ((lessons as any[]) || []).slice().sort((a, b) => modSort(a) - modSort(b) || (a.sort ?? 0) - (b.sort ?? 0));
  const doneSet = new Set(((done as any[]) || []).map((d) => d.lesson_id));
  const lastId = (last as any).lesson_id as string;
  const current = list.find((l) => l.id === lastId);
  if (current && !(last as any).completed) {
    return { kind: "lesson", lessonId: current.id, lessonTitle: current.title, courseId, courseTitle, resume: true };
  }
  const idx = list.findIndex((l) => l.id === lastId);
  const next = list.slice(idx + 1).find((l) => !doneSet.has(l.id)) || list.find((l) => !doneSet.has(l.id));
  if (next) return { kind: "lesson", lessonId: next.id, lessonTitle: next.title, courseId, courseTitle, resume: false };
  return { kind: "done", courseId, courseTitle };
}

function Ring({ value }: { value: number | null }) {
  const C = 2 * Math.PI * 42;
  const v = value ?? 0;
  const color = value === null ? "var(--line)" : v >= 80 ? "var(--ok)" : v >= 65 ? "var(--hazard)" : "var(--orange)";
  return (
    <svg className={s.ring} viewBox="0 0 100 100" role="img" aria-label={value === null ? "Readiness score not started" : `Readiness score ${v} out of 100`}>
      <circle cx="50" cy="50" r="42" fill="none" stroke="var(--line)" strokeWidth="10" />
      <circle cx="50" cy="50" r="42" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
        strokeDasharray={`${(v / 100) * C} ${C}`} transform="rotate(-90 50 50)" className={s.ringArc} />
      <text x="50" y="58" textAnchor="middle" fontSize="27" fill="var(--ink)" fontFamily="Archivo Black, Arial Black, sans-serif">{value ?? "–"}</text>
    </svg>
  );
}

export default function Dashboard({ lives, app = false }: { lives: Live[] | null; app?: boolean }) {
  const { user, profile } = useAuth();
  const mod = useRef<ProgressMod | null>(null);
  const [study, setStudy] = useState<Study | null>(null);
  const [cont, setCont] = useState<Continue | null>(null);
  const [contErr, setContErr] = useState(false);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      try {
        const [m, res] = await Promise.all([
          import("@/lib/progress"),
          supabase().from("progress").select("data").eq("user_id", user.id).maybeSingle()
        ]);
        mod.current = m;
        let raw: any = res.error ? null : res.data?.data;
        if (!raw) { try { raw = JSON.parse(localStorage.getItem(LOCAL_PROGRESS) || "null"); } catch { raw = null; } }
        const p = m.normalize(raw);
        const st = studyStreak(p.hist);
        if (alive) setStudy({ readiness: m.readiness(p), examDate: p.examDate, streak: st.streak, today: st.today });
      } catch {
        if (alive) setStudy({ readiness: null, examDate: "", streak: 0, today: false });
      }
    })();
    loadContinue(user.id)
      .then((c) => { if (alive) setCont(c); })
      .catch(() => { if (alive) { setContErr(true); setCont({ kind: "none" }); } });
    return () => { alive = false; };
  }, [user]);

  if (!user) return null;
  const first = displayName(profile, user).split(/\s+/)[0];
  const examDate = study?.examDate || profile?.exam_date || "";
  const days = study && mod.current ? mod.current.daysLeft(examDate) : null;
  const nextLive = pickNextLive(lives);

  return (
    <section className={`${s.outer} ${app ? s.app : ""}`} aria-labelledby="dash-title">
      <div className="wrap">
        <div className={s.panel}>
          <header className={s.head}>
            <div>
              <span className={s.kicker}>Welcome back, {first}</span>
              <h2 id="dash-title">Your dashboard</h2>
            </div>
            <Link href={routes.learn("progress")} className={`btn sm ${s.headBtn}`}>My Learning <ArrowRight aria-hidden="true" /></Link>
          </header>

          <div className={s.grid}>
            {/* Readiness + countdown */}
            <div className={`${s.tile} ${s.ready}`}>
              {study ? <Ring value={study.readiness} /> : <span className={`${s.skel} ${s.skelRing}`} />}
              <div className={s.readyText}>
                <span className="label">Readiness</span>
                {!study ? <span className={s.skel} /> : study.readiness === null
                  ? <p className={s.small}>Answer practice questions to get your readiness score.</p>
                  : <p className={s.small}>{study.readiness >= 80 ? "You're in passing shape. Keep it sharp." : study.readiness >= 65 ? "Getting close. Work your weak topics." : "Keep practicing. Your score climbs as you go."}</p>}
                <div className={s.countdown}>
                  <CalendarClock aria-hidden="true" />
                  {!study ? <span className={s.skel} />
                    : days === null ? <span>No exam date yet. <Link href={routes.account("profile")}>Set it</Link></span>
                    : days > 1 ? <span><b>{days}</b> days to your exam</span>
                    : days === 1 ? <span><b>1</b> day to go: your exam is tomorrow</span>
                    : days === 0 ? <span><b>Exam day.</b> You&rsquo;ve got this.</span>
                    : <span>Exam date passed. <Link href={routes.account("profile")}>Update it</Link></span>}
                </div>
              </div>
            </div>

            {/* Continue learning */}
            <div className={s.tile}>
              <span className={s.tileHead}><BookOpen aria-hidden="true" /> Continue learning</span>
              {!cont ? <><span className={s.skel} /><span className={`${s.skel} ${s.skelShort}`} /></>
                : cont.kind === "lesson" ? (
                  <>
                    <b className={s.title}>{cont.lessonTitle}</b>
                    <span className={s.small}>{cont.courseTitle}</span>
                    <Link href={routes.lesson(cont.lessonId)} className={`btn primary sm ${s.tileBtn}`}>{cont.resume ? "Pick up where you left off" : "Start next lesson"} <ArrowRight aria-hidden="true" /></Link>
                  </>
                ) : cont.kind === "done" ? (
                  <>
                    <b className={s.title}>You finished {cont.courseTitle}</b>
                    <span className={s.small}>Claim your certificate from the course page.</span>
                    <Link href={routes.course(cont.courseId)} className={`btn sm ${s.tileBtn}`}><Award aria-hidden="true" /> Go to course</Link>
                  </>
                ) : (
                  <>
                    <b className={s.title}>{contErr ? "Couldn't load your lessons" : "No lessons started yet"}</b>
                    <span className={s.small}>{contErr ? "Check your connection and try again." : "Pick a course for your state and trade."}</span>
                    <Link href={routes.courses({ state: profile?.state, trade: profile?.trade })} className={`btn sm ${s.tileBtn}`}>Find a course <ArrowRight aria-hidden="true" /></Link>
                  </>
                )}
            </div>

            {/* Next live class */}
            <div className={s.tile}>
              <span className={s.tileHead}><Radio aria-hidden="true" /> Next live class</span>
              {lives === null ? <><span className={s.skel} /><span className={`${s.skel} ${s.skelShort}`} /></>
                : nextLive ? (
                  <>
                    <b className={s.title}>{nextLive.title}</b>
                    <span className={s.small}>{nextLive.status === "live" ? <span className="badge live">Live now</span> : whenLabel(nextLive.starts_at)}</span>
                    <Link href={routes.watch(nextLive.id)} className={`btn sm ${nextLive.status === "live" ? "primary" : ""} ${s.tileBtn}`}>{nextLive.status === "live" ? "Join now" : "See details"} <ArrowRight aria-hidden="true" /></Link>
                  </>
                ) : (
                  <>
                    <b className={s.title}>Nothing scheduled yet</b>
                    <span className={s.small}>New classes show up here as soon as they&rsquo;re posted.</span>
                    <Link href={routes.lives} className={`btn sm ${s.tileBtn}`}>Live classes <ArrowRight aria-hidden="true" /></Link>
                  </>
                )}
            </div>

            {/* Streak */}
            <div className={`${s.tile} ${s.streak}`}>
              <span className={s.tileHead}><Flame aria-hidden="true" /> Study streak</span>
              {!study ? <span className={s.skel} /> : (
                <>
                  <b className={s.big}>{study.streak}<small>{study.streak === 1 ? "day" : "days"}</small></b>
                  <span className={s.small}>
                    {study.today ? "You studied today. Nice work." : study.streak > 0 ? "Study today to keep it going." : "Answer a few questions to start a streak."}
                  </span>
                </>
              )}
            </div>
          </div>

          <nav className={s.actions} aria-label="Quick actions">
            <Link href={routes.learn("tutor")} className={s.action}><span className={s.aico}><Mic aria-hidden="true" /></span><span>Talk to Bro</span></Link>
            <Link href={routes.learn("exam")} className={s.action}><span className={s.aico}><Timer aria-hidden="true" /></span><span>Take a mock exam</span></Link>
            <Link href={routes.learn("exam")} className={s.action}><span className={s.aico}><Brain aria-hidden="true" /></span><span>Smart review</span></Link>
          </nav>
        </div>
      </div>
    </section>
  );
}
