"use client";
// Exam-day simulator: a full-screen testing screen modeled on computer-based licensing exams (PSI, Prometric).
// A tutorial screen before the clock starts, then: the countdown (with 30/10/5/1-minute warnings and auto-submit at
// zero), one question at a time, flag for review, cross out choices, a question navigator, the on-screen calculator,
// a review screen before ending, and no hints or answers until it's scored. The exam is saved on the device after
// every change, so a refresh or a closed app picks up where it left off (with the clock still running, like test day).
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calculator as CalcIcon, ChevronLeft, ChevronRight, Clock, Eye, EyeOff, Flag, Grid3x3, ListChecks, Maximize2, Slash } from "lucide-react";
import { onBackButton } from "@/lib/native";
import { fmtClock, saveRun, type SimRun, timeLeft, warningCrossed } from "@/lib/examSim";
import Calculator from "./Calculator";
import s from "./ExamSim.module.css";

const L = "ABCD";
type Filter = "all" | "flagged" | "unanswered";

type Props = { initial: SimRun; candidate: string; onFinish: (r: SimRun, timedOut: boolean) => void; onQuit: () => void };

/** Rendered on top of everything (outside the page layout, so nothing on the page can cover or clip it). */
export default function ExamSimulator(props: Props) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.body); }, []);
  return host ? createPortal(<Simulator {...props} />, host) : null;
}

