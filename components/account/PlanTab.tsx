"use client";
// Plan: Free or Pro with the actual limits, your courses, and a "Browse courses" CTA.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Crown, ArrowRight, BookOpen } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { routes } from "@/lib/nav";
import { usePlanLimits, proFeatures, FeatureList } from "@/components/home/Plans";
import s from "./Account.module.css";

export default function PlanTab() {
  const { account } = useAuth();
  const { free, paid } = usePlanLimits();
  const isAdmin = !!account?.is_admin;
  const isPro = !!account?.paid;
  const limits = account?.limits || (isPro ? paid : free);
  const enrolled = account?.enrolled || [];
  const [courses, setCourses] = useState<{ id: string; title: string; is_free: boolean }[] | null>(null);

  useEffect(() => {
    if (!enrolled.length) { setCourses([]); return; }
    let alive = true;
    supabase().from("courses").select("id,title,is_free").in("id", enrolled.slice(0, 50))
      .then(({ data }) => { if (alive) setCourses((data as any[]) || []); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrolled.join(",")]);

  const rows: [string, string][] = [
    ["AI tutor questions", `${limits.ai_daily} a day`],
    ["Practice exam length", `Up to ${limits.exam_max_questions} questions`],
    ["AI-built mock exams", limits.ai_exams ? "Included" : "Pro"],
    ["Instructor practice sets", limits.practice_sets ? "Included" : "Pro"]
  ];

  return (
    <div className={s.stack}>
      <div className={`card ${s.card} ${isPro ? s.planPro : ""}`}>
        <div className={s.cardHead}>
          <span className="label">Your plan</span>
          <h2 className={s.planName}><Crown aria-hidden="true" />{isAdmin ? "Admin: full access" : isPro ? "Pro" : "Free account"}</h2>
          <p>{isAdmin ? "Admins can open every course and tool." : isPro ? "You bought a course, so you have Pro study tools." : "Free courses, free live classes, the community and limited study tools."}</p>
        </div>
        <dl className={s.limits}>
          {rows.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd className={v === "Pro" ? s.locked : undefined}>{v}</dd></div>
          ))}
        </dl>
      </div>

      {!isPro && (
        <div className={`card ${s.card}`}>
          <div className={s.cardHead}>
            <h2>Go Pro by buying a course</h2>
            <p>Buy the course for your exam. You get every lesson in it, plus:</p>
          </div>
          <FeatureList items={proFeatures(paid).slice(1)} />
          <div className={s.actionsRow}>
            <Link href={routes.courses()} className="btn primary cta">Browse courses <ArrowRight aria-hidden="true" /></Link>
          </div>
        </div>
      )}

      <div className={`card ${s.card}`}>
        <div className={s.cardHead}><h2><BookOpen aria-hidden="true" /> Your courses</h2></div>
        {courses === null ? <span className={s.skel} />
          : courses.length === 0 ? (
            <div className={s.emptyBox}>
              <p>You haven&rsquo;t joined any courses yet. Free courses are open to every account.</p>
              <Link href={routes.courses()} className="btn">Browse courses <ArrowRight aria-hidden="true" /></Link>
            </div>
          ) : (
            <ul className={s.rows}>
              {courses.map((c) => (
                <li key={c.id} className={s.rowItem}>
                  <Link href={routes.course(c.id)} className={s.rowTitle}>{c.title}</Link>
                  {c.is_free ? <span className="badge free">Free</span> : <span className="badge paid">Full access</span>}
                </li>
              ))}
            </ul>
          )}
        {isPro && (
          <div className={s.actionsRow}>
            <Link href={routes.courses()} className="btn outline-navy">Browse more courses <ArrowRight aria-hidden="true" /></Link>
          </div>
        )}
      </div>
    </div>
  );
}
