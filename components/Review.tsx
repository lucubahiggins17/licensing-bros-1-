"use client";
// Smart Review: an adaptive 10-question session from the student's misses (spaced 1/3/7/14 days)
// and weakest topics, with every answer explained.
import { useEffect, useState } from "react";
import { RotateCcw, Volume2, MessageCircle, Play } from "lucide-react";
import { useApp, PanelHead } from "./ctx";
import { TRADES } from "@/lib/data";
import { buildReview, dueMissed, qKey, questionContext, REVIEW_DAYS, ReviewItem, scheduledMissed, weakTopics, XP } from "@/lib/progress";
import s from "./Study.module.css";

type Ans = { pick: number; ok: boolean };
const L = "ABCD";

function when(ts: number): string {
  const days = Math.max(0, Math.round((ts - Date.now()) / 864e5));
  if (days <= 0) return "later today";
  if (days === 1) return "tomorrow";
  if (days < 7) return new Date(ts).toLocaleDateString(undefined, { weekday: "long" });
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Reason({ item }: { item: ReviewItem }) {
  if (item.why === "missed") return <span className="badge warn">Missed before</span>;
  if (item.why === "weak") return <span className="badge ai">Weak topic{typeof item.pct === "number" ? ` · ${item.pct}%` : ""}</span>;
  if (item.why === "new") return <span className="badge v">New topic</span>;
  return <span className="badge">Warm-up</span>;
}

export default function Review() {
  const { p, answer, log, askTutor, talk } = useApp();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<(Ans | undefined)[]>([]);
  const [finished, setFinished] = useState(false);

  // A different trade means a different review
  useEffect(() => { setItems(null); setFinished(false); }, [p.trade]);

  const due = dueMissed(p);
  const later = scheduledMissed(p).filter((m) => m.due > Date.now());
  const nextDue = later.length ? Math.min(...later.map((m) => m.due)) : null;
  const weak = weakTopics(p, 4);

  function startSession() {
    setItems(buildReview(p, 10));
    setI(0); setAnswers([]); setFinished(false);
    window.scrollTo({ top: 0 });
  }

  function pick(k: number) {
    if (!items || answers[i]) return;
    const q = items[i].q;
    const ok = k === q.a;
    setAnswers((a) => { const next = [...a]; next[i] = { pick: k, ok }; return next; });
    answer(q, ok);
  }

  function finish() {
    if (!items) return;
    const answered = answers.filter(Boolean) as Ans[];
    if (answered.length) log("Smart Review", `${answered.filter((a) => a.ok).length}/${answered.length} correct`);
    setFinished(true);
    window.scrollTo({ top: 0 });
  }

  function explainAloud(item: ReviewItem, picked?: number | null) {
    talk({
      title: `Explaining: ${item.q.topic}`,
      context: questionContext(item.q, picked),
      initialQuestion: "Explain this question to me out loud: why the right answer is right and how to remember it on exam day."
    });
  }

  // ---------- Results ----------
  if (items && finished) {
    const answered = answers.filter(Boolean) as Ans[];
    const right = answered.filter((a) => a.ok).length;
    const xp = answered.length * XP.attempt + right * XP.correct;
    const missedNow = items.filter((_, k) => answers[k] && !answers[k]!.ok);
    return (
      <section className="panel">
        <PanelHead eyebrow="Smart Review" title="Review" accent="complete" />
        <div className="card">
          <div className={s.tiles}>
            <div className={s.tileStat}><b>{right}/{answered.length}</b><span>Correct</span></div>
            <div className={`${s.tileStat} ${s.navy}`}><b>+{xp}</b><span>XP earned</span></div>
            <div className={s.tileStat}><b>{missedNow.length}</b><span>Coming back next review</span></div>
          </div>
          <p className="note" style={{ marginTop: 12 }}>
            {missedNow.length
              ? "Questions you missed stay in your review until you get them right on the 1, 3, 7 and 14-day checks."
              : "Clean sweep. Anything you've fixed moves out to a longer interval."}
          </p>
          {missedNow.length > 0 && (
            <div className="review" style={{ marginTop: 10 }}>
              {missedNow.map((it, k) => (
                <div key={k} className="rv no">
                  <div className="eyebrow">{it.q.topic}</div>
                  <p style={{ margin: "4px 0", fontWeight: 600 }}>{it.q.q}</p>
                  <p style={{ margin: "2px 0" }}>Correct: <b>{it.q.c[it.q.a]}</b> {it.q.ref && <span className="ref">{it.q.ref}</span>}</p>
                  <button className="btn sm" style={{ marginTop: 6 }} onClick={() => explainAloud(it, answers[items.indexOf(it)]?.pick)}><Volume2 aria-hidden="true" />Explain out loud</button>
                </div>
              ))}
            </div>
          )}
          <div className={s.actions}>
            <button className="btn primary" onClick={startSession}><RotateCcw aria-hidden="true" />Another review</button>
            <button className="btn" onClick={() => { setItems(null); setFinished(false); }}>Back to overview</button>
          </div>
        </div>
      </section>
    );
  }

  // ---------- Session ----------
  if (items && items.length) {
    const it = items[i];
    const q = it.q;
    const a = answers[i];
    const key = qKey(q.q);
    const sched = p.missed[key];
    const last = i === items.length - 1;
    return (
      <section className="panel">
        <div className="card">
          <div className="qhead">
            <span className="eyebrow">Question {i + 1} of {items.length} · {q.topic} <Reason item={it} /></span>
            <button type="button" className="btn sm ghost" onClick={finish}>End review</button>
          </div>
          <div className={s.dotsRow} aria-hidden="true" style={{ margin: "10px 0" }}>
            {items.map((_, k) => <i key={k} className={answers[k] ? (answers[k]!.ok ? s.ok : s.no) : k === i ? s.now : ""} />)}
          </div>
          <p className="q">{q.q}</p>
          <div className="opts">
            {q.c.map((c, k) => (
              <button key={k} className={`opt${a && k === q.a ? " right" : ""}${a && a.pick === k && !a.ok ? " wrong" : ""}`} aria-pressed={a?.pick === k} disabled={!!a && k !== q.a && a.pick !== k} onClick={() => pick(k)}>
                <b>{L[k]}</b><span>{c}</span>
              </button>
            ))}
          </div>
          {a && (
            <div className={`${s.feedback} ${a.ok ? s.ok : s.no}`} role="status">
              <b>{a.ok ? "Correct." : "Not quite."}</b>
              <p>Answer: <b>{L[q.a]}) {q.c[q.a]}</b> {q.ref && <span className="ref">{q.ref}</span>}</p>
              {q.why && <p>{q.why}</p>}
              <p className="note">
                {!a.ok ? "This one comes back in your next review."
                  : sched && sched.box > 0 ? `Nice. Next check ${when(sched.due)} (${REVIEW_DAYS[sched.box - 1]}-day interval).`
                  : it.why === "missed" ? "Mastered. It won't come back unless you miss it again."
                  : `+${XP.attempt + XP.correct} XP.`}
              </p>
            </div>
          )}
          <div className={s.actions}>
            {a && <button className="btn" onClick={() => explainAloud(it, a.pick)}><Volume2 aria-hidden="true" />Explain out loud</button>}
            {a && (
              <button className="btn" onClick={() => askTutor(`Explain this practice question and how to find it fast in the code book:\n${q.q}\nChoices: ${q.c.map((c, k) => L[k] + ") " + c).join("; ")}\nCorrect: ${q.c[q.a]}${q.ref ? ` (${q.ref})` : ""}`)}>
                <MessageCircle aria-hidden="true" />Ask the tutor
              </button>
            )}
            <button className="btn primary" style={{ marginLeft: "auto" }} disabled={!a} onClick={() => (last ? finish() : setI(i + 1))}>{last ? "See results" : "Next"}</button>
          </div>
        </div>
      </section>
    );
  }

  // ---------- Overview ----------
  const plan = due.length
    ? `${Math.min(due.length, 7)} missed question${Math.min(due.length, 7) === 1 ? "" : "s"}${weak.length ? " plus your weakest topics" : ""}.`
    : weak.length ? "Built from your weakest topics." : "No history yet, so this is a mixed warm-up across every topic to find your weak spots.";
  return (
    <section className="panel">
      <PanelHead eyebrow="Smart Review" title="Fix what" accent="you missed"
        lede="A 10-question session built just for you. Questions you miss come back after 1, 3, 7 and 14 days until they stick, and your weakest topics fill the rest. Every answer is explained." />
      <div className="card">
        <div className={s.tiles}>
          <div className={s.tileStat}><b>{due.length}</b><span>Missed questions due</span></div>
          <div className={`${s.tileStat} ${s.navy}`}><b>{later.length}</b><span>{nextDue ? `Scheduled · next ${when(nextDue)}` : "Scheduled for later"}</span></div>
          <div className={s.tileStat}><b>{weak[0] ? `${weak[0].pct}%` : "—"}</b><span>{weak[0] ? `Weakest: ${weak[0].topic}` : "Weakest topic"}</span></div>
        </div>
        {weak.length > 0 && (
          <>
            <h3 style={{ fontSize: 18, marginTop: 16 }}>Topics to shore up · {TRADES[p.trade]}</h3>
            <div className={s.weakList}>
              {weak.map((w) => <span key={w.topic} className={s.weak}>{w.topic} <em>{w.pct}%</em></span>)}
            </div>
          </>
        )}
        <p className="note" style={{ margin: "14px 0" }}>{plan}</p>
        <button className="btn primary big" onClick={startSession}><Play aria-hidden="true" />Start 10-question review</button>
      </div>
    </section>
  );
}
