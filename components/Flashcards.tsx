"use client";
import { useEffect, useMemo, useState } from "react";
import { useApp, PanelHead, AiErrorNote, ProNote, usePlan } from "./ctx";
import { Pair, TRADES } from "@/lib/data";
import { pairsFor } from "@/lib/progress";
import { generate } from "@/lib/ai";
import { usePublishedSets } from "./usePublishedSets";
import s from "./Study.module.css";

const INTERVAL_DAYS = [0, 1, 3, 7, 14, 30];

export default function Flashcards() {
  const { p, update, record } = useApp();
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState<any>(null);
  const [tick, setTick] = useState(0);

  const { limits } = usePlan();
  const decks = usePublishedSets("game", p.trade, p.state);
  const [deckId, setDeckId] = useState("");
  const deck = decks.sets?.find((d) => d.id === deckId) || null;
  useEffect(() => { if (decks.sets && deckId && !deck) setDeckId(""); }, [decks.sets, deckId, deck]);
  const all = deck ? deck.pairs : pairsFor(p);
  const due = useMemo(() => {
    const now = Date.now();
    return all.filter((x) => { const c = p.cards[`${p.trade}:${x.k}`]; return !c || c.due <= now; });
  }, [all, p.cards, p.trade, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const card = due.length ? due[tick % Math.min(due.length, 5)] : null;

  function grade(ok: boolean) {
    if (!card) return;
    const id = `${p.trade}:${card.k}`;
    update((prev) => {
      const c = prev.cards[id] || { box: 0, due: 0 };
      const box = ok ? Math.min(5, c.box + 1) : 0;
      return { ...prev, cards: { ...prev.cards, [id]: { box, due: Date.now() + INTERVAL_DAYS[box] * 864e5 + (ok ? 0 : 60e3) } } };
    });
    record("Terms & definitions", ok);
    setFlipped(false); setTick((t) => t + 1);
  }

  async function addAI() {
    setBusy(true); setMsg(""); setErr(null);
    try {
      const r = await generate<{ pairs: Pair[] }>({ kind: "pairs", count: 8, state: p.state, trade: p.trade, avoid: all.map((x) => x.k) });
      update((prev) => ({ ...prev, extraPairs: [...prev.extraPairs, ...r.pairs].slice(-200) }));
      setMsg(`Added ${r.pairs.length} cards.`);
    } catch (e: any) { setErr(e); }
    setBusy(false);
  }

  return (
    <section className="panel">
      <PanelHead eyebrow="Flashcards" title="Terms" accent="on repeat" lede="Spaced repetition: cards you miss come back sooner, and cards you know move out to longer intervals." />
      {decks.sets && (decks.sets.length > 0 || !limits.practice_sets) && (
        <div className={s.srcPick}>
          {decks.sets.length > 0 && (
            <>
              <label htmlFor="cardDeck" className={s.srcLabel}>Deck</label>
              <select id="cardDeck" className="input" value={deckId} onChange={(e) => { setDeckId(e.target.value); setFlipped(false); setTick(0); setMsg(""); }}>
                <option value="">All my {TRADES[p.trade]} cards</option>
                <optgroup label="From Licensing Bro’s instructors">
                  {decks.sets.map((d) => <option key={d.id} value={d.id}>{d.title} · {d.pairs.length} cards</option>)}
                </optgroup>
              </select>
            </>
          )}
          {!limits.practice_sets && <div className={s.srcNote}><ProNote>Free decks are shown. Any paid course unlocks every Licensing Bro&rsquo;s game deck.</ProNote></div>}
        </div>
      )}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="eyebrow">{due.length} due · {all.length} cards · {deck ? deck.title : TRADES[p.trade]}</span>
          {!deck && <button className="btn sm" onClick={addAI} disabled={busy}>{busy ? "Generating…" : "Add 8 AI cards"}</button>}
        </div>
        {msg && <p className="note">{msg}</p>}
        {err && <div style={{ marginTop: 10 }}><AiErrorNote error={err} onRetry={addAI} /></div>}
        <div style={{ marginTop: 12 }}>
          {!card ? (
            <div className="face"><div className="term">All caught up</div><p className="note">{deck ? "You've reviewed this whole deck for now. Come back later, or pick another deck." : "Come back later, or add AI cards for more practice."}</p></div>
          ) : !flipped ? (
            <div className="face"><div className="eyebrow">Term {card.ai && <span className="badge ai">AI</span>}</div><div className="term">{card.k}</div><p className="note">Say the meaning out loud, then reveal.</p></div>
          ) : (
            <div className="face"><div className="eyebrow">{card.k}</div><p style={{ fontSize: 20, margin: 0 }}>{card.v}</p></div>
          )}
        </div>
        {card && (
          <div className="row" style={{ marginTop: 12, justifyContent: "center" }}>
            {!flipped
              ? <button className="btn primary big" onClick={() => setFlipped(true)}>Reveal</button>
              : <><button className="btn big" onClick={() => grade(false)}>Missed it</button><button className="btn primary big" onClick={() => grade(true)}>Got it</button></>}
          </div>
        )}
      </div>
    </section>
  );
}
