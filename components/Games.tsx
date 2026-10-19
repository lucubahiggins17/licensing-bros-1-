"use client";
import { useEffect, useRef, useState } from "react";
import { useApp, PanelHead, AiErrorNote, ProNote, usePlan } from "./ctx";
import { Pair, Question, TRADES } from "@/lib/data";
import { pairsFor, pool, shuffle } from "@/lib/progress";
import { generate } from "@/lib/ai";
import { usePublishedSets, type GameDeck, type TestSet } from "./usePublishedSets";
import s from "./Study.module.css";

export default function Games() {
  const [game, setGame] = useState<"match" | "speed" | "calc">("match");
  const [seed, setSeed] = useState(0);
  const { p } = useApp();
  const { limits } = usePlan();
  const decks = usePublishedSets("game", p.trade, p.state, game === "match");
  const tests = usePublishedSets("test", p.trade, p.state, game === "speed");
  const [deckId, setDeckId] = useState("");
  const [testId, setTestId] = useState("");
  const deck = decks.sets?.find((d) => d.id === deckId) || null;
  const test = tests.sets?.find((t) => t.id === testId) || null;
  // Forget a choice that no longer applies (e.g. after switching trade or state)
  useEffect(() => { if (decks.sets && deckId && !deck) setDeckId(""); }, [decks.sets, deckId, deck]);
  useEffect(() => { if (tests.sets && testId && !test) setTestId(""); }, [tests.sets, testId, test]);

  return (
    <section className="panel">
      <PanelHead eyebrow="Games" title="Drills" accent="that stick" lede="Short games where every answer counts toward your readiness score, your streak and your XP." />
      <div className="gamepick">
        {([["match", "Code Match", "Pair each term with its meaning. Fewest moves wins."],
           ["speed", "Speed Round", "60 seconds. Streaks multiply your points."],
           ["calc", "Calc Sprint", "Fresh field math every round: Ohm's law, BTUs, markup, slope."]] as const).map(([k, h, d]) => (
          <button key={k} className="gp" aria-pressed={game === k} onClick={() => { setGame(k); setSeed((x) => x + 1); }}>
            <h3>{h}</h3><p className="note" style={{ margin: "4px 0 0" }}>{d}</p>
          </button>
        ))}
      </div>
      {game === "match" && (
        <SourcePicker id="deckPick" label="Deck" value={deckId} onChange={setDeckId} err={decks.err} onRetry={decks.retry} loading={!decks.sets}
          base={`Mixed ${TRADES[p.trade]} terms`} options={(decks.sets || []).map((d) => [d.id, `${d.title} · ${d.pairs.length} cards`, d.is_free])}
          locked={!limits.practice_sets} lockedText="Free decks are shown. Any paid course unlocks every Licensing Bro’s game deck." />
      )}
      {game === "speed" && (
        <SourcePicker id="testPick" label="Questions" value={testId} onChange={setTestId} err={tests.err} onRetry={tests.retry} loading={!tests.sets}
          base="Verified question bank (mixed)" options={(tests.sets || []).map((t) => [t.id, `${t.title} · ${t.questions.length} questions`, t.is_free])}
          locked={!limits.practice_sets} lockedText="Free practice tests are shown. Any paid course unlocks every Licensing Bro’s test." />
      )}
      <div className="card" key={`${game}-${seed}-${p.trade}-${deckId}-${testId}`}>
        {game === "match" ? <Match deck={deck} /> : game === "speed" ? <Speed test={test} /> : <CalcSprint />}
      </div>
    </section>
  );
}

