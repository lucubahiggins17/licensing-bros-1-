"use client";
// Lesson quiz: one question at a time, instant feedback with the explanation, score at the end.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ListChecks, RotateCcw, X } from "lucide-react";
import type { QuizItem } from "@/lib/types";
import { renderInline } from "./markdown";
import s from "./Lesson.module.css";

const LETTERS = "ABCDEFGH";

export default function LessonQuiz({ quiz, onFinish }: { quiz: QuizItem[]; onFinish?: (score: number, total: number) => void }) {
  const items = useMemo(
    () => (quiz || []).filter((q) => q && typeof q.q === "string" && Array.isArray(q.c) && q.c.length >= 2 && Number.isInteger(q.a) && q.a >= 0 && q.a < q.c.length),
    [quiz]
  );
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [finished, setFinished] = useState(false);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => { if (picked !== null) feedbackRef.current?.focus(); }, [picked]);
  useEffect(() => { if (started.current && !finished) questionRef.current?.focus(); }, [i, finished]);
  useEffect(() => { if (finished) resultRef.current?.focus(); }, [finished]);

  if (!items.length) return null;
  const n = items.length;
  const q = items[i];
  const score = answers.reduce((acc, a, k) => acc + (a === items[k]?.a ? 1 : 0), 0);
  const pct = Math.round((score / n) * 100);

  function pick(k: number) {
    if (picked !== null) return;
    started.current = true;
    setPicked(k);
    setAnswers((a) => { const c = [...a]; c[i] = k; return c; });
  }
  function next() {
    if (i + 1 >= n) {
      setFinished(true);
      const final = answers.reduce((acc, a, k) => acc + (a === items[k]?.a ? 1 : 0), 0);
      onFinish?.(final, n);
    } else {
      setI(i + 1);
      setPicked(null);
    }
  }
  function restart() {
    setI(0); setPicked(null); setAnswers([]); setFinished(false);
    started.current = true;
  }

  const missed = finished ? items.map((it, k) => ({ it, k, a: answers[k] })).filter((x) => x.a !== x.it.a) : [];

  return (
    <section className={`card tape ${s.quiz}`} aria-labelledby="quiz-title">
      <div className={s.quizHead}>
        <h2 id="quiz-title" className={s.h3}><ListChecks aria-hidden="true" /> Lesson quiz</h2>
        {!finished && <span className={s.quizCount}>Question {i + 1} of {n}</span>}
      </div>
      <div className="bar" aria-hidden="true"><i style={{ width: `${(finished ? 1 : (i + (picked !== null ? 1 : 0)) / n) * 100}%` }} /></div>

      {!finished ? (
        <>
          <p className="q" ref={questionRef} tabIndex={-1} dangerouslySetInnerHTML={{ __html: renderInline(q.q) }} />
          <div className="opts" role="group" aria-label="Answer choices">
            {q.c.map((choice, k) => {
              const state = picked === null ? "" : k === q.a ? "right" : k === picked ? "wrong" : "";
              return (
                <button
                  key={k}
                  className={`opt ${state} ${s.opt} ${picked !== null && !state ? s.dim : ""}`}
                  onClick={() => pick(k)}
                  aria-disabled={picked !== null}
                  aria-pressed={picked === k}
                >
                  <b>{LETTERS[k]}</b>
                  <span className={s.optText} dangerouslySetInnerHTML={{ __html: renderInline(choice) }} />
                  {state === "right" && <Check className={s.optMark} aria-label="Correct answer" />}
                  {state === "wrong" && <X className={s.optMark} aria-label="Your answer" />}
                </button>
              );
            })}
          </div>
          {picked !== null && (
            <div ref={feedbackRef} tabIndex={-1} className={`${s.feedback} ${picked === q.a ? s.fbOk : s.fbNo}`} role="status">
              <b>{picked === q.a ? "Correct!" : `Not quite. The answer is ${LETTERS[q.a]}.`}</b>
              {q.why && <p dangerouslySetInnerHTML={{ __html: renderInline(q.why) }} />}
              <button className="btn primary" onClick={next}>
                {i + 1 >= n ? "See my score" : "Next question"} <ArrowRight aria-hidden="true" />
              </button>
            </div>
          )}
        </>
      ) : (
        <div className={s.result} ref={resultRef} tabIndex={-1}>
          <div className={s.resultTop}>
            <span className={`score ${pct >= 70 ? "pass" : "fail"}`}>{score}/{n}</span>
            <div>
              <b>{pct}% correct</b>
              <p>{pct === 100 ? "Perfect score. You've got this lesson down." : pct >= 70 ? "Nice work. You know this material." : "Review the lesson and try again. You'll get it."}</p>
            </div>
          </div>
          {missed.length > 0 && (
            <div className="review">
              {missed.map(({ it, k, a }) => (
                <div key={k} className="rv no">
                  <div dangerouslySetInnerHTML={{ __html: `<b>${k + 1}.</b> ${renderInline(it.q)}` }} />
                  <div className="note">
                    You picked {LETTERS[a]}. Correct: <b>{LETTERS[it.a]}</b>, <span dangerouslySetInnerHTML={{ __html: renderInline(it.c[it.a]) }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <button className="btn" onClick={restart}><RotateCcw aria-hidden="true" /> Retake quiz</button>
        </div>
      )}
    </section>
  );
}
