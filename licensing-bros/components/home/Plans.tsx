"use client";
// Free account vs Pro explainer. Limits come from site_settings (free_limits / paid_limits).
import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";
import { useAuth, DEFAULT_FREE_LIMITS } from "@/lib/auth";
import { routes } from "@/lib/nav";
import type { Limits } from "@/lib/types";
import s from "./Home.module.css";

export const DEFAULT_PAID_LIMITS: Limits = { ai_daily: 60, exam_max_questions: 50, ai_exams: true, practice_sets: true };

/** Plan limits from settings, falling back to the defaults seeded in the database. */
export function usePlanLimits(): { free: Limits; paid: Limits } {
  const { settings } = useAuth();
  return {
    free: { ...DEFAULT_FREE_LIMITS, ...(settings.free_limits || {}) },
    paid: { ...DEFAULT_PAID_LIMITS, ...(settings.paid_limits || {}) }
  };
}

export function freeFeatures(free: Limits): string[] {
  return [
    "Free courses and free preview lessons",
    "Free live classes",
    "Ask and answer in the community",
    `${free.ai_daily} AI tutor question${free.ai_daily === 1 ? "" : "s"} a day`,
    `Practice exams up to ${free.exam_max_questions} questions`,
    ...(free.ai_exams ? ["AI-built mock exams"] : []),
    ...(free.practice_sets ? ["Instructor practice sets"] : [])
  ];
}

export function proFeatures(paid: Limits): string[] {
  return [
    "Every lesson in the course you buy",
    "Live classes that come with your course",
    `${paid.ai_daily} AI tutor questions a day`,
    `Full practice exams up to ${paid.exam_max_questions} questions`,
    ...(paid.ai_exams ? ["AI-built mock exams for your state and trade"] : []),
    ...(paid.practice_sets ? ["Instructor-made practice sets"] : [])
  ];
}

export function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className={s.checks}>
      {items.map((t) => <li key={t}><span className={s.check}><Check aria-hidden="true" /></span>{t}</li>)}
    </ul>
  );
}

export default function Plans() {
  const { user, account } = useAuth();
  const { free, paid } = usePlanLimits();
  const isPro = !!account?.paid;
  return (
    <section className={s.plansSection} aria-labelledby="plans-title">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow orange">Free vs Pro</span>
          <h2 id="plans-title">Start free. Go Pro when you&rsquo;re ready.</h2>
          <p>A free account gets you studying today. Buy the course for your exam and you get Pro study tools with it.</p>
        </div>
        <div className={s.plans}>
          <article className={s.plan} aria-labelledby="plan-free">
            <header>
              <span className="label">Free account</span>
              <h3 id="plan-free" className={s.planPrice}>$0</h3>
              <p className={s.planSub}>No card needed.</p>
            </header>
            <FeatureList items={freeFeatures(free)} />
            {user
              ? <span className={s.planNote}>{isPro ? "You have Pro, so all of this is included." : "This is your plan right now."}</span>
              : <Link href={routes.login("signup")} className="btn cta outline-navy block">Create free account</Link>}
          </article>
          <article className={`${s.plan} ${s.planPro}`} aria-labelledby="plan-pro">
            <div className="hazard thin" />
            <header>
              <span className="label">Pro</span>
              <h3 id="plan-pro" className={s.planPrice}>Buy any course</h3>
              <p className={s.planSub}>Everything in Free, plus:</p>
            </header>
            <FeatureList items={proFeatures(paid)} />
            {isPro
              ? <span className={s.planNote}><span className="badge paid">Pro access</span> You&rsquo;re all set.</span>
              : <Link href={routes.courses()} className="btn cta primary block">Browse courses <ArrowRight aria-hidden="true" /></Link>}
          </article>
        </div>
      </div>
    </section>
  );
}