function Simulator({ initial, candidate, onFinish, onQuit }: Props) {
  const [run, setRun] = useState<SimRun>(initial);
  const [now, setNow] = useState(Date.now());
  const [screen, setScreen] = useState<"intro" | "exam" | "review">(initial.t0 === null ? "intro" : "exam");
  const [ending, setEnding] = useState(false);
  const [calc, setCalc] = useState(false);
  const [grid, setGrid] = useState(false);
  const [hideTime, setHideTime] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [warn, setWarn] = useState("");
  const enterAt = useRef(Date.now());
  const runRef = useRef(run);
  runRef.current = run;
  const finished = useRef(false);
  const lastLeft = useRef(timeLeft(initial));
  const qRef = useRef<HTMLHeadingElement>(null);

  // Save after every change
  useEffect(() => { if (!finished.current) saveRun(run); }, [run]);

  // The clock
  useEffect(() => {
    if (screen === "intro") return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [screen]);
  const left = timeLeft(run, now);
  const elapsed = run.t0 ? Math.floor((now - run.t0) / 1000) : 0;

  /** Adds the time spent on the current question. */
  const bank = useCallback((r: SimRun): SimRun => {
    const t = Date.now();
    const secs = Math.max(0, Math.round((t - enterAt.current) / 1000));
    enterAt.current = t;
    if (r.t0 === null || !secs) return r;
    const spent = [...r.spent];
    spent[r.i] = (spent[r.i] || 0) + secs;
    return { ...r, spent };
  }, []);

  const finish = useCallback((timedOut: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const r = bank(runRef.current);
    saveRun(null);
    try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch { /* not supported */ }
    onFinish(r, timedOut);
  }, [bank, onFinish]);

  useEffect(() => {
    if (screen === "intro" || !run.limit) return;
    const m = warningCrossed(lastLeft.current, left);
    lastLeft.current = left;
    if (m) { setWarn(`${m} minute${m === 1 ? "" : "s"} remaining`); setTimeout(() => setWarn(""), 6000); }
    if (left <= 0) finish(true);
  }, [left, screen, run.limit, finish]);

  // Leaving the exam screen is counted (at a testing center it isn't allowed)
  useEffect(() => {
    if (screen === "intro") return;
    const onVis = () => { if (document.visibilityState === "hidden") setRun((r) => ({ ...r, leaves: (r.leaves || 0) + 1 })); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [screen]);

  // No page scrolling behind the exam; Android back asks before ending
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  useEffect(() => onBackButton(() => {
    if (calc) { setCalc(false); return true; }
    if (grid) { setGrid(false); return true; }
    if (screen === "intro") { onQuit(); return true; }
    setEnding(true); return true;
  }), [calc, grid, screen, onQuit]);

  const go = useCallback((i: number) => {
    setRun((r) => ({ ...bank(r), i: Math.max(0, Math.min(r.qs.length - 1, i)) }));
    setScreen("exam"); setGrid(false);
    setTimeout(() => qRef.current?.focus(), 30);
  }, [bank]);

  const matches = (r: SimRun, k: number) => filter === "flagged" ? r.flags[k] : filter === "unanswered" ? r.ans[k] === null : true;
  const step = (dir: 1 | -1) => {
    const r = runRef.current;
    for (let k = r.i + dir; k >= 0 && k < r.qs.length; k += dir) if (matches(r, k)) return go(k);
    // End of the list in this direction
    if (dir === 1) { setRun((x) => bank(x)); setScreen("review"); }
  };

  const pick = (k: number) => setRun((r) => {
    const ans = [...r.ans]; ans[r.i] = k;
    const struck = r.struck.map((x, i) => (i === r.i ? x.filter((y) => y !== k) : x));
    return { ...r, ans, struck };
  });
  const strike = (k: number) => setRun((r) => {
    const cur = r.struck[r.i] || [];
    const on = !cur.includes(k);
    const struck = r.struck.map((x, i) => (i === r.i ? (on ? [...x, k] : x.filter((y) => y !== k)) : x));
    const ans = [...r.ans];
    if (on && ans[r.i] === k) ans[r.i] = null;
    return { ...r, struck, ans };
  });
  const flag = () => setRun((r) => { const flags = [...r.flags]; flags[r.i] = !flags[r.i]; return { ...r, flags }; });

  function begin() {
    enterAt.current = Date.now();
    setRun((r) => ({ ...r, t0: Date.now() }));
    setNow(Date.now());
    lastLeft.current = run.limit || Infinity;
    setScreen("exam");
    setTimeout(() => qRef.current?.focus(), 50);
  }

  function onKey(e: React.KeyboardEvent) {
    if (screen !== "exam" || ending || calc) return;
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select")) return;
    const q = run.qs[run.i];
    const k = e.key.toLowerCase();
    const idx = "abcd".indexOf(k) >= 0 ? "abcd".indexOf(k) : "1234".indexOf(k);
    if (idx >= 0 && idx < q.c.length) { e.preventDefault(); pick(idx); }
    else if (k === "arrowright" || k === "n") { e.preventDefault(); step(1); }
    else if (k === "arrowleft" || k === "p") { e.preventDefault(); step(-1); }
    else if (k === "f") { e.preventDefault(); flag(); }
  }

  const total = run.qs.length;
  const answered = run.ans.filter((a) => a !== null).length;
  const flagged = run.flags.filter(Boolean).length;
  const unanswered = total - answered;
  const low = !!run.limit && left <= 300;

  // --------------------------------------------------------------------------------- tutorial (clock not started)
  if (screen === "intro") {
    return (
      <div className={s.screen} role="dialog" aria-modal="true" aria-label="Exam simulator">
        <header className={s.top}>
          <span className={s.brand}>Licensing Bro&rsquo;s <b>exam simulator</b></span>
          <span className={s.cand}>{candidate}</span>
        </header>
        <main className={s.intro}>
          <div className={s.introCard}>
            <span className={s.kicker}>Before you begin</span>
            <h1 className={s.introH}>{run.name}</h1>
            <dl className={s.facts}>
              <div><dt>Questions</dt><dd>{total}</dd></div>
              <div><dt>Time limit</dt><dd>{run.limit ? fmtClock(run.limit) : "Untimed"}</dd></div>
              <div><dt>Passing score</dt><dd>{run.passPct}%</dd></div>
            </dl>
            {!run.verified && <p className={s.small}>Time and passing score are typical for open-book licensing exams. Your testing company&rsquo;s candidate bulletin has the exact numbers for your exam; set them on the setup screen so practice matches test day.</p>}
            <h2 className={s.introH2}>How this test works</h2>
            <p className={s.introP}>This screen works like the computer-based exams at PSI and Prometric testing centers. The clock starts when you press <b>Start the exam</b> and keeps running even if you leave or close the app. You&rsquo;ll get warnings at 30, 10, 5 and 1 minute left, and the exam is scored automatically when time runs out.</p>
            <p className={s.introP}>Answer one question at a time and move with <b>Next</b> and <b>Previous</b>. <b>Flag</b> anything you want to come back to, and use the <Slash className={s.inlineIcon} aria-label="cross out" /> button next to a choice to cross it out. <b>Questions</b> shows every question with what&rsquo;s answered and flagged. <b>Review</b> lists unanswered and flagged questions before you end. The <b>Calculator</b> button opens the on-screen calculator, the same basic kind testing centers give you.</p>
            <p className={s.introP}>You won&rsquo;t see whether answers are right until the exam is scored, and there are no hints or tutor during the exam. Unanswered questions count as wrong, so answer everything before time runs out. On a keyboard: A to D picks an answer, arrow keys move, F flags.</p>
            <div className={s.introBtns}>
              <button type="button" className={s.primary} onClick={begin}>Start the exam</button>
              <button type="button" className={s.ghost} onClick={onQuit}>Not now</button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const q = run.qs[run.i];
  const struck = run.struck[run.i] || [];
  return (
    <div className={s.screen} role="dialog" aria-modal="true" aria-label="Exam simulator" onKeyDown={onKey}>
      <header className={s.top}>
        <span className={s.brand}>{run.name}</span>
        <span className={s.qcount}>{screen === "review" ? "Review" : `Question ${run.i + 1} of ${total}`}</span>
        <span className={s.timerWrap}>
          {!hideTime && <span className={s.timer} data-low={low ? "1" : "0"} role="timer" aria-label={run.limit ? `Time remaining ${fmtClock(left)}` : `Time used ${fmtClock(elapsed)}`}><Clock aria-hidden="true" />{run.limit ? fmtClock(left) : fmtClock(elapsed)}</span>}
          <button type="button" className={s.iconBtn} onClick={() => setHideTime((v) => !v)} aria-label={hideTime ? "Show time" : "Hide time"} title={hideTime ? "Show time" : "Hide time"}>{hideTime ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}</button>
          <button type="button" className={`${s.iconBtn} ${s.fsBtn}`} onClick={() => { try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* not supported */ } }} aria-label="Full screen" title="Full screen"><Maximize2 aria-hidden="true" /></button>
        </span>
      </header>
      <div className={s.progress} aria-hidden="true"><i style={{ width: `${(answered / total) * 100}%` }} /></div>
      <div className={s.live} aria-live="assertive">{warn && <span className={s.warn}>{warn}</span>}</div>

      {screen === "review" ? (
        <main className={s.review}>
          <h1 className={s.reviewH}>Review your answers</h1>
          <p className={s.reviewP}>{answered} of {total} answered · {flagged} flagged · {unanswered} unanswered. Pick a question to go back to it, or review just the flagged or unanswered ones.</p>
          <div className={s.reviewBtns}>
            <button type="button" className={s.btn} disabled={!flagged} onClick={() => { setFilter("flagged"); go(run.flags.findIndex(Boolean)); }}><Flag aria-hidden="true" />Review flagged ({flagged})</button>
            <button type="button" className={s.btn} disabled={!unanswered} onClick={() => { setFilter("unanswered"); go(run.ans.findIndex((a) => a === null)); }}><ListChecks aria-hidden="true" />Review unanswered ({unanswered})</button>
            <button type="button" className={s.btn} onClick={() => { setFilter("all"); go(0); }}>Review all</button>
          </div>
          <Nav run={run} onGo={(i) => { setFilter("all"); go(i); }} />
          <div className={s.reviewEnd}>
            <button type="button" className={s.primary} onClick={() => setEnding(true)}>End exam</button>
          </div>
        </main>
      ) : (
        <main className={s.main}>
          <div className={s.qcard}>
            <div className={s.qmeta}>
              <span>Question {run.i + 1}</span>
              {run.flags[run.i] && <span className={s.flagTag}><Flag aria-hidden="true" />Flagged</span>}
              {filter !== "all" && <span className={s.filterTag}>Reviewing {filter}</span>}
            </div>
            <h2 className={s.q} tabIndex={-1} ref={qRef}>{q.q}</h2>
            <div className={s.choices} role="radiogroup" aria-label={`Answer choices for question ${run.i + 1}`}>
              {q.c.map((c, k) => {
                const off = struck.includes(k);
                return (
                  <div key={k} className={s.choiceRow} data-struck={off ? "1" : "0"}>
                    <button type="button" role="radio" aria-checked={run.ans[run.i] === k} className={s.choice} onClick={() => pick(k)}>
                      <span className={s.radio} aria-hidden="true" />
                      <b>{L[k]}.</b><span className={s.choiceText}>{c}</span>
                    </button>
                    <button type="button" className={s.strike} aria-pressed={off} onClick={() => strike(k)} aria-label={off ? `Restore choice ${L[k]}` : `Cross out choice ${L[k]}`} title={off ? "Restore" : "Cross out"}><Slash aria-hidden="true" /></button>
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      )}

      <footer className={s.bar}>
        <button type="button" className={s.barBtn} onClick={() => step(-1)} disabled={screen === "review" || run.i === 0}><ChevronLeft aria-hidden="true" /><span>Previous</span></button>
        <button type="button" className={s.barBtn} onClick={flag} disabled={screen === "review"} aria-pressed={run.flags[run.i]}><Flag aria-hidden="true" /><span>{run.flags[run.i] ? "Unflag" : "Flag"}</span></button>
        <button type="button" className={s.barBtn} onClick={() => setGrid((v) => !v)} aria-expanded={grid}><Grid3x3 aria-hidden="true" /><span>Questions</span></button>
        <button type="button" className={s.barBtn} onClick={() => setCalc((v) => !v)} aria-expanded={calc}><CalcIcon aria-hidden="true" /><span>Calculator</span></button>
        <button type="button" className={s.barBtn} onClick={() => { setRun((r) => bank(r)); setScreen("review"); setGrid(false); }}><ListChecks aria-hidden="true" /><span>Review</span></button>
        {screen === "review"
          ? <button type="button" className={`${s.barBtn} ${s.barPrimary}`} onClick={() => setEnding(true)}><span>End exam</span></button>
          : <button type="button" className={`${s.barBtn} ${s.barPrimary}`} onClick={() => step(1)}><span>{run.i === total - 1 && filter === "all" ? "Review" : "Next"}</span><ChevronRight aria-hidden="true" /></button>}
      </footer>

      {grid && (
        <div className={s.drawer} role="dialog" aria-label="All questions">
          <div className={s.drawerTop}><b>All questions</b><button type="button" className={s.iconBtn} onClick={() => setGrid(false)} aria-label="Close">×</button></div>
          <Nav run={run} onGo={(i) => { setFilter("all"); go(i); }} />
        </div>
      )}
      {calc && <Calculator onClose={() => setCalc(false)} />}

      {ending && (
        <div className={s.modalBack}>
          <div className={s.modal} role="alertdialog" aria-modal="true" aria-labelledby="end-h" aria-describedby="end-p">
            <h2 id="end-h">End the exam?</h2>
            <p id="end-p">{unanswered ? `You have ${unanswered} unanswered question${unanswered === 1 ? "" : "s"}, which count as wrong. ` : ""}{flagged ? `${flagged} question${flagged === 1 ? " is" : "s are"} still flagged. ` : ""}Once you end it, you can&rsquo;t change any answers.{run.limit ? ` Time left: ${fmtClock(left)}.` : ""}</p>
            <div className={s.modalBtns}>
              <button type="button" className={s.btn} onClick={() => setEnding(false)} autoFocus>Keep working</button>
              <button type="button" className={s.primary} onClick={() => finish(false)}>End exam and see my score</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Nav({ run, onGo }: { run: SimRun; onGo: (i: number) => void }) {
  return (
    <>
      <div className={s.legend} aria-hidden="true">
        <span><i data-k="answered" />Answered</span><span><i data-k="open" />Unanswered</span><span><i data-k="flag" />Flagged</span><span><i data-k="current" />Current</span>
      </div>
      <ol className={s.grid}>
        {run.qs.map((_, i) => {
          const st = run.ans[i] !== null ? "answered" : "open";
          return (
            <li key={i}>
              <button type="button" onClick={() => onGo(i)} data-k={st} data-flag={run.flags[i] ? "1" : "0"} aria-current={i === run.i ? "step" : undefined}
                aria-label={`Question ${i + 1}: ${st === "answered" ? "answered" : "unanswered"}${run.flags[i] ? ", flagged" : ""}`}>{i + 1}</button>
            </li>
          );
        })}
      </ol>
    </>
  );
}
