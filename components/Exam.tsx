"use client";
// Mock exam: set up an exam that matches the real one (verified format from your instructors, or the numbers from your
// candidate bulletin), take it in the full-screen exam-day simulator, then get a score report like the testing center's
// plus a question-by-question review with the code references.
import { useEffect, useMemo, useState } from "react";
import { LockKeyhole, Volume2, MessageCircle, RotateCcw, ShieldCheck, Clock, Timer, PlayCircle, Trash2 } from "lucide-react";
import { useApp, TopicBar, PanelHead, AiErrorNote, ProNote, usePlan } from "./ctx";
import { useAuth, displayName } from "@/lib/auth";
import { Question, TRADES } from "@/lib/data";
import { Part, pool, questionContext, withAnswer, withExamDone, withSession } from "@/lib/progress";
import { cleanFormats, defaultMinutes, examPick, fmtClock, formatFor, loadRun, paceReport, saveRun, type SimRun, timeLeft } from "@/lib/examSim";
import { generate } from "@/lib/ai";
import { supabase } from "@/lib/supabaseClient";
import { celebrate } from "@/components/motion";
import ExamSimulator from "@/components/exam/ExamSimulator";
import type { PracticeSet } from "@/lib/types";
import s from "./Study.module.css";

type Src = "bank" | "sets" | "ai";
type Done = { run: SimRun; timedOut: boolean; secs: number };
type SetRow = Pick<PracticeSet, "id" | "title" | "trade" | "state" | "part" | "is_free"> & { questions: Question[] };
type TimeMode = "exam" | "custom" | "untimed";

const COUNTS = [10, 25, 50, 75, 100];
const PART_LABEL: Record<Part, string> = { trade: "Trade", law: "Business & Law", mix: "Trade + Business & Law" };
const L = "ABCD";

const validQ = (q: any): q is Question =>
  !!q && typeof q.q === "string" && Array.isArray(q.c) && q.c.length >= 2 && Number.isInteger(q.a) && q.a >= 0 && q.a < q.c.length;

function Seg({ value, onChange, opts, label }: { value: string; onChange: (v: any) => void; opts: [string, string][]; label: string }) {
  return <div className="seg" role="group" aria-label={label}>{opts.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}</div>;
}

