"use client";
// Signed-out home screen of the Android app: a greeting built from the onboarding picks, three real exam
// questions to try without an account, quick links, and the account buttons.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Check, MessageCircle, Radio, RotateCcw, Users, X } from "lucide-react";
import { asset, routes } from "@/lib/nav";
import type { Question } from "@/lib/data";
import { TRADE_META } from "@/components/home/trades";
import { readChoice } from "@/lib/onboarding";
import { burst } from "@/components/motion";
import s from "./AppHome.module.css";

const TRY = 3;
const L = "ABCD";

/** Three random short questions for the trade picked in onboarding (general contractor if none). */
async function pickQuestions(trade?: string): Promise<Question[]> {
  try {
    const { BANK } = await import("@/lib/data");
    const mine = BANK.filter((q) => q.t === (trade || "gc") && q.c.length >= 2 && q.q.length < 220);
    const list = (mine.length >= TRY ? mine : BANK).slice();
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    return list.slice(0, TRY);
  } catch { return []; }
}

export default function AppWelcome({ onReplay }: { onReplay: () => void }) {
  const choice = useMemo(() => readChoice(), []);
  const meta = choice ? TRADE_META[choice.trade] : null;
  const [qs, setQs] = useState<Question[] | null>(null);
  const [n, setN] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);

  // The question bank is large, so it loads after the screen paints
  useEffect(() => {
    let alive = true;
    pickQuestions(choice?.trade).then((l) => alive && setQs(l));
    return () => { alive = false; };
  }, [choice]);

  const q = qs?.[n];
  const finished = qs !== null && qs.length > 0 && n >= qs.length;

  function pick(k: number, e: React.MouseEvent<HTMLButtonElement>) {
    if (!q || picked !== null) return;
    setPicked(k);
    if (k === q.a) { setScore((v) => v + 1); burst(e.currentTarget, { count: 14 }); }
  }
  function next() { setPicked(null); setN((v) => v + 1); }
  function again() {
    setQs(null); setN(0); setScore(0); setPicked(null);
    pickQuestions(choice?.trade).then(setQs);
  }

  const signup = routes.login("signup", "/learn/");

  return (
    <div className={s.welcome}>
      <section className={s.hello} aria-labelledby="hello-title">
        <div className={s.helloTop}>
          <img src={asset("/logo-sm.png")} alt="" width={46} height={35} />
          {meta && <span className={s.chip} style={{ "--c": meta.color, "--soft": meta.soft } as React.CSSProperties}><meta.Icon aria-hidden="true" />{meta.short}</span>}
        </div>
        <span className={s.kicker}>{choice ? `${choice.state} · ${meta?.label}` : "Contractor exam prep"}</span>
        <h1 id="hello-title" className={s.helloH}>Let&rsquo;s get you <span>licensed</span></h1>
        <p className={s.helloP}>Create a free account to save progress, get your readiness score and ask Bro 5 questions a day.</p>
        <div className={s.helloBtns}>
          <Link href={signup} className={s.bigPrimary}>Create free account</Link>
          <Link href={routes.login(undefined, "/learn/")} className={s.bigSecondary}>Sign in</Link>
        </div>
      </section>

      <section className={s.tryCard} aria-labelledby="try-title" aria-live="polite">
        <header className={s.tryHead}>
          <h2 id="try-title">Try a real exam question</h2>
          {qs && qs.length > 0 && !finished && <span className={s.count}>{n + 1} of {qs.length}</span>}
        </header>
        {qs === null && <div className={s.trySkel} aria-label="Loading a question"><span /><span /><span /></div>}
        {q && (
          <div className={s.tryBody} key={n}>
            <span className={s.topic}>{q.topic}</span>
            <p className={s.tryQ}>{q.q}</p>
            <div className={s.choices}>
              {q.c.map((c, k) => {
                const state = picked === null ? "" : k === q.a ? "right" : k === picked ? "wrong" : "dim";
                return (
                  <button key={k} type="button" className={s.choice} data-state={state} onClick={(e) => pick(k, e)} disabled={picked !== null && state !== "right" && state !== "wrong"} aria-pressed={picked === k}>
                    <b>{L[k]}</b><span>{c}</span>
                    {state === "right" && <Check aria-label="Correct" />}
                    {state === "wrong" && <X aria-label="Your answer" />}
                  </button>
                );
              })}
            </div>
            {picked !== null && (
              <div className={s.why} data-ok={picked === q.a ? "1" : "0"}>
                <strong>{picked === q.a ? "Nice, that's right." : `Not quite. It's ${L[q.a]}.`}</strong>
                {q.why && <p>{q.why}</p>}
                {q.ref && <small>{q.ref}</small>}
                <button type="button" className={s.nextBtn} onClick={next}>{n + 1 < (qs?.length || 0) ? "Next question" : "See my score"} <ArrowRight aria-hidden="true" /></button>
              </div>
            )}
          </div>
        )}
        {finished && (
          <div className={s.tryDone}>
            <span className={s.score}>{score}/{qs!.length}</span>
            <p>{score === qs!.length ? "Perfect run. You're ready for the real practice exams." : "Every miss comes back in Smart Review until it sticks."} A free account keeps going from here.</p>
            <Link href={signup} className={s.bigPrimary}>Keep practicing free</Link>
            <button type="button" className={s.linkBtn} onClick={again}><RotateCcw aria-hidden="true" /> Three more</button>
          </div>
        )}
      </section>

      <nav className={s.tiles} aria-label="Explore">
        <Link href={signup} className={s.tile} style={{ "--c": "var(--orange)" } as React.CSSProperties}><MessageCircle aria-hidden="true" /><b>Ask Bro</b><small>AI tutor, voice or text</small></Link>
        <Link href={routes.courses(choice ? { state: choice.state, trade: choice.trade } : undefined)} className={s.tile} style={{ "--c": "#2f5bd3" } as React.CSSProperties}><BookOpen aria-hidden="true" /><b>Courses</b><small>{choice ? `For ${choice.state}` : "Every state"}</small></Link>
        <Link href={routes.lives} className={s.tile} style={{ "--c": "#c4321f" } as React.CSSProperties}><Radio aria-hidden="true" /><b>Live classes</b><small>Join an instructor</small></Link>
        <Link href={routes.community} className={s.tile} style={{ "--c": "#0f7f7a" } as React.CSSProperties}><Users aria-hidden="true" /><b>Community</b><small>Ask other contractors</small></Link>
      </nav>

      <p className={s.replay}><button type="button" className={s.linkBtn} onClick={onReplay}>Replay the intro</button></p>
    </div>
  );
}
