"use client";
// First-run onboarding for the Android app: swipeable full-screen slides (brand, Bro the AI tutor, adaptive practice),
// a quick setup (trade, state, exam date) and an account step. Shown once per device; the choices carry into a new account.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronLeft, Mic, Sparkles } from "lucide-react";
import { asset, routes } from "@/lib/nav";
import type { TradeKey } from "@/lib/data";
import { US_STATES as STATES } from "@/components/home/states";
import { TRADE_META, TRADE_ORDER } from "@/components/home/trades";
import { markOnboarded, readChoice, saveChoice } from "@/lib/onboarding";
import { onBackButton } from "@/lib/native";
import s from "./AppOnboarding.module.css";

const SLIDES = 5;

export default function AppOnboarding({ onDone }: { onDone: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const saved = typeof window !== "undefined" ? readChoice() : null;
  const [trade, setTrade] = useState<TradeKey | "">(saved?.trade || "");
  const [state, setState] = useState(saved?.state || "Tennessee");
  const [exam, setExam] = useState(saved?.examDate || "");

  // Follow the swipe position
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setI(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)))); };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);

  // Android back button steps back through the slides
  const iRef = useRef(0);
  iRef.current = i;
  useEffect(() => onBackButton(() => { if (iRef.current > 0) { go(iRef.current - 1); return true; } return false; }), []);

  function go(n: number) {
    const el = track.current;
    if (!el) return;
    const k = Math.max(0, Math.min(SLIDES - 1, n));
    el.scrollTo({ left: k * el.clientWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setI(k);
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") go(i + 1);
    if (e.key === "ArrowLeft") go(i - 1);
  }
  function finishSetup() {
    if (!trade) return;
    saveChoice({ trade, state, examDate: exam });
    go(4);
  }
  function done() { markOnboarded(); onDone(); }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className={s.screen} role="dialog" aria-modal="true" aria-label="Welcome to Licensing Bro's" onKeyDown={onKey}>
      <div className={s.top}>
        {i > 0 ? <button type="button" className={s.back} onClick={() => go(i - 1)} aria-label="Back"><ChevronLeft aria-hidden="true" /></button> : <span className={s.back} aria-hidden="true" />}
        <img src={asset("/logo-sm.png")} alt="Licensing Bro's" width={46} height={35} className={s.logoSm} />
        {i < 3 ? <button type="button" className={s.skip} onClick={() => go(3)}>Skip</button> : <span className={s.skip} aria-hidden="true" />}
      </div>

      <div ref={track} className={s.track}>
        {/* 1. Brand */}
        <section className={s.slide} aria-label="Welcome" data-on={i === 0 ? "1" : "0"}>
          <div className={s.art}>
            <div className={s.badgeWrap}>
              <span className={s.burst} aria-hidden="true" />
              <img src={asset("/logo.png")} alt="" className={s.logoBig} width={220} height={166} />
            </div>
            <span className={s.hazard} aria-hidden="true" />
          </div>
          <div className={s.copy}>
            <span className={s.eyebrow}>Contractor exam prep</span>
            <h1 className={s.h1}>Pass your license exam <span>the first time</span></h1>
            <p className={s.p}>General contractor, electrical, plumbing and HVAC, for every state. Built by people who&rsquo;ve sat for these exams.</p>
          </div>
        </section>

        {/* 2. Bro, the AI tutor */}
        <section className={s.slide} aria-label="Meet Bro" data-on={i === 1 ? "1" : "0"}>
          <div className={s.art}>
            <div className={s.orbWrap} aria-hidden="true">
              <span className={s.ring} /><span className={s.ring} /><span className={s.ring} />
              <span className={s.orb}><Mic /></span>
            </div>
            <div className={s.bubbles} aria-hidden="true">
              <span className={`${s.bubble} ${s.me}`}>Do kitchen counters need GFCI?</span>
              <span className={`${s.bubble} ${s.bro}`}>Yes. Every countertop receptacle, NEC 210.8(A)(6). Want a quick quiz?</span>
            </div>
          </div>
          <div className={s.copy}>
            <span className={s.eyebrow}>Meet Bro</span>
            <h1 className={s.h1}>An AI tutor that <span>talks back</span></h1>
            <p className={s.p}>Ask out loud or type. Bro answers from checked code facts, cites the section, and does the math step by step.</p>
          </div>
        </section>

        {/* 3. Adaptive practice */}
        <section className={s.slide} aria-label="Practice that adapts" data-on={i === 2 ? "1" : "0"}>
          <div className={s.art}>
            <div className={s.cards} aria-hidden="true">
              <span className={s.card}><b>Q</b>Trench depth that needs a protective system?</span>
              <span className={s.card}><b>Q</b>Box fill for 12 AWG?</span>
              <span className={s.card}><b>Q</b>Retainage in Tennessee?</span>
            </div>
            <svg className={s.ringSvg} viewBox="0 0 120 120" aria-hidden="true">
              <circle cx="60" cy="60" r="50" className={s.ringBg} />
              <circle cx="60" cy="60" r="50" className={s.ringFg} />
              <text x="60" y="58" textAnchor="middle" className={s.ringNum}>82</text>
              <text x="60" y="76" textAnchor="middle" className={s.ringLbl}>READY</text>
            </svg>
          </div>
          <div className={s.copy}>
            <span className={s.eyebrow}>Practice</span>
            <h1 className={s.h1}>Practice that <span>adapts to you</span></h1>
            <p className={s.p}>Timed mock exams, games and flashcards. Smart Review brings back what you miss until it sticks, and your readiness score shows when you&rsquo;re ready.</p>
          </div>
        </section>

        {/* 4. Setup */}
        <section className={s.slide} aria-label="Set up" data-on={i === 3 ? "1" : "0"}>
          <div className={`${s.copy} ${s.setup}`}>
            <span className={s.eyebrow}>Quick setup</span>
            <h1 className={s.h1}>What are you <span>studying for?</span></h1>
            <div className={s.trades} role="radiogroup" aria-label="Trade">
              {TRADE_ORDER.map((t) => {
                const m = TRADE_META[t];
                return (
                  <button key={t} type="button" role="radio" aria-checked={trade === t} className={s.trade} onClick={() => setTrade(t)}
                    style={{ "--c": m.color, "--soft": m.soft } as React.CSSProperties}>
                    <m.Icon aria-hidden="true" /><b>{m.short}</b>{trade === t && <Check className={s.tick} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            <label className={s.field}>Your state
              <select value={state} onChange={(e) => setState(e.target.value)}>{STATES.map((st) => <option key={st} value={st}>{st}</option>)}</select>
            </label>
            <label className={s.field}><span>Exam date <small>(optional)</small></span>
              <input type="date" min={today} value={exam} onChange={(e) => setExam(e.target.value)} />
            </label>
          </div>
        </section>

        {/* 5. Account */}
        <section className={s.slide} aria-label="Get started" data-on={i === 4 ? "1" : "0"}>
          <div className={s.art}>
            <div className={s.confetti} aria-hidden="true">{Array.from({ length: 22 }, (_, k) => (
              <i key={k} style={{ "--x": `${Math.round(Math.cos(k * 2.39) * (70 + (k % 5) * 18))}px`, "--y": `${Math.round(Math.sin(k * 2.39) * (60 + (k % 4) * 16) - 30)}px`, "--r": `${(k * 97) % 360}deg`, "--d": `${(k % 7) * 40}ms` } as React.CSSProperties} />
            ))}</div>
            <span className={s.check} aria-hidden="true"><Sparkles /></span>
          </div>
          <div className={s.copy}>
            <span className={s.eyebrow}>You&rsquo;re set</span>
            <h1 className={s.h1}>Let&rsquo;s get you <span>licensed</span></h1>
            <p className={s.p}>{trade ? `${TRADE_META[trade].label} · ${state}${exam ? ` · exam ${new Date(exam + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}. ` : ""}A free account saves your progress and unlocks 5 AI questions a day.</p>
            <div className={s.ctas}>
              <Link href={routes.login("signup", "/learn/")} className={s.primary} onClick={markOnboarded}>Create free account</Link>
              <Link href={routes.login(undefined, "/learn/")} className={s.secondary} onClick={markOnboarded}>I already have an account</Link>
              <button type="button" className={s.ghost} onClick={done}>Look around first</button>
            </div>
          </div>
        </section>
      </div>

      <div className={s.bottom}>
        <div className={s.dots} aria-hidden="true">{Array.from({ length: SLIDES }, (_, k) => <span key={k} data-on={k === i ? "1" : "0"} />)}</div>
        {i < 3 && <button type="button" className={s.next} onClick={() => go(i + 1)}>Next <ArrowRight aria-hidden="true" /></button>}
        {i === 3 && <button type="button" className={s.next} onClick={finishSetup} disabled={!trade}>{trade ? "Continue" : "Pick your trade"} <ArrowRight aria-hidden="true" /></button>}
        {i === 4 && <span className={s.next} aria-hidden="true" style={{ visibility: "hidden" }} />}
      </div>
    </div>
  );
}