export default function Exam() {
  const { p, update, askTutor, talk } = useApp();
  const { limits, paid } = usePlan();
  const { settings, profile, user } = useAuth();
  const [src, setSrc] = useState<Src>("bank");
  const [part, setPart] = useState<Part>("trade");
  const [n, setN] = useState(10);
  const [timeMode, setTimeMode] = useState<TimeMode>("exam");
  const [customMin, setCustomMin] = useState(60);
  const [passPct, setPassPct] = useState(70);
  const [run, setRun] = useState<SimRun | null>(null);
  const [saved, setSaved] = useState<SimRun | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<any>(null);
  const [sets, setSets] = useState<SetRow[] | null>(null);
  const [setsErr, setSetsErr] = useState("");
  const [setId, setSetId] = useState("");
  const [reload, setReload] = useState(0);

  const max = Math.max(1, limits.exam_max_questions || 10);
  const formats = useMemo(() => cleanFormats((settings as any)?.exam_formats), [settings]);
  const verified = formatFor(formats, p.trade, p.state, part);
  const counts = [...new Set([...COUNTS.filter((c) => c <= Math.max(max, 10)), ...(verified ? [verified.questions] : [])])].sort((a, b) => a - b);
  const available = pool(p, part).length;
  const chosenSet = sets?.find((x) => x.id === setId) || null;

  // An exam in progress on this device (closed app, refresh)
  useEffect(() => { setSaved(loadRun()); }, []);

  // The verified format sets the defaults for this section
  useEffect(() => {
    if (verified) { setN(Math.min(verified.questions, max)); setPassPct(verified.pass_pct); setTimeMode("exam"); }
    else setPassPct(70);
  }, [verified?.id, part]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (n > max) setN(Math.min(max, counts.filter((c) => c <= max).pop() || max)); }, [max]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (src === "ai" && !limits.ai_exams) setSrc("bank"); }, [limits.ai_exams, src]);

  // Licensing Bro's sets for this trade (or all trades) and this state (or every state). RLS hides sets the plan doesn't include.
  useEffect(() => {
    if (src !== "sets") return;
    let alive = true;
    setSets(null); setSetsErr("");
    (async () => {
      try {
        const { data, error } = await supabase()
          .from("practice_sets")
          .select("id,title,trade,state,part,questions,is_free,created_at")
          .eq("published", true)
          .eq("kind", "test")
          .in("trade", [p.trade, "all"])
          .or(`state.is.null,state.eq."${p.state.replace(/"/g, "")}"`)
          .order("created_at", { ascending: false })
          .limit(60);
        if (error) throw error;
        if (!alive) return;
        const list: SetRow[] = (data || [])
          .map((x: any) => ({ ...x, questions: (Array.isArray(x.questions) ? x.questions : []).filter(validQ) }))
          .filter((x: SetRow) => x.questions.length > 0);
        setSets(list);
        setSetId((cur) => (list.some((x) => x.id === cur) ? cur : list[0]?.id || ""));
      } catch {
        if (alive) { setSets([]); setSetsErr("Couldn't load Licensing Bro's sets. Check your connection and try again."); }
      }
    })();
    return () => { alive = false; };
  }, [src, p.trade, p.state, reload]);

  const count = Math.min(n, max);
  // Time limit: the verified format's pace, scaled when the exam is shorter than the real one
  const examSecs = (q: number) => verified ? Math.round((verified.minutes * 60 * q) / verified.questions) : defaultMinutes(q) * 60;
  const limitFor = (q: number) => (timeMode === "untimed" ? 0 : timeMode === "custom" ? Math.max(1, customMin) * 60 : examSecs(q));
  const fullLength = !!verified && count >= verified.questions;

  async function start() {
    setErr(null);
    let qs: Question[] = [];
    let label = "";
    if (src === "bank") {
      qs = examPick(pool(p, part), count).map((q) => ({ ...q, src: "bank" as const }));
      label = "verified bank";
    } else if (src === "sets") {
      if (!chosenSet) { setErr({ message: "Pick a set first." }); return; }
      qs = examPick(chosenSet.questions, count).map((q) => ({ ...q, src: "set" as const }));
      label = chosenSet.title;
    } else {
      if (!limits.ai_exams) return;
      setLoading(true);
      try {
        const r = await generate<{ questions: Question[] }>({ kind: "exam", state: p.state, trade: p.trade, part, n: count });
        qs = (r?.questions || []).filter(validQ).map((q) => ({ ...q, src: "ai" as const }));
      } catch (e: any) { setErr(e); setLoading(false); return; }
      setLoading(false);
      label = "AI set";
    }
    if (!qs.length) { setErr({ message: "No questions are available for that choice yet. Try another source." }); return; }
    const name = verified && fullLength ? verified.name : `${p.state} ${TRADES[p.trade]} · ${PART_LABEL[part]}${verified && !fullLength ? " (shortened)" : ""}`;
    const r: SimRun = {
      v: 1, qs, ans: Array(qs.length).fill(null), flags: Array(qs.length).fill(false), struck: qs.map(() => []), spent: Array(qs.length).fill(0),
      i: 0, t0: null, limit: limitFor(qs.length), passPct, name, verified: !!verified && timeMode === "exam", src, label, leaves: 0
    };
    saveRun(r);
    setSaved(null); setDone(null); setRun(r);
  }

  function score(r: SimRun, timedOut: boolean) {
    const right = r.qs.filter((q, i) => r.ans[i] === q.a).length;
    const pct = Math.round((100 * right) / r.qs.length);
    update((prev) => {
      let next = prev;
      r.qs.forEach((q, i) => { next = withAnswer(next, q, r.ans[i] === q.a); });
      if (r.src === "ai") {
        const known = new Set(next.extraBank.map((b) => b.q));
        next = { ...next, extraBank: [...next.extraBank, ...r.qs.filter((q) => !known.has(q.q))].slice(-300) };
      }
      return withSession(withExamDone(next), "Mock exam", `${pct}% · ${right}/${r.qs.length} · ${pct >= r.passPct ? "pass" : "below passing"} · ${r.label}`);
    });
    const secs = r.t0 ? Math.min(r.limit || Infinity, Math.floor((Date.now() - r.t0) / 1000)) : 0;
    setDone({ run: r, timedOut, secs });
    setRun(null); setSaved(null);
    window.scrollTo({ top: 0 });
    if (pct >= r.passPct) setTimeout(celebrate, 300);
  }

  function resume() {
    const r = saved;
    if (!r) return;
    if (r.t0 && r.limit && timeLeft(r) <= 0) { saveRun(null); score(r, true); return; }
    setRun(r); setSaved(null);
  }

  const candidate = displayName(profile, user);
  if (run) return <ExamSimulator initial={run} candidate={candidate} onFinish={score} onQuit={() => { saveRun(null); setRun(null); }} />;

  if (done) return <ScoreReport done={done} onNew={() => setDone(null)} askTutor={askTutor} talk={talk} />;

  const srcOpts: { k: Src; title: string; desc: string; lockedOut?: boolean }[] = [
    { k: "bank", title: "Verified bank", desc: `${available} checked questions for ${TRADES[p.trade]}, spread across topics like the real exam.` },
    { k: "sets", title: "Licensing Bro’s sets", desc: `Practice sets from our instructors for ${TRADES[p.trade]} and ${p.state}.` },
    { k: "ai", title: "AI for my state", desc: `Fresh questions aimed at the ${p.state} exam, each with a code citation.`, lockedOut: !limits.ai_exams }
  ];
  const limitSecs = limitFor(count);

  return (
    <section className="panel">
      <PanelHead eyebrow="Mock Exam" title="Exam-day" accent="simulator"
        lede="A full-screen test that works like the computer-based exam at the testing center: the real time limit, flag for review, cross out choices, the on-screen calculator, a review screen before you end, and no answers until it's scored." />

      {saved && (
        <div className={`card ${s.resume}`} role="status">
          <PlayCircle aria-hidden="true" />
          <div>
            <b>You have an exam in progress</b>
            <span>{saved.name} · {saved.ans.filter((a) => a !== null).length} of {saved.qs.length} answered{saved.t0 && saved.limit ? ` · ${timeLeft(saved) > 0 ? `${fmtClock(timeLeft(saved))} left` : "time ran out"}` : ""}</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn primary" onClick={resume}>{saved.t0 && saved.limit && timeLeft(saved) <= 0 ? "See my score" : "Resume"}</button>
            <button type="button" className="btn ghost" onClick={() => { saveRun(null); setSaved(null); }} aria-label="Discard the exam in progress"><Trash2 aria-hidden="true" /></button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="eyebrow" id="src-label">Question source</div>
        <div className={s.srcGrid} role="radiogroup" aria-labelledby="src-label">
          {srcOpts.map((o) => (
            <button key={o.k} type="button" role="radio" aria-checked={src === o.k} className={s.srcCard} disabled={o.lockedOut}
              onClick={() => { setSrc(o.k); setErr(null); }}>
              <b>{o.title}</b>
              <span>{o.desc}</span>
              {o.lockedOut && <em className={s.lockTag}><LockKeyhole aria-hidden="true" />Pro</em>}
            </button>
          ))}
        </div>
        {!limits.ai_exams && <ProNote>AI-written exams for {p.state} come with any paid course. The verified bank and free sets stay free.</ProNote>}

        <div className={s.optRow}>
          {src !== "sets" && (
            <div><div className="eyebrow" style={{ marginBottom: 4 }}>Section</div><Seg label="Section" value={part} onChange={setPart} opts={[["trade", "Trade"], ["law", "Business & Law"], ["mix", "Both"]]} /></div>
          )}
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Questions</div>
            <div className="seg" role="group" aria-label="Number of questions">
              {counts.map((c) => {
                const isLocked = c > max;
                return (
                  <button key={c} type="button" aria-pressed={count === c} disabled={isLocked} onClick={() => setN(c)} aria-label={isLocked ? `${c} questions (Pro)` : `${c} questions`}>
                    <span className={s.segLock}>{isLocked && <LockKeyhole aria-hidden="true" />}{c}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {counts.some((c) => c > max) && !paid && <ProNote>Your plan allows {max}-question exams. Pro unlocks full-length exams{verified ? ` (${verified.questions} questions, like the real ${verified.name})` : ""}.</ProNote>}

        <div className={s.format}>
          <div className={s.formatHead}>
            {verified ? <><ShieldCheck aria-hidden="true" /><b>Real exam format</b><span>{verified.name}: {verified.questions} questions in {verified.minutes} minutes, {verified.pass_pct}% to pass. Verified by your instructors{verified.notes ? `. ${verified.notes}` : "."}</span></>
              : <><Clock aria-hidden="true" /><b>Exam format</b><span>Your instructors haven&rsquo;t posted the verified format for the {p.state} {PART_LABEL[part]} exam yet. Times below are typical for open-book licensing exams; set the numbers from your candidate bulletin so practice matches test day.</span></>}
          </div>
          <div className={s.formatRow}>
            <label className="field">Time limit
              <select value={timeMode} onChange={(e) => setTimeMode(e.target.value as TimeMode)}>
                <option value="exam">{verified ? "Real exam pace" : "Typical exam pace"} ({fmtClock(examSecs(count))})</option>
                <option value="custom">Set my own</option>
                <option value="untimed">Untimed (practice)</option>
              </select>
            </label>
            {timeMode === "custom" && (
              <label className="field">Minutes
                <input type="number" min={5} max={600} value={customMin} onChange={(e) => setCustomMin(Math.max(5, Math.min(600, Number(e.target.value) || 5)))} />
              </label>
            )}
            <label className="field">Passing score
              <select value={passPct} onChange={(e) => setPassPct(Number(e.target.value))}>
                {[60, 65, 70, 72, 75, 80].map((v) => <option key={v} value={v}>{v}%</option>)}
              </select>
            </label>
          </div>
          {verified && !fullLength && <p className="note" style={{ margin: "6px 0 0" }}>Shorter than the real exam, so the time limit is scaled to the same pace per question.</p>}
        </div>

        <div style={{ margin: "14px 0" }}>
          {src === "bank" && (
            <p className="note" style={{ margin: 0 }}>
              <span className="badge v">Verified</span> {available} questions for {TRADES[p.trade]}{count > available ? `, so this exam will use all ${available}` : ""}. <Timer aria-hidden="true" style={{ width: 14, height: 14, verticalAlign: -2 }} /> {limitSecs ? `${fmtClock(limitSecs)} on the clock.` : "No time limit."}
            </p>
          )}
          {src === "ai" && (
            <p className="note" style={{ margin: 0 }}><span className="badge ai">AI</span> Writes {count} new questions aimed at the {p.state} {TRADES[p.trade]} exam, each with a code citation. Takes 30 to 90 seconds.</p>
          )}
          {src === "sets" && (
            <>
              {sets === null && !setsErr && <p className="note row" style={{ margin: 0 }}><span className="spin" aria-hidden="true" />Loading sets…</p>}
              {setsErr && <p className="err" style={{ margin: 0 }}>{setsErr} <button type="button" className="btn sm" onClick={() => setReload((x) => x + 1)}>Try again</button></p>}
              {sets && !setsErr && !sets.length && (
                <p className="empty" style={{ margin: 0 }}>No Licensing Bro&rsquo;s sets for {TRADES[p.trade]} in {p.state} yet. The verified bank is ready in the meantime.</p>
              )}
              {sets && sets.length > 0 && (
                <div className={s.sets} role="radiogroup" aria-label="Practice sets">
                  {sets.map((x) => (
                    <button key={x.id} type="button" role="radio" aria-checked={setId === x.id} className={s.setItem} onClick={() => setSetId(x.id)}>
                      <span>
                        <b>{x.title}</b>
                        <small>{x.questions.length} questions · {PART_LABEL[x.part as Part] || "Mixed"} · {x.state || "All states"}</small>
                      </span>
                      {x.is_free && <span className="badge free">Free</span>}
                    </button>
                  ))}
                </div>
              )}
              {chosenSet && <p className="note" style={{ margin: "10px 0 0" }}>This exam uses {Math.min(count, chosenSet.questions.length)} of the set&rsquo;s {chosenSet.questions.length} questions. {limitSecs ? `${fmtClock(limitFor(Math.min(count, chosenSet.questions.length)))} on the clock.` : "No time limit."}</p>}
              {!limits.practice_sets && sets !== null && !setsErr && <ProNote>Free sets are shown. Any paid course unlocks every Licensing Bro&rsquo;s set.</ProNote>}
            </>
          )}
        </div>
        {err && (err.code ? <div style={{ marginBottom: 12 }}><AiErrorNote error={err} onRetry={start} /></div> : <p className="err">{err.message}</p>)}
        <button className="btn primary big" onClick={start} disabled={loading || (src === "sets" && !chosenSet)}>{loading ? "Writing your exam…" : "Go to the exam"}</button>
      </div>
    </section>
  );
}

function ScoreReport({ done, onNew, askTutor, talk }: { done: Done; onNew: () => void; askTutor: (t: string) => void; talk: (o?: any) => void }) {
  const r = done.run;
  const right = r.qs.filter((q, i) => r.ans[i] === q.a).length;
  const pct = Math.round((100 * right) / r.qs.length), pass = pct >= r.passPct;
  const byT: Record<string, { c: number; a: number }> = {};
  r.qs.forEach((q, i) => { const t = (byT[q.topic] ||= { c: 0, a: 0 }); t.a++; if (r.ans[i] === q.a) t.c++; });
  const missed = r.qs.filter((q, i) => r.ans[i] !== q.a);
  const pace = paceReport(r);
  const xp = r.qs.length * 2 + right * 10 + 50;
  const need = Math.ceil((r.passPct / 100) * r.qs.length);
  return (
    <section className="panel">
      <div className="card">
        <div className={s.report} data-pass={pass ? "1" : "0"}>
          <div className={s.reportMain}>
            <span className="eyebrow">Score report · {r.name}</span>
            <div className={s.verdict}>{pass ? "PASS" : "NOT YET"}</div>
            <p className={s.reportLine}>You scored <b>{pct}%</b> ({right} of {r.qs.length}). Passing is {r.passPct}% ({need} correct){pass ? "." : `, so ${need - right} more correct would have passed.`}</p>
            {done.timedOut && <p className={s.reportWarn}>Time ran out and the exam was scored automatically, like at the testing center.</p>}
          </div>
          <div className="stat">
            <div><b>{fmtClock(done.secs)}</b><span>{r.limit ? `of ${fmtClock(r.limit)}` : "Time used"}</span></div>
            <div><b>{fmtClock(pace.avg)}</b><span>Per question{pace.allowed ? ` (pace ${fmtClock(pace.allowed)})` : ""}</span></div>
            <div><b>{pace.unanswered}</b><span>Unanswered</span></div>
            <div><b>+{xp}</b><span>XP earned</span></div>
          </div>
        </div>
        {(pace.allowed > 0 && pace.avg > pace.allowed) && <p className="note">You ran behind the pace you&rsquo;ll need on test day. Your slowest topics: {pace.slowest.map((x) => `${x.topic} (${fmtClock(x.avg)} each)`).join(", ")}. Tabbing those sections in your code book is the fastest fix.</p>}
        {r.leaves > 0 && <p className="note">You left the exam screen {r.leaves} time{r.leaves === 1 ? "" : "s"}. At the testing center you can&rsquo;t, so practice staying on it start to finish.</p>}
        <h3 style={{ fontSize: 22, marginTop: 18 }}>By topic</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {Object.entries(byT).sort((a, b) => a[1].c / a[1].a - b[1].c / b[1].a).map(([k, v]) => <TopicBar key={k} name={k} {...v} />)}
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={onNew}>New exam</button>
          {missed.length > 0 && (
            <a className="btn" href="#review" onClick={() => window.scrollTo({ top: 0 })}><RotateCcw aria-hidden="true" />Fix my {missed.length} misses in Smart Review</a>
          )}
          <button className="btn" onClick={() => askTutor(missed.length
            ? "I missed these on my mock exam. Teach me the concepts behind them and where to find each in the book:\n" + missed.slice(0, 6).map((q) => `- ${q.q} (Correct: ${q.c[q.a]}, ${q.ref})`).join("\n")
            : "I aced my mock exam. Give me 3 harder questions on my trade.")}>Ask tutor about my misses</button>
        </div>
        <h3 style={{ fontSize: 22, marginTop: 18 }}>Review</h3>
        <div className="review">
          {r.qs.map((q, i) => {
            const ok = r.ans[i] === q.a;
            return (
              <div key={i} className={`rv ${ok ? "ok" : "no"}`}>
                <div className="eyebrow">{i + 1}. {q.topic} · {ok ? "Correct" : r.ans[i] === null ? "Unanswered" : "Missed"}{r.flags[i] ? " · you flagged this" : ""}{r.spent[i] ? ` · ${fmtClock(r.spent[i])}` : ""}</div>
                <p style={{ margin: "4px 0", fontWeight: 600 }}>{q.q}</p>
                {!ok && <p className="note" style={{ margin: "2px 0" }}>Your answer: {r.ans[i] === null ? "none" : q.c[r.ans[i] as number]}</p>}
                <p style={{ margin: "2px 0" }}>Correct: <b>{q.c[q.a]}</b> {q.ref && <span className="ref">{q.ref}</span>}</p>
                {q.why && <p className="note" style={{ margin: "2px 0" }}>{q.why}</p>}
                <div className="row" style={{ gap: 8, marginTop: 6 }}>
                  <button className="btn sm" onClick={() => talk({ title: `Explaining question ${i + 1}: ${q.topic}`, context: questionContext(q, r.ans[i]), initialQuestion: "Explain this question to me out loud: why the right answer is right, why my pick was wrong if I missed it, and how to find it fast in the book." })}>
                    <Volume2 aria-hidden="true" />Explain out loud
                  </button>
                  <button className="btn sm" onClick={() => askTutor(`Explain this practice question and how to find it fast in the code book:\n${q.q}\nChoices: ${q.c.map((c, k) => L[k] + ") " + c).join("; ")}\nCorrect: ${q.c[q.a]} (${q.ref})`)}>
                    <MessageCircle aria-hidden="true" />Explain in chat
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
