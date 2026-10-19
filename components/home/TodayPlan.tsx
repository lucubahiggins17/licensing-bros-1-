"use client";
// "Today's plan": a proactive daily coach for signed-in students. It reads their study record and lays out
// up to three next steps (review due, weakest topic, a mock exam, a lesson from Bro) with a daily goal ring.
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Brain, ClipboardCheck, Flame, MessageCircle, RotateCcw, Sparkles, Target } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { routes } from "@/lib/nav";
import { loadProgressRaw } from "@/lib/loadProgress";
import { setPendingAsk } from "@/lib/pendingAsk";
import type { Plan, PlanStep } from "@/lib/progress";
import s from "./TodayPlan.module.css";

const ICON: Record<PlanStep["key"], typeof Brain> = { review: RotateCcw, weak: Target, exam: ClipboardCheck, new: Sparkles, tutor: MessageCircle, start: Brain };

function GoalRing({ done, goal }: { done: number; goal: number }) {
  const C = 2 * Math.PI * 40;
  const pct = Math.min(1, goal ? done / goal : 0);
  const [shown, setShown] = useState(0);
  useEffect(() => { const t = requestAnimationFrame(() => setShown(pct)); return () => cancelAnimationFrame(t); }, [pct]);
  const hit = done >= goal;
  return (
    <svg className={s.ring} viewBox="0 0 100 100" role="img" aria-label={`${done} of ${goal} questions today`}>
      <circle cx="50" cy="50" r="40" className={s.ringBg} />
      <circle cx="50" cy="50" r="40" className={s.ringFg} data-hit={hit ? "1" : "0"} strokeDasharray={C} strokeDashoffset={C * (1 - shown)} transform="rotate(-90 50 50)" />
      <text x="50" y="50" textAnchor="middle" className={s.ringNum}>{done}</text>
      <text x="50" y="66" textAnchor="middle" className={s.ringLbl}>OF {goal}</text>
    </svg>
  );
}

export default function TodayPlan() {
  const { user } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    Promise.all([import("@/lib/progress"), loadProgressRaw(user.id)])
      .then(([m, raw]) => { if (alive) setPlan(m.todayPlan(m.normalize(raw))); })
      .catch(() => { /* the card stays hidden */ });
    return () => { alive = false; };
  }, [user]);

  if (!user || !plan) return null;

  return (
    <section className={s.outer} aria-labelledby="plan-title" data-reveal>
      <div className="wrap">
        <div className={s.card}>
          <div className={s.left}>
            <GoalRing done={plan.done} goal={plan.goal} />
            <div className={s.meta}>
              <span className={s.kicker}>Today&rsquo;s plan</span>
              <h2 id="plan-title" className={s.title}>{plan.headline}</h2>
              <div className={s.pills}>
                <span className={s.pill} data-on={plan.streak > 0 ? "1" : "0"}><Flame aria-hidden="true" />{plan.streak} day streak</span>
                {plan.due > 0 && <span className={s.pill} data-on="1"><RotateCcw aria-hidden="true" />{plan.due} due</span>}
                {plan.daysLeft !== null && plan.daysLeft >= 0 && <span className={s.pill}>{plan.daysLeft === 0 ? "Exam today" : `${plan.daysLeft} days to exam`}</span>}
              </div>
            </div>
          </div>
          <ol className={s.steps}>
            {plan.steps.map((st, i) => {
              const Icon = ICON[st.key];
              return (
                <li key={st.key + i} data-reveal-child>
                  <Link href={routes.learn(st.tab)} className={s.step} onClick={() => { if (st.ask) setPendingAsk(st.ask); }}>
                    <span className={s.stepIcon}><Icon aria-hidden="true" /></span>
                    <span className={s.stepText}><b>{st.title}</b><small>{st.detail}</small></span>
                    <ArrowRight className={s.go} aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
