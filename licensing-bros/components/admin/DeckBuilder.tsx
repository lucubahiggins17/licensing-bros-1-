"use client";
// AI game deck builder: the AI writes term/meaning cards from the verified knowledge base, the admin edits them,
// then publishes. Students play published decks in Code Match and study them in Flashcards.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Gamepad2, Plus, RefreshCw, Trash2, Wand2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { callFn } from "@/lib/api";
import { STATES } from "@/lib/data";
import type { PracticeSet, TermPair, Trade } from "@/lib/types";
import { errMsg, q } from "./format";
import { useAdmin, useDirty, useMounted, Empty, FormPanel, SaveBar, Step, Toggle } from "./ui";
import { MoveButtons } from "./fields";
import s from "./admin.module.css";

const TRADES: Record<Trade, string> = { gc: "General Contractor", elec: "Electrical", plumb: "Plumbing", hvac: "HVAC / Mechanical" };
const AI_STEPS = ["Reading the verified knowledge base…", "Picking the terms that show up on exams…", "Writing plain-English meanings…", "Adding code sections…"];
export const MIN_CARDS = 4;

type Meta = { trade: Trade; state: string; count: number; topic: string };
export type DeckDraft = { id: string | null; title: string; is_free: boolean; published: boolean; pairs: TermPair[]; meta: Meta };

export const newDeck = (): DeckDraft => ({ id: null, title: "", is_free: false, published: false, pairs: [], meta: { trade: "gc", state: "", count: 12, topic: "" } });

export function deckFromSet(p: PracticeSet): DeckDraft {
  const trade = (["gc", "elec", "plumb", "hvac"].includes(p.trade) ? p.trade : "gc") as Trade;
  return {
    id: p.id, title: p.title, is_free: p.is_free, published: p.published,
    pairs: (Array.isArray(p.pairs) ? p.pairs : []).filter((x) => x && typeof x.k === "string").map((x) => ({ k: String(x.k), v: String(x.v ?? "") })),
    meta: { trade, state: p.state || "", count: 12, topic: p.topic || "" }
  };
}

const cleanPair = (raw: any): TermPair | null => {
  const k = String(raw?.k ?? "").trim(), v = String(raw?.v ?? "").trim();
  return k && v ? { k, v } : null;
};
const deckProblem = (pairs: TermPair[]): string | null => {
  if (pairs.length < MIN_CARDS) return `Add at least ${MIN_CARDS} cards so the matching game has enough to play.`;
  const seen = new Set<string>();
  for (let i = 0; i < pairs.length; i++) {
    if (!pairs[i].k.trim()) return `Card ${i + 1} needs a term.`;
    if (!pairs[i].v.trim()) return `Card ${i + 1} needs a meaning.`;
    const key = pairs[i].k.trim().toLowerCase();
    if (seen.has(key)) return `“${pairs[i].k.trim()}” is in the deck twice. Each term can only appear once.`;
    seen.add(key);
  }
  return null;
};
const snapshot = (x: DeckDraft) => JSON.stringify({ t: x.title, f: x.is_free, p: x.published, c: x.pairs, tr: x.meta.trade, st: x.meta.state, to: x.meta.topic });
const autoTitle = (m: Meta) => `${m.topic.trim() || TRADES[m.trade]} — ${m.state || "All states"} game deck`;

