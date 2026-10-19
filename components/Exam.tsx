"use client";
import { useEffect, useRef, useState } from "react";
import { LockKeyhole, Volume2, MessageCircle, RotateCcw } from "lucide-react";
import { useApp, TopicBar, PanelHead, AiErrorNote, ProNote, usePlan } from "./ctx";
import { Question, TRADES } from "@/lib/data";
import { fmtTime, Part, pool, questionContext, shuffle, withAnswer, withExamDone, withSession } from "@/lib/progress";
import { generate } from "@/lib/ai";
import { supabase } from "@/lib/supabaseClient";
import type { PracticeSet } from "@/lib/types";
import s from "./Study.module.css";

type Src = "bank" | "sets" | "ai";
type Run = { qs: Question[]; ans: (number | null)[]; flags: boolean[]; i: number; t0: number; limit: number; src: Src; label: string };
type Done = { qs: Question[]; ans: (number | null)[]; secs: number; src: Src; label: string };
type SetRow = Pick<PracticeSet, "id" | "title" | "trade" | "state" | "part" | "is_free"> & { questions: Question[] };

const COUNTS = [10, 25, 50];
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
  const [src, setSrc] = useState<Src>("bank");
  const [part, setPart] = useState<Part>("trade");
  const [n, setN] = useState(10);
  const [run, setRun] = useState<Run | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<any>(null);
  const [now, setNow] = useState(Date.now());
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [sets, setSets] = useState<SetRow[] | null>(null);
  const [setsErr, setSetsErr] = useState("");
  const [setId, setSetId] = useState("");
  const [reload, setReload] = useState(0);
  const runRef = useRef<Run | null>(null);
  runRef.current = run;

  const max = Math.max(1, limits.exam_max_questions || 10);
  const allowed = COUNTS.filter((c) => c <= max);
  const counts = allowed.length ? COUNTS : [max];
  const locked = COUNTS.filter((c) => c > max);
  const available = pool(p, part).length;
  const chosenSet = sets?.find((x) => x.id === setId) || null;

  // Keep choices inside the plan
  useEffect(() => { if (n > max) setN(allowed.length ? allowed[allowed.length - 1] : max); }, [max]); // eslint-disable-line react-hooks/exhaustive-deps
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

  useEffect(() => {
    if (!run) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [run]);

  const left = run ? Math.max(0, run.limit - Math.floor((now - run.t0) / 1000)) : 0;
  useEffect(() => { if (run && left <= 0) finish(); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setErr(null);
    const count = Math.min(n, max);
    let qs: Question[] = [];
    let label = "";
    if (src === "bank") {
      qs = shuffle(pool(p, part)).slice(0, count).map((q) => ({ ...q, src: "bank" as const }));
      label = "verified bank";
    } else if (src === "sets") {
      if (!chosenSet) { setErr({ message: "Pick a set first." }); return; }
      qs = shuffle(chosenSet.questions).slice(0, count).map((q) => ({ ...q, src: "set" as const }));
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
    setDone(null); setConfirmEnd(false);
    setRun({ qs, ans: Array(qs.length).fill(null), flags: Array(qs.length).fill(false), i: 0, t0: Date.now(), limit: Math.round(qs.length * 108), src, label });
    setNow(Date.now());
    window.scrollTo({ top: 0 });
  }

  function finish() {
    const r = runRef.current; if (!r) return;
    const right = r.qs.filter((q, i) => r.ans[i] === q.a).length;
    const pct = Math.round((100 * right) / r.qs.length);
    update((prev) => {
      let next = prev;
      r.qs.forEach((q, i) => { next = withAnswer(next, q, r.ans[i] === q.a); });
      if (r.src === "ai") {
        const known = new Set(next.extraBank.map((b) => b.q));
        next = { ...next, extraBank: [...next.extraBank, ...r.qs.filter((q) => !known.has(q.q))].slice(-300) };
      }
      return withSession(withExamDone(next), "Mock exam", `${pct}% · ${right}/${r.qs.length} · ${r.label}`);
    });
    setDone({ qs: r.qs, ans: r.ans, secs: Math.floor((Date.now() - r.t0) / 1000), src: r.src, label: r.label });
    setRun(null);
    window.scrollTo({ top: 0 });
  }

  const setRunP = (f: (r: Run) => Run) => setRun((r) => (r ? f(r) : r));
  const srcBadge = (q: Question) => q.src === "ai" ? <span className="badge ai">AI</span> : q.src === "set" ? <span className="badge paid">Bro&rsquo;s set</span> : <span className="badge v">Verified</span>;

  if (run) {
    const q = run.qs[run.i], total = run.qs.length;
    return (
      <section className="panel">
        <div className="card">
          <div className="qhead">
            <span className="eyebrow">Question {run.i + 1} of {total} · {q.topic} {srcBadge(q)}</span>
            <span className="timer" aria-label="Time left">{fmtTime(left)}</span>
          </div>
          <div className="bar" style={{ margin: "10px 0" }}><i style={{ width: `${(run.i / total) * 100}%` }} /></div>
          <p className="q">{q.q}</p>
          <div className="opts">
            {q.c.map((c, k) => (
              <button key={k} className="opt" aria-pressed={run.ans[run.i] === k}
                onClick={() => setRunP((r) => { const ans = [...r.ans]; ans[r.i] = k; return { ...r, ans }; })}>
                <b>{L[k]}</b><span>{c}</span>
              </button>
            ))}
          </div>
          <div className={s.examFoot}>
            <div>
              <button className="btn" disabled={!run.i} onClick={() => setRunP((r) => ({ ...r, i: r.i - 1 }))}>Back</button>
              <button className="btn" onClick={() => setRunP((r) => { const flags = [...r.flags]; flags[r.i] = !flags[r.i]; return { ...r, flags }; })}>{run.flags[run.i] ? "Unflag" : "Flag"}</button>
            </div>
            <div>
              <button className="btn" onClick={() => (confirmEnd ? finish() : setConfirmEnd(true))}>{confirmEnd ? "Tap again to end" : "End exam"}</button>
              <button className="btn primary" onClick={() => (run.i === total - 1 ? finish() : setRunP((r) => ({ ...r, i: r.i + 1 })))}>{run.i === total - 1 ? "Finish" : "Next"}</button>
            </div>
          </div>
          <p className="note" style={{ marginTop: 8 }}>
            {run.ans.filter((a) => a !== null).length} of {total} answered · {run.flags.filter(Boolean).length} flagged
          </p>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            {run.qs.map((_, i) => (
              <button key={i} className="btn sm" aria-label={`Go to question ${i + 1}`} aria-current={i === run.i ? "step" : undefined} onClick={() => setRunP((r) => ({ ...r, i }))}
                style={{ minWidth: 36, background: i === run.i ? "var(--navy)" : run.flags[i] ? "var(--accent-soft)" : run.ans[i] !== null ? "var(--ok-soft)" : undefined, color: i === run.i ? "#fff" : undefined }}>{i + 1}</button>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (done) {
    const right = done.qs.filter((q, i) => done.ans[i] === q.a).length;
    const pct = Math.round((100 * right) / done.qs.length), pass = pct >= 70;
    const byT: Record<string, { c: number; a: number }> = {};
    done.qs.forEach((q, i) => { const t = (byT[q.topic] ||= { c: 0, a: 0 }); t.a++; if (done.ans[i] === q.a) t.c++; });
    const missed = done.qs.filter((q, i) => done.ans[i] !== q.a);
    const xp = done.qs.length * 2 + right * 10 + 50;
    return (
      <section className="panel">
        <div className="card">
          <div className="row" style={{ gap: 20, alignItems: "flex-end" }}>
            <div><div className="eyebrow">Score</div><div className={`score ${pass ? "pass" : "fail"}`}>{pct}%</div></div>
            <div className="stat">
              <div><b>{right}/{done.qs.length}</b><span>Correct</span></div>
              <div><b>{fmtTime(done.secs)}</b><span>Time</span></div>
              <div><b>+{xp}</b><span>XP earned</span></div>
              <div><b>{pass ? "Pass" : "Below 70"}</b><span>Most states pass at 70%</span></div>
            </div>
          </div>
          <h3 style={{ fontSize: 22, marginTop: 18 }}>By topic</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {Object.entries(byT).map(([k, v]) => <TopicBar key={k} name={k} {...v} />)}
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn primary" onClick={() => setDone(null)}>New exam</button>
            {missed.length > 0 && (
              <a className="btn" href="#review" onClick={() => window.scrollTo({ top: 0 })}><RotateCcw aria-hidden="true" />Fix my {missed.length} misses in Smart Review</a>
            )}
            <button className="btn" onClick={() => askTutor(missed.length
              ? "I missed these on my mock exam. Teach me the concepts behind them and where to find each in the book:\n" + missed.slice(0, 6).map((q) => `- ${q.q} (Correct: ${q.c[q.a]}, ${q.ref})`).join("\n")
              : "I aced my mock exam. Give me 3 harder questions on my trade.")}>Ask tutor about my misses</button>
          </div>
          <h3 style={{ fontSize: 22, marginTop: 18 }}>Review</h3>
          <div className="review">
            {done.qs.map((q, i) => {
              const ok = done.ans[i] === q.a;
              return (
                <div key={i} className={`rv ${ok ? "ok" : "no"}`}>
                  <div className="eyebrow">{i + 1}. {q.topic} · {ok ? "Correct" : done.ans[i] === null ? "Skipped" : "Missed"}</div>
                  <p style={{ margin: "4px 0", fontWeight: 600 }}>{q.q}</p>
                  {!ok && <p className="note" style={{ margin: "2px 0" }}>Your answer: {done.ans[i] === null ? "none" : q.c[done.ans[i] as number]}</p>}
                  <p style={{ margin: "2px 0" }}>Correct: <b>{q.c[q.a]}</b> {q.ref && <span className="ref">{q.ref}</span>}</p>
                  {q.why && <p className="note" style={{ margin: "2px 0" }}>{q.why}</p>}
                  <div className="row" style={{ gap: 8, marginTop: 6 }}>
                    <button className="btn sm" onClick={() => talk({ title: `Explaining question ${i + 1}: ${q.topic}`, context: questionContext(q, done.ans[i]), initialQuestion: "Explain this question to me out loud: why the right answer is right, why my pick was wrong if I missed it, and how to find it fast in the book." })}>
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

  const count = Math.min(n, max);
  const srcOpts: { k: Src; title: string; desc: string; lockedOut?: boolean }[] = [
    { k: "bank", title: "Verified bank", desc: `${available} checked questions for ${TRADES[p.trade]}. Starts instantly.` },
    { k: "sets", title: "Licensing Bro’s sets", desc: `Practice sets from our instructors for ${TRADES[p.trade]} and ${p.state}.` },
    { k: "ai", title: "AI for my state", desc: `Fresh questions aimed at the ${p.state} exam, each with a code citation.`, lockedOut: !limits.ai_exams }
  ];

  return (
    <section className="panel">
      <PanelHead eyebrow="Mock Exam" title="Timed" accent="mock exam"
        lede="Run the verified question bank instantly, take a Licensing Bro's practice set, or have the AI write a fresh set aimed at your state. Every answer comes with its code reference." />
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
        {locked.length > 0 && !paid && <ProNote>Pro unlocks {locked.join(" and ")}-question exams.</ProNote>}

        <div style={{ margin: "14px 0" }}>
          {src === "bank" && (
            <p className="note" style={{ margin: 0 }}>
              <span className="badge v">Verified</span> {available} questions for {TRADES[p.trade]}{count > available ? `, so this exam will use all ${available}` : ""}. About {Math.round(Math.min(count, available) * 1.8)} minutes. Questions you take from AI sets are added here too.
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
              {chosenSet && <p className="note" style={{ margin: "10px 0 0" }}>This exam uses {Math.min(count, chosenSet.questions.length)} of the set&rsquo;s {chosenSet.questions.length} questions in random order. About {Math.round(Math.min(count, chosenSet.questions.length) * 1.8)} minutes.</p>}
              {!limits.practice_sets && sets !== null && !setsErr && <ProNote>Free sets are shown. Any paid course unlocks every Licensing Bro&rsquo;s set.</ProNote>}
            </>
          )}
        </div>
        {err && (err.code ? <div style={{ marginBottom: 12 }}><AiErrorNote error={err} onRetry={start} /></div> : <p className="err">{err.message}</p>)}
        <button className="btn primary big" onClick={start} disabled={loading || (src === "sets" && !chosenSet)}>{loading ? "Writing your exam…" : "Start exam"}</button>
      </div>
    </section>
  );
}