/** Choose where a game's cards or questions come from: the built-in set or a deck/test the instructors published. */
function SourcePicker({ id, label, value, onChange, base, options, loading, err, onRetry, locked, lockedText }: {
  id: string; label: string; value: string; onChange: (v: string) => void; base: string; options: [string, string, boolean][];
  loading: boolean; err: string; onRetry: () => void; locked: boolean; lockedText: string;
}) {
  if (loading) return null;
  if (err) return <p className="note" style={{ margin: "12px 0 0" }}>{err} <button className="btn sm" onClick={onRetry}>Try again</button></p>;
  if (!options.length && !locked) return null;
  return (
    <div className={s.srcPick}>
      {options.length > 0 && (
        <>
          <label htmlFor={id} className={s.srcLabel}>{label}</label>
          <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">{base}</option>
            <optgroup label="From Licensing Bro’s instructors">
              {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </optgroup>
          </select>
        </>
      )}
      {locked && <div className={s.srcNote}><ProNote>{lockedText}</ProNote></div>}
    </div>
  );
}

function Match({ deck }: { deck: GameDeck | null }) {
  const { p, update, record, log } = useApp();
  const queue = useRef<Pair[]>([]);
  // Mixed: 6 random terms. A deck: works through the whole deck 6 at a time before repeating.
  function draw(): Pair[] {
    if (!deck) return shuffle(pairsFor(p)).slice(0, 6);
    const n = Math.min(6, deck.pairs.length);
    let out = queue.current.splice(0, n);
    if (out.length < n) {
      out = [...out, ...shuffle(deck.pairs.filter((x) => !out.includes(x))).slice(0, n - out.length)];
      queue.current = shuffle(deck.pairs.filter((x) => !out.includes(x)));
    }
    return out;
  }
  const [set, setSet] = useState<Pair[]>(() => draw());
  const [order, setOrder] = useState(() => ({ terms: shuffle(set.map((_, i) => i)), defs: shuffle(set.map((_, i) => i)) }));
  const [sel, setSel] = useState<{ kind: "t" | "d"; i: number } | null>(null);
  const [done, setDone] = useState<number[]>([]);
  const [miss, setMiss] = useState<string[]>([]);
  const [moves, setMoves] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<any>(null);
  const t0 = useRef(Date.now());
  const bestKey = deck ? `match_deck_${deck.id}` : "match_" + p.trade;

  function reset(newSet: Pair[]) {
    setSet(newSet); setOrder({ terms: shuffle(newSet.map((_, i) => i)), defs: shuffle(newSet.map((_, i) => i)) });
    setSel(null); setDone([]); setMoves(0); setMsg(null); t0.current = Date.now();
  }

  function tap(kind: "t" | "d", i: number) {
    if (done.includes(i)) return;
    if (!sel || sel.kind === kind) { setSel({ kind, i }); return; }
    const m = moves + 1; setMoves(m);
    if (sel.i === i) {
      const d = [...done, i]; setDone(d); record("Terms & definitions", true);
      if (d.length === set.length) {
        update((prev) => ({ ...prev, best: { ...prev.best, [bestKey]: prev.best[bestKey] ? Math.min(prev.best[bestKey], m) : m } }));
        log("Code Match", `${deck ? deck.title + " · " : ""}${m} moves · ${Math.round((Date.now() - t0.current) / 1000)}s`);
      }
    } else {
      record("Terms & definitions", false);
      const ids = [`t${sel.kind === "t" ? sel.i : i}`, `d${sel.kind === "d" ? sel.i : i}`];
      setMiss(ids); setTimeout(() => setMiss([]), 320);
    }
    setSel(null);
  }

  async function aiSet() {
    setBusy(true); setMsg(null);
    try {
      const r = await generate<{ pairs: Pair[] }>({ kind: "pairs", count: 6, state: p.state, trade: p.trade, avoid: pairsFor(p).map((x) => x.k) });
      update((prev) => ({ ...prev, extraPairs: [...prev.extraPairs, ...r.pairs].slice(-200) }));
      reset(r.pairs.slice(0, 6));
    } catch (e: any) { setMsg(e); }
    setBusy(false);
  }

  const cleared = done.length === set.length;
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="stat">
          <div><b>{moves}</b><span>Moves</span></div>
          <div><b>{done.length}/{set.length}</b><span>Matched</span></div>
          <div><b>{p.best[bestKey] ?? "—"}</b><span>Best</span></div>
        </div>
        <div className="row">
          <button className="btn sm" onClick={() => reset(draw())}>New set</button>
          {!deck && <button className="btn sm" onClick={aiSet} disabled={busy}>{busy ? "Generating…" : "AI set"}</button>}
        </div>
      </div>
      <p className="note">{deck ? <><b>{deck.title}</b>{deck.topic ? ` · ${deck.topic}` : ""} · {deck.pairs.length} cards. </> : null}Tap a term on the left, then its meaning on the right.</p>
      <div className="match">
        {order.terms.map((ti, row) => {
          const di = order.defs[row];
          return [
            <button key={`t${ti}`} className={`tile term${done.includes(ti) ? " done" : ""}${sel?.kind === "t" && sel.i === ti ? " sel" : ""}${miss.includes(`t${ti}`) ? " miss" : ""}`} onClick={() => tap("t", ti)}>{set[ti]?.k}</button>,
            <button key={`d${di}`} className={`tile${done.includes(di) ? " done" : ""}${sel?.kind === "d" && sel.i === di ? " sel" : ""}${miss.includes(`d${di}`) ? " miss" : ""}`} onClick={() => tap("d", di)}>{set[di]?.v}</button>
          ];
        })}
      </div>
      {cleared && <p className="row" style={{ marginTop: 12 }}><b>Board cleared in {moves} moves.</b><button className="btn sm" onClick={() => reset(draw())}>{deck ? "Next cards" : "Play again"}</button></p>}
      {msg && <div style={{ marginTop: 12 }}><AiErrorNote error={msg} onRetry={aiSet} /></div>}
    </>
  );
}