export default function DeckBuilder({ initial, onClose }: { initial: DeckDraft; onClose: () => void }) {
  const { toast, userId } = useAdmin();
  const mounted = useMounted();
  const [d, setD] = useState<DeckDraft>(initial);
  const [saved, setSaved] = useState(() => snapshot(initial));
  const [gen, setGen] = useState<{ started: number; n: number } | null>(null);
  const [tick, setTick] = useState(0);
  const [regen, setRegen] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const abort = useRef<AbortController | null>(null);

  const dirty = useMemo(() => (d.id ? snapshot(d) !== saved : d.pairs.length > 0 || !!d.title.trim()), [d, saved]);
  useDirty("deck", dirty || !!gen);

  useEffect(() => {
    if (!gen) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [gen]);
  useEffect(() => () => abort.current?.abort(), []);

  const m = d.meta;
  const setMeta = (p: Partial<Meta>) => setD((x) => ({ ...x, meta: { ...x.meta, ...p } }));
  const setPair = (i: number, p: Partial<TermPair>) => setD((x) => ({ ...x, pairs: x.pairs.map((c, k) => (k === i ? { ...c, ...p } : c)) }));
  const body = (count: number, avoid: string[], topic = m.topic) =>
    ({ kind: "admin_pairs", trade: m.trade, state: m.state || null, count, avoid, ...(topic.trim() ? { topic: topic.trim() } : {}) });

  async function generate() {
    const n = Math.max(4, Math.min(40, Math.round(m.count) || 12));
    abort.current = new AbortController();
    setGen({ started: Date.now(), n });
    setProblem("");
    try {
      const res = await callFn<{ pairs: any[] }>("generate", body(n, d.pairs.map((x) => x.k)), { signal: abort.current.signal });
      const have = new Set(d.pairs.map((x) => x.k.trim().toLowerCase()));
      const fresh = (res?.pairs || []).map(cleanPair).filter((x): x is TermPair => !!x && !have.has(x.k.toLowerCase()));
      if (!fresh.length) throw new Error("The AI didn't return new cards. Try a different topic, or try again.");
      if (!mounted.current) return;
      setD((x) => ({ ...x, pairs: [...x.pairs, ...fresh], title: x.title || autoTitle(x.meta) }));
      toast(`The AI wrote ${fresh.length} card${fresh.length === 1 ? "" : "s"}. Check each one before publishing.`);
    } catch (e: any) {
      if (mounted.current && e?.name !== "AbortError") toast(errMsg(e, "The AI couldn't write the deck. Try again."), "bad");
    }
    if (mounted.current) setGen(null);
  }

  async function regenerateOne(i: number) {
    setRegen((r) => new Set(r).add(i));
    try {
      const res = await callFn<{ pairs: any[] }>("generate", body(1, d.pairs.map((x) => x.k)));
      const np = (res?.pairs || []).map(cleanPair).filter(Boolean)[0] as TermPair | undefined;
      if (!np) throw new Error("The AI didn't return a card. Try again.");
      if (mounted.current) { setD((x) => ({ ...x, pairs: x.pairs.map((c, k) => (k === i ? np : c)) })); toast(`Card ${i + 1} replaced.`); }
    } catch (e) { if (mounted.current) toast(errMsg(e), "bad"); }
    if (mounted.current) setRegen((r) => { const n = new Set(r); n.delete(i); return n; });
  }

  function move(i: number, dir: number) {
    const j = i + dir;
    if (j < 0 || j >= d.pairs.length) return;
    setD((x) => { const n = [...x.pairs]; [n[i], n[j]] = [n[j], n[i]]; return { ...x, pairs: n }; });
  }

  async function save() {
    const p = !d.title.trim() ? "Give the deck a title." : deckProblem(d.pairs);
    setProblem(p || "");
    if (p) { toast(p, "bad"); return; }
    setSaving(true);
    try {
      const sb = supabase();
      const pairs = d.pairs.map((x) => ({ k: x.k.trim(), v: x.v.trim() }));
      const row = { title: d.title.trim(), kind: "game", trade: m.trade, state: m.state || null, part: "mix", topic: m.topic.trim(), questions: [], pairs, is_free: d.is_free, published: d.published };
      let id = d.id;
      if (id) await q(sb.from("practice_sets").update(row).eq("id", id));
      else id = ((await q(sb.from("practice_sets").insert({ ...row, created_by: userId }).select().single())) as PracticeSet).id;
      const next = { ...d, id, title: row.title, pairs };
      setD(next);
      setSaved(snapshot(next));
      toast(d.published ? "Saved and published. Students can play it in Games and Flashcards now." : "Saved as a draft. Turn on Publish when it's ready.");
    } catch (e) { toast(errMsg(e), "bad"); }
    setSaving(false);
  }

  const elapsed = gen ? Math.floor((Date.now() - gen.started) / 1000) : 0;
  void tick;
  const blank = () => setD((x) => ({ ...x, pairs: [...x.pairs, { k: "", v: "" }] }));

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className={s.editorTop}>
        <button type="button" className={`btn sm ghost ${s.back}`} onClick={onClose}><ArrowLeft aria-hidden="true" />All tests &amp; games</button>
        <div className={s.editorTitle}>
          <div className="eyebrow orange">{d.id ? "Edit game deck" : "AI game builder"}</div>
          <h2 className={s.h2}>{d.id ? d.title || "Game deck" : "Build a"} <span>{d.id ? "" : "game deck"}</span></h2>
        </div>
      </div>

      <FormPanel code="Form GD-1 · Game builder" title="What should the AI make?">
        <p className="note" style={{ margin: 0 }}>
          A game deck is a set of term-and-meaning cards. Students play it as <b>Code Match</b> (tap a term, then its meaning) and study it in <b>Flashcards</b> with spaced repetition.
        </p>
        <Step n={1}>Trade and state</Step>
        <div className="grid2">
          <label className="field">Trade
            <select value={m.trade} onChange={(e) => setMeta({ trade: e.target.value as Trade })} disabled={!!gen}>
              {(Object.keys(TRADES) as Trade[]).map((t) => <option key={t} value={t}>{TRADES[t]}</option>)}
            </select>
          </label>
          <label className="field">State
            <select value={m.state} onChange={(e) => setMeta({ state: e.target.value })} disabled={!!gen}>
              <option value="">All states (national codes)</option>
              {STATES.map((st) => <option key={st} value={st}>{st}</option>)}
            </select>
          </label>
        </div>
        <Step n={2}>Topic and size</Step>
        <div className="grid2">
          <label className="field">Topic (optional)
            <input value={m.topic} onChange={(e) => setMeta({ topic: e.target.value })} disabled={!!gen} placeholder="Lien law, OSHA ladders, venting…" maxLength={80} />
            <span className="hint">Leave empty for the most-tested terms in this trade.</span>
          </label>
          <label className="field">Number of cards: {Math.round(m.count)}
            <input type="range" min={4} max={40} step={1} value={m.count} onChange={(e) => setMeta({ count: Number(e.target.value) })} disabled={!!gen} className={s.range} />
            <span className="hint">Code Match shows 6 at a time and shuffles through the whole deck.</span>
          </label>
        </div>
        {gen ? (
          <div className={s.genBox} role="status" aria-live="polite">
            <div className={s.genTop}>
              <span className="spin" aria-hidden="true" />
              <div>
                <b>Writing {gen.n} cards… {elapsed}s</b>
                <p className="note" style={{ margin: 0 }}>{AI_STEPS[Math.min(AI_STEPS.length - 1, Math.floor(elapsed / 8))]} This usually takes 15 to 45 seconds.</p>
              </div>
            </div>
            <div className="bar" aria-hidden="true"><i style={{ width: `${Math.min(95, (elapsed / Math.max(25, gen.n * 1.5)) * 100)}%` }} /></div>
            <div><button type="button" className="btn sm" onClick={() => abort.current?.abort()}>Stop</button></div>
          </div>
        ) : (
          <button type="button" className="btn primary cta block" onClick={generate}>
            <Wand2 aria-hidden="true" />{d.pairs.length ? `Add ${Math.round(m.count)} more cards with AI` : `Write ${Math.round(m.count)} cards with AI`}
          </button>
        )}
      </FormPanel>

      {d.pairs.length > 0 && (
        <section className="stack" style={{ gap: 12 }} aria-label="Cards">
          <div className="row between">
            <h3 className={s.h3}>Cards ({d.pairs.length})</h3>
            <span className="note">Edit anything. Keep meanings short so they fit on a game tile.</span>
          </div>
          {d.pairs.map((c, i) => (
            <article key={i} className={`${s.qCard} ${s.deckCard} ${regen.has(i) ? s.qBusy : ""}`} aria-busy={regen.has(i)}>
              <div className={s.qHead}>
                <span className={s.qNum}>{i + 1}</span>
                <span className={s.qHeadActions}>
                  <MoveButtons what="card" disabled={regen.size > 0} onUp={() => move(i, -1)} onDown={() => move(i, 1)} upDisabled={i === 0} downDisabled={i === d.pairs.length - 1} />
                  <button type="button" className="btn sm" onClick={() => regenerateOne(i)} disabled={regen.has(i) || !!gen} title="Ask the AI for a different card">
                    <RefreshCw aria-hidden="true" className={regen.has(i) ? s.spinIco : ""} />{regen.has(i) ? "Rewriting…" : "New card"}
                  </button>
                  <button type="button" className={s.iconBtn} disabled={regen.size > 0} onClick={() => setD((x) => ({ ...x, pairs: x.pairs.filter((_, k) => k !== i) }))} aria-label={`Delete card ${i + 1}`} title="Delete card"><Trash2 /></button>
                </span>
              </div>
              <div className={s.deckFields}>
                <label className="field">Term
                  <input value={c.k} onChange={(e) => setPair(i, { k: e.target.value })} maxLength={60} placeholder="Retainage" aria-label={`Card ${i + 1} term`} />
                </label>
                <label className="field">Meaning
                  <textarea rows={2} value={c.v} onChange={(e) => setPair(i, { v: e.target.value })} maxLength={220} placeholder="Part of each payment held back until the job is finished." style={{ minHeight: 60 }} aria-label={`Card ${i + 1} meaning`} />
                  {c.v.length > 140 && <span className="hint">Long meanings get cramped on phones. Try to keep it under 140 characters.</span>}
                </label>
              </div>
            </article>
          ))}
          <div><button type="button" className="btn sm" onClick={blank}><Plus aria-hidden="true" />Add a card by hand</button></div>
        </section>
      )}

      {(d.pairs.length > 0 || d.id) && (
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <FormPanel code="Form GD-2 · Save" title="Save the game deck">
            <label className="field"><span>Title <span className="req">*</span></span>
              <input value={d.title} onChange={(e) => setD((x) => ({ ...x, title: e.target.value }))} maxLength={160} placeholder={autoTitle(m)} />
              <span className="hint">Students see this name when they pick a deck.</span>
            </label>
            <Toggle checked={d.is_free} onChange={(v) => setD((x) => ({ ...x, is_free: v }))} label="Free for everyone"
              hint="On = free accounts can play it too. Off = only students who bought a course." />
            <Toggle checked={d.published} onChange={(v) => setD((x) => ({ ...x, published: v }))} label="Publish"
              hint="On = students see it in Games and Flashcards. Leave off while you review." />
            {problem && <p className="err" role="alert" style={{ margin: 0 }}>{problem}</p>}
            <button type="submit" className="btn navy cta block" disabled={saving || !!gen || (!dirty && !!d.id)}>
              {saving ? "Saving…" : d.id ? (dirty ? "Save game deck" : "All changes saved") : "Save game deck"}
            </button>
          </FormPanel>
        </form>
      )}

      {d.pairs.length === 0 && !gen && (
        <div className="card">
          <Empty icon={Gamepad2} title="No cards yet">Pick the trade, state and topic above, then let the AI write them. You can also add cards by hand.</Empty>
          <div className="center"><button type="button" className="btn sm" onClick={blank}><Plus aria-hidden="true" />Write one by hand</button></div>
        </div>
      )}

      <SaveBar dirty={dirty} saving={saving} onSave={save} label="Save game deck" disabledReason={gen ? "The AI is writing… wait for it to finish" : undefined} />
    </div>
  );
}
