"use client";
// "Built for contractors" feature grid and the 3-step "How it works".
import Link from "next/link";
import { Mic, ShieldCheck, Radio, Timer, Gauge, Smartphone, Lock, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { routes } from "@/lib/nav";
import s from "./Home.module.css";

const FEATURES = [
  { Icon: Mic, title: "An AI tutor you can talk to", body: "Ask Bro out loud or type it, like asking the foreman. You get a straight answer in plain English with the code section to look up in your book." },
  { Icon: ShieldCheck, title: "Checked against your state's rules", body: "License law, lien deadlines and code editions change from state to state. When it matters, Bro checks the rule for your state and shows where the answer came from." },
  { Icon: Radio, title: "Live classes with instructors", body: "Join live classes, ask questions in the chat and get answers on the spot." },
  { Icon: Timer, title: "Timed mock exams and games", body: "Practice on the clock like test day, then lock in terms with quick games and flashcards." },
  { Icon: Gauge, title: "Your readiness score", body: "One number that shows how ready you are and which topics still need work." },
  { Icon: Smartphone, title: "Works on your phone, even offline", body: "Study on a break at the job site. Practice exams, games and calculators keep working with no signal." },
  { Icon: Lock, title: "Secure, one device at a time", body: "Your account is used on one device at a time, so your login and the courses you paid for stay yours." }
];

export default function Features() {
  return (
    <section className={s.features} aria-labelledby="why-title">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow orange">Why choose us</span>
          <h2 id="why-title">Built for contractors</h2>
          <p>Everything you need to pass your exam and advance your career</p>
        </div>
        <ul className={s.fgrid}>
          {FEATURES.map(({ Icon, title, body }, i) => (
            <li key={title} className={`${s.fcard} ${i === 0 ? s.fbig : ""}`}>
              <span className={s.fico}><Icon aria-hidden="true" /></span>
              <h3>{title}</h3>
              <p>{body}</p>
              {i === 0 && <Link href={routes.learn("tutor")} className={`btn cta primary ${s.fcta}`}>Try the tutor <ArrowRight aria-hidden="true" /></Link>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function HowItWorks() {
  const { user } = useAuth();
  const steps = [
    {
      title: "Make a free account",
      body: "Sign up with your email and pick your state and trade. No card needed.",
      link: user ? { href: routes.account("profile"), label: "Check your profile" } : { href: routes.login("signup"), label: "Create free account" }
    },
    {
      title: "Study your way",
      body: "Take a free course, ask Bro anything and run practice exams. Buy the course for your exam when you want every lesson.",
      link: { href: routes.courses(), label: "Browse courses" }
    },
    {
      title: "Walk in ready",
      body: "Watch your readiness score climb. When you pass full timed mock exams with room to spare, you're ready for test day.",
      link: { href: routes.learn("exam"), label: "Take a mock exam" }
    }
  ];
  return (
    <section className={`blueprint ${s.how}`} aria-labelledby="how-title">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow orange">How it works</span>
          <h2 id="how-title">Three steps to your license</h2>
        </div>
        <ol className={s.steps}>
          {steps.map((st, i) => (
            <li key={st.title} className={s.step}>
              <span className={s.stepNo} aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
              <span className="label">Step {i + 1}</span>
              <h3>{st.title}</h3>
              <p>{st.body}</p>
              <Link href={st.link.href} className={s.stepLink}>{st.link.label} <ArrowRight aria-hidden="true" /></Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