function Speed({ test }: { test: TestSet | null }) {
  const { p, update, answer: recordAnswer, log } = useApp();
  const bestKey = test ? `speed_set_${test.id}` : "speed_" + p.trade;
  const [phase, setPhase] = useState<"ready" | "play" | "over">("ready");
  const [qs, setQs] = useState<Question[]>([]);
  const [i, setI] = useState(0);
  const [left, setLeft] = useState(60);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [right, setRight] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [newBest, setNewBest] = useState(false);
  const scoreRef = useRef(0); scoreRef.current = score;
  const rightRef = useRef(0); rightRef.current = right;

  useEffect(() => {
    if (phase !== "play") return;
    const id = setInterval(() => setLeft((l) => l - 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase === "play" && left <= 0) {
      setPhase("over");
      const s = scoreRef.current;
      const nb = s > (p.best[bestKey] || 0); setNewBest(nb);
      if (nb) update((prev) => ({ ...prev, best: { ...prev.best, [bestKey]: s } }));
      log("Speed Round", `${test ? test.title + " · " : ""}${s} pts · ${rightRef.current} correct`);
    }
  }, [left, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  function begin() { setQs(shuffle(test ? test.questions : pool(p, "mix"))); setI(0); setLeft(60); setScore(0); setStreak(0); setRight(0); setPicked(null); setPhase("play"); }

  function answer(k: number) {
    if (picked !== null) return;
    const q = qs[i % qs.length]; const ok = k === q.a;
    recordAnswer(q, ok); setPicked(k);
    if (ok) { setRight((r) => r + 1); setScore((s) => s + 10 * (1 + Math.min(streak, 4))); setStreak((s) => s + 1); } else setStreak(0);
    setTimeout(() => { setPicked(null); setI((x) => x + 1); }, ok ? 350 : 900);
  }

  if (phase === "ready") return (
    <>
      <div className="stat"><div><b>60s</b><span>Clock</span></div><div><b>{p.best[bestKey] ?? 0}</b><span>Best</span></div></div>
      <p className="lede">Answer as many as you can. Each correct answer in a row raises your multiplier, up to ×5. A miss resets it.</p>
      {test && <p className="note" style={{ margin: "6px 0 0" }}>Questions from <b>{test.title}</b> ({test.questions.length}).</p>}
      <button className="btn primary big" style={{ marginTop: 12 }} onClick={begin}>Start</button>
    </>
  );
  if (phase === "over") return (
    <>
      <div className="eyebrow">Time</div><div className="score">{score}</div>
      <p>{right} correct{newBest && <> · <b>New best</b></>}</p>
      <button className="btn primary" onClick={begin}>Play again</button>
    </>
  );
  const q = qs[i % qs.length];
  return (
    <>
      <div className="stat"><div><b>{Math.max(0, left)}</b><span>Seconds</span></div><div><b>{score}</b><span>Points</span></div><div><b>×{1 + Math.min(streak, 4)}</b><span>Streak</span></div></div>
      <p className="q">{q.q}</p>
      <div className="opts">
        {q.c.map((c, k) => (
          <button key={k} className={`opt${picked !== null && k === q.a ? " right" : ""}${picked === k && k !== q.a ? " wrong" : ""}`} onClick={() => answer(k)}>
            <b>{"ABCD"[k]}</b><span>{c}</span>
          </button>
        ))}
      </div>
    </>
  );
}

type CalcQ = { q: string; a: number; u: string; topic: string; t: string };
function makeCalc(trade: string): CalcQ {
  const r = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  const gens: (() => CalcQ)[] = [
    () => { const R = pick([4, 5, 6, 8, 10, 12, 15, 20, 24, 30]), I = pick([2, 3, 4, 5, 6, 8, 10]); return { q: `A ${R} Ω load draws ${I} A. What is the supply voltage?`, a: R * I, u: "V", topic: "Electrical theory", t: "elec" }; },
    () => { const E = pick([120, 208, 240]), I = pick([10, 15, 20, 25, 30]); return { q: `${E} V × ${I} A resistive load. How many watts?`, a: E * I, u: "W", topic: "Electrical theory", t: "elec" }; },
    () => { const C = pick([400, 600, 800, 1000, 1200, 1600, 2000]), T = pick([15, 18, 20, 22, 25]); return { q: `Sensible Btu/h for ${C} CFM at a ${T} °F temperature difference?`, a: Math.round(1.08 * C * T), u: "Btu/h", topic: "Load & airflow", t: "hvac" }; },
    () => { const B = pick([24000, 30000, 36000, 42000, 48000, 60000]); return { q: `${B.toLocaleString()} Btu/h is how many tons?`, a: B / 12000, u: "tons", topic: "Load & airflow", t: "hvac" }; },
    () => { const L = r(10, 60), s = pick([[0.25, "2 in"], [0.125, "4 in"]] as [number, string][]); return { q: `Inches of fall over ${L} ft of ${s[1]} drain at minimum slope (IPC Table 704.1)?`, a: +(L * s[0]).toFixed(2), u: "in", topic: "Drainage", t: "plumb" }; },
    () => { const c = pick([40000, 60000, 80000, 120000, 150000]), m = pick([10, 15, 20, 25]); return { q: `Cost $${c.toLocaleString()} with a ${m}% markup. Selling price?`, a: c * (1 + m / 100), u: "$", topic: "Business & Law", t: "law" }; },
    () => { const L = pick([20, 24, 30, 40]), W = pick([10, 12, 20, 24]), T = pick([4, 6]); return { q: `Slab ${L} × ${W} ft, ${T} in thick. Cubic yards to one decimal?`, a: +((L * W * T) / 12 / 27).toFixed(1), u: "yd³", topic: "Estimating", t: "gc" }; }
  ];
  const mine = gens.filter((g) => { const x = g(); return x.t === trade || x.t === "law"; });
  return pick([...mine, ...mine, ...gens])();
}

function CalcSprint() {
  const { p, record, log } = useApp();
  const [round, setRound] = useState(1);
  const [right, setRight] = useState(0);
  const [q, setQ] = useState<CalcQ>(() => makeCalc(p.trade));
  const [val, setVal] = useState("");
  const [fb, setFb] = useState<null | boolean>(null);
  const [over, setOver] = useState(false);
  const inRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inRef.current?.focus(); }, [q]);

  function check(e: React.FormEvent) {
    e.preventDefault(); if (fb !== null) return next();
    const v = parseFloat(val.replace(/[$,]/g, ""));
    const ok = Math.abs(v - q.a) <= Math.max(0.051, Math.abs(q.a) * 0.005);
    record(q.topic, ok); if (ok) setRight((r) => r + 1); setFb(ok);
  }
  function next() {
    if (round === 8) { setOver(true); log("Calc Sprint", `${right}/8`); return; }
    setRound((r) => r + 1); setQ(makeCalc(p.trade)); setVal(""); setFb(null);
  }
  if (over) return (<><div className="eyebrow">Result</div><div className="score">{right}/8</div><button className="btn primary" onClick={() => { setOver(false); setRound(1); setRight(0); setQ(makeCalc(p.trade)); setVal(""); setFb(null); }}>New round</button></>);
  return (
    <>
      <div className="stat"><div><b>{round}/8</b><span>Problem</span></div><div><b>{right}</b><span>Correct</span></div></div>
      <p className="q">{q.q}</p>
      <form className="row" onSubmit={check}>
        <label htmlFor="cAns" hidden>Answer</label>
        <input id="cAns" ref={inRef} inputMode="decimal" autoComplete="off" value={val} onChange={(e) => setVal(e.target.value)} disabled={fb !== null}
          style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, background: "var(--surface)", width: 160 }} />
        <span className="note">{q.u}</span>
        <button className="btn primary">{fb === null ? "Check" : "Next"}</button>
      </form>
      {fb !== null && <p>{fb ? <b style={{ color: "var(--ok)" }}>Correct.</b> : <><b style={{ color: "var(--bad)" }}>Not quite.</b> Answer: {q.u === "$" ? "$" : ""}{q.a.toLocaleString()} {q.u === "$" ? "" : q.u}</>}</p>}
    </>
  );
}
