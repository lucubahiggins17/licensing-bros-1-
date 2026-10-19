"use client";
// AI builder: practice tests (multiple choice) and game decks (term/meaning cards), written by AI and reviewed
// by an admin before publishing. Both live in practice_sets; `kind` tells them apart.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ClipboardList, Gamepad2, Pencil, Plus, RefreshCw, Sparkles, Trash2, Wand2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { callFn } from "@/lib/api";
import { STATES } from "@/lib/data";
import type { PracticeQuestion, PracticeSet, Trade } from "@/lib/types";
import { errMsg, fmtDate, q } from "./format";
import { useAdmin, useDirty, useMounted, ConfirmButton, Empty, ErrorBox, FormPanel, Intent, Loading, SaveBar, SectionHead, Step, Toggle } from "./ui";
import { ChoiceRows, MoveButtons } from "./fields";
import DeckBuilder, { deckFromSet, newDeck, type DeckDraft } from "./DeckBuilder";
import s from "./admin.module.css";

const TRADES: Record<Trade, string> = { gc: "General Contractor", elec: "Electrical", plumb: "Plumbing", hvac: "HVAC / Mechanical" };
const PARTS: Record<PracticeSet["part"], string> = { trade: "Trade knowledge", law: "Business & Law", mix: "Mix of both" };
const AI_STEPS = ["Reading the verified knowledge base…", "Checking the code references…", "Writing questions and answer choices…", "Writing explanations with citations…", "Double-checking the answers…"];

type Meta = { trade: Trade; state: string; part: PracticeSet["part"]; count: number; topic: string };
type Draft = { id: string | null; title: string; is_free: boolean; published: boolean; questions: PracticeQuestion[]; meta: Meta };

const newDraft = (): Draft => ({ id: null, title: "", is_free: false, published: false, questions: [], meta: { trade: "gc", state: "", part: "mix", count: 10, topic: "" } });

function normQ(raw: any, fallbackT: PracticeQuestion["t"]): PracticeQuestion | null {
  if (!raw || typeof raw.q !== "string") return null;
  const c = Array.isArray(raw.c) ? raw.c : Array.isArray(raw.choices) ? raw.choices : null;
  if (!c || c.length < 4) return null;
  const a = Number(raw.a ?? raw.answer);
  const t = ["gc", "elec", "plumb", "hvac", "law"].includes(raw.t) ? raw.t : fallbackT;
  return { t, topic: String(raw.topic || "General"), q: raw.q, c: c.slice(0, 4).map((x: any) => String(x ?? "")), a: a >= 0 && a <= 3 ? a : 0, ref: String(raw.ref || ""), why: String(raw.why || "") };
}
const qProblem = (qs: PracticeQuestion[]): string | null => {
  if (!qs.length) return "Add at least one question.";
  for (let i = 0; i < qs.length; i++) {
    const x = qs[i];
    if (!x.q.trim()) return `Question ${i + 1} needs the question text.`;
    if ([0, 1, 2, 3].some((k) => !(x.c[k] ?? "").trim())) return `Question ${i + 1} needs all 4 choices filled in.`;
  }
  return null;
};
/** What gets saved (generation inputs like count/topic are not part of a saved test). */
const snapshot = (x: Draft) => JSON.stringify({ t: x.title, f: x.is_free, p: x.published, q: x.questions, tr: x.meta.trade, st: x.meta.state, pa: x.meta.part });
const autoTitle = (m: Meta, n: number) => `${m.state || "All states"} ${TRADES[m.trade]} — ${PARTS[m.part]}${m.topic.trim() ? ` (${m.topic.trim()})` : ""}, ${n} questions`;

export default function Tests({ intent }: { intent: Intent }) {
  const { guardLeave, toast } = useAdmin();
  const [draft, setDraft] = useState<Draft | null>(intent?.action === "new" ? newDraft() : null);
  const [deck, setDeck] = useState<DeckDraft | null>(intent?.action === "new-deck" ? newDeck() : null);
  const [rows, setRows] = useState<PracticeSet[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [show, setShow] = useState<"all" | "test" | "game">("all");

  const load = useCallback(async () => {
    setErr("");
    try { setRows(((await q(supabase().from("practice_sets").select("*").order("created_at", { ascending: false }))) as PracticeSet[]) || []); }
    catch (e) { setErr(errMsg(e, "Couldn't load tests and games.")); }
  }, []);
  useEffect(() => { if (!draft && !deck) load(); }, [draft, deck, load]);

  const isGame = (p: PracticeSet) => p.kind === "game";
  async function patch(p: PracticeSet, change: Partial<PracticeSet>, msg: string) {
    setBusy(p.id);
    setRows((r) => r?.map((x) => (x.id === p.id ? { ...x, ...change } : x)) ?? r);
    try { await q(supabase().from("practice_sets").update(change).eq("id", p.id)); toast(msg); }
    catch (e) { setRows((r) => r?.map((x) => (x.id === p.id ? p : x)) ?? r); toast(errMsg(e), "bad"); }
    setBusy(null);
  }
  async function remove(p: PracticeSet) {
    try { await q(supabase().from("practice_sets").delete().eq("id", p.id)); setRows((r) => r?.filter((x) => x.id !== p.id) ?? r); toast(isGame(p) ? "Game deck deleted." : "Practice test deleted."); }
    catch (e) { toast(errMsg(e), "bad"); }
  }
  function edit(p: PracticeSet) {
    if (isGame(p)) { setDeck(deckFromSet(p)); return; }
    const trade = (["gc", "elec", "plumb", "hvac"].includes(p.trade) ? p.trade : "gc") as Trade;
    setDraft({
      id: p.id, title: p.title, is_free: p.is_free, published: p.published,
      questions: (p.questions || []).map((x) => normQ(x, trade)).filter(Boolean) as PracticeQuestion[],
      meta: { trade, state: p.state || "", part: p.part, count: 10, topic: "" }
    });
  }

  if (draft) return <Builder initial={draft} onClose={() => guardLeave(() => setDraft(null))} />;
  if (deck) return <DeckBuilder initial={deck} onClose={() => guardLeave(() => setDeck(null))} />;

  const list = (rows || []).filter((p) => show === "all" || (show === "game" ? isGame(p) : !isGame(p)));
  const counts = { all: rows?.length || 0, test: rows?.filter((p) => !isGame(p)).length || 0, game: rows?.filter(isGame).length || 0 };
  const buttons = (
    <>
      <button type="button" className="btn primary" onClick={() => setDraft(newDraft())}><Sparkles aria-hidden="true" />Build a test with AI</button>
      <button type="button" className="btn navy" onClick={() => setDeck(newDeck())}><Gamepad2 aria-hidden="true" />Build a game with AI</button>
    </>
  );

  return (
    <div className="stack" style={{ gap: 18 }}>
      <SectionHead eyebrow="AI builder" title="Tests &" accent="games"
        sub="Pick a trade, state and topic. The AI writes practice tests or game decks from the verified knowledge base, you check them over, then publish them for students."
        actions={buttons} />

      <div className={s.builderHelp}>
        <div><ClipboardList aria-hidden="true" /><span><b>Practice tests</b> show up in My Learning → Practice exam, and play as a <b>Speed Round</b> game.</span></div>
        <div><Gamepad2 aria-hidden="true" /><span><b>Game decks</b> show up in My Learning → Games (<b>Code Match</b>) and in <b>Flashcards</b>.</span></div>
      </div>

      {err ? <ErrorBox text={err} onRetry={load} /> : !rows ? <Loading text="Loading tests and games…" /> : !rows.length ? (
        <div className="card">
          <Empty icon={Sparkles} title="Nothing built yet. Start with a test or a game."
            action={<div className="row" style={{ justifyContent: "center" }}>{buttons}</div>}>
            The AI writes exam-style questions or term-and-meaning cards with code references from the verified knowledge base. You review and edit everything before students see it.
          </Empty>
        </div>
      ) : (
        <>
          <div className="seg" role="group" aria-label="Show">
            {([["all", "Everything"], ["test", "Practice tests"], ["game", "Game decks"]] as const).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>{label} ({counts[k]})</button>
            ))}
          </div>
          {!list.length ? (
            <div className="card"><Empty icon={show === "game" ? Gamepad2 : ClipboardList} title={show === "game" ? "No game decks yet" : "No practice tests yet"}
              action={show === "game" ? <button type="button" className="btn navy" onClick={() => setDeck(newDeck())}><Gamepad2 aria-hidden="true" />Build a game with AI</button>
                : <button type="button" className="btn primary" onClick={() => setDraft(newDraft())}><Sparkles aria-hidden="true" />Build a test with AI</button>} /></div>
          ) : (
            <ul className={s.cardList}>
              {list.map((p) => (
                <li key={p.id} className={`card ${s.setRow}`}>
                  <div className={s.setInfo}>
                    <b>{p.title}</b>
                    <span className="note">
                      {TRADES[p.trade as Trade] || "All trades"} · {p.state || "All states"} · {isGame(p) ? `${(p.pairs || []).length} cards${p.topic ? ` · ${p.topic}` : ""}` : `${PARTS[p.part]} · ${(p.questions || []).length} questions`} · {fmtDate(p.created_at)}
                    </span>
                    <div className="row" style={{ gap: 6, marginTop: 4 }}>
                      {isGame(p) ? <span className={`badge ${s.kindGame}`}><Gamepad2 aria-hidden="true" />Game deck</span> : <span className={`badge ${s.kindTest}`}><ClipboardList aria-hidden="true" />Practice test</span>}
                      {p.is_free ? <span className="badge free">Free</span> : <span className="badge paid">Paid students</span>}
                    </div>
                  </div>
                  <div className={s.setActions}>
                    <Toggle small checked={p.published} disabled={busy === p.id} label={p.published ? "Published" : "Draft"}
                      onChange={(v) => patch(p, { published: v }, v ? (isGame(p) ? "Published. Students can play it now." : "Published. Students can take it now.") : "Unpublished. Students can't see it.")} />
                    <button type="button" className="btn sm" onClick={() => edit(p)}><Pencil aria-hidden="true" />Edit</button>
                    <ConfirmButton className={s.iconBtn} title={`Delete ${p.title}`} onConfirm={() => remove(p)} message={<>Delete “{p.title}”?</>}><Trash2 aria-hidden="true" /></ConfirmButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
function Builder({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const { toast, userId } = useAdmin();
  const mounted = useMounted();
  const [d, setD] = useState<Draft>(initial);
  const [saved, setSaved] = useState<string>(() => snapshot(initial));
  const [gen, setGen] = useState<{ started: number; n: number } | null>(null);
  const [tick, setTick] = useState(0);
  const [regen, setRegen] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const abort = useRef<AbortController | null>(null);

  // A brand-new test counts as unsaved once it has questions or a title; a saved one when anything differs.
  const dirty = useMemo(() => (d.id ? snapshot(d) !== saved : d.questions.length > 0 || !!d.title.trim()), [d, saved]);
  useDirty("test", dirty || !!gen);

  useEffect(() => {
    if (!gen) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [gen]);
  useEffect(() => () => abort.current?.abort(), []);

  const m = d.meta;
  const setMeta = (p: Partial<Meta>) => setD((x) => ({ ...x, meta: { ...x.meta, ...p } }));
  const setQ = (i: number, p: Partial<PracticeQuestion>) => setD((x) => ({ ...x, questions: x.questions.map((qq, k) => (k === i ? { ...qq, ...p } : qq)) }));
  const fallbackT: PracticeQuestion["t"] = m.part === "law" ? "law" : m.trade;

  function body(count: number, topic: string) {
    return { kind: "admin_test", trade: m.trade, state: m.state || null, part: m.part, count, ...(topic.trim() ? { topic: topic.trim() } : {}) };
  }

  async function generate() {
    const n = Math.max(5, Math.min(50, Math.round(m.count) || 10));
    abort.current = new AbortController();
    setGen({ started: Date.now(), n });
    setProblem("");
    try {
      const res = await callFn<{ questions: any[] }>("generate", body(n, m.topic), { signal: abort.current.signal });
      const qs = (res?.questions || []).map((x) => normQ(x, fallbackT)).filter(Boolean) as PracticeQuestion[];
      if (!qs.length) throw new Error("The AI didn't return usable questions. Try again.");
      if (!mounted.current) return;
      setD((x) => ({ ...x, questions: [...x.questions, ...qs], title: x.title || autoTitle(x.meta, x.questions.length + qs.length) }));
      toast(`The AI wrote ${qs.length} question${qs.length === 1 ? "" : "s"}. Review each one before publishing.`);
    } catch (e: any) {
      if (mounted.current && e?.name !== "AbortError") toast(errMsg(e, "The AI couldn't write the test. Try again."), "bad");
    }
    if (mounted.current) setGen(null);
  }

  async function regenerateOne(i: number) {
    const cur = d.questions[i];
    setRegen((r) => new Set(r).add(i));
    try {
      const res = await callFn<{ questions: any[] }>("generate", body(1, cur?.topic || m.topic));
      const nq = (res?.questions || []).map((x) => normQ(x, fallbackT)).filter(Boolean)[0] as PracticeQuestion | undefined;
      if (!nq) throw new Error("The AI didn't return a question. Try again.");
      if (mounted.current) { setD((x) => ({ ...x, questions: x.questions.map((qq, k) => (k === i ? nq : qq)) })); toast(`Question ${i + 1} replaced.`); }
    } catch (e) { if (mounted.current) toast(errMsg(e), "bad"); }
    if (mounted.current) setRegen((r) => { const n = new Set(r); n.delete(i); return n; });
  }

  function move(i: number, dir: number) {
    const j = i + dir;
    if (j < 0 || j >= d.questions.length) return;
    setD((x) => { const n = [...x.questions]; [n[i], n[j]] = [n[j], n[i]]; return { ...x, questions: n }; });
  }

  async function save() {
    const p = !d.title.trim() ? "Give the test a title." : qProblem(d.questions);
    setProblem(p || "");
    if (p) { toast(p, "bad"); return; }
    setSaving(true);
    try {
      const sb = supabase();
      const row = {
        title: d.title.trim(), kind: "test", trade: m.trade, state: m.state || null, part: m.part, topic: m.topic.trim(), is_free: d.is_free, published: d.published,
        questions: d.questions.map((x) => ({ t: x.t, topic: x.topic.trim() || "General", q: x.q.trim(), c: x.c.map((c) => c.trim()), a: x.a, ref: x.ref.trim(), why: x.why.trim() }))
      };
      let id = d.id;
      if (id) await q(sb.from("practice_sets").update(row).eq("id", id));
      else id = ((await q(sb.from("practice_sets").insert({ ...row, created_by: userId }).select().single())) as PracticeSet).id;
      const next = { ...d, id, title: row.title, questions: row.questions as PracticeQuestion[] };
      setD(next);
      setSaved(snapshot(next));
      toast(d.published ? "Saved and published. Students can take it now." : "Saved as a draft. Turn on Publish when it's ready.");
    } catch (e) { toast(errMsg(e), "bad"); }
    setSaving(false);
  }

  const elapsed = gen ? Math.floor((Date.now() - gen.started) / 1000) : 0;
  void tick;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className={s.editorTop}>
        <button type="button" className={`btn sm ghost ${s.back}`} onClick={onClose}><ArrowLeft aria-hidden="true" />All tests &amp; games</button>
        <div className={s.editorTitle}>
          <div className="eyebrow orange">{d.id ? "Edit practice test" : "AI test builder"}</div>
          <h2 className={s.h2}>{d.id ? d.title || "Practice test" : "Build a"} <span>{d.id ? "" : "practice test"}</span></h2>
        </div>
      </div>

      <FormPanel code="Form AT-1 · Test builder" title="What should the AI write?">
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
        <Step n={2}>Section</Step>
        <div className="seg" role="group" aria-label="Section">
          {(Object.keys(PARTS) as PracticeSet["part"][]).map((p) => (
            <button key={p} type="button" aria-pressed={m.part === p} onClick={() => setMeta({ part: p })} disabled={!!gen}>{PARTS[p]}</button>
          ))}
        </div>
        <Step n={3}>How many and what topic</Step>
        <div className="grid2">
          <label className="field">Number of questions: {Math.round(m.count)}
            <input type="range" min={5} max={50} step={1} value={m.count} onChange={(e) => setMeta({ count: Number(e.target.value) })} disabled={!!gen} className={s.range} />
            <span className="hint">5 to 50. Bigger tests take longer to write.</span>
          </label>
          <label className="field">Topic (optional)
            <input value={m.topic} onChange={(e) => setMeta({ topic: e.target.value })} disabled={!!gen} placeholder="Lien law, box fill, trap seals…" maxLength={80} />
            <span className="hint">Leave empty for a mix of exam topics.</span>
          </label>
        </div>
        {gen ? (
          <div className={s.genBox} role="status" aria-live="polite">
            <div className={s.genTop}>
              <span className="spin" aria-hidden="true" />
              <div>
                <b>Writing {gen.n} questions… {elapsed}s</b>
                <p className="note" style={{ margin: 0 }}>{AI_STEPS[Math.min(AI_STEPS.length - 1, Math.floor(elapsed / 12))]} This usually takes 30 to 90 seconds. Keep this page open.</p>
              </div>
            </div>
            <div className="bar" aria-hidden="true"><i style={{ width: `${Math.min(95, (elapsed / Math.max(45, gen.n * 2.4)) * 100)}%` }} /></div>
            <div><button type="button" className="btn sm" onClick={() => abort.current?.abort()}>Stop</button></div>
          </div>
        ) : (
          <button type="button" className="btn primary cta block" onClick={generate}>
            <Wand2 aria-hidden="true" />{d.questions.length ? `Add ${Math.round(m.count)} more questions with AI` : `Write ${Math.round(m.count)} questions with AI`}
          </button>
        )}
      </FormPanel>

      {d.questions.length > 0 && (
        <section className="stack" style={{ gap: 12 }} aria-label="Questions">
          <div className="row between">
            <h3 className={s.h3}>Questions ({d.questions.length})</h3>
            <span className="note">Edit anything. The circle marks the correct answer.</span>
          </div>
          {d.questions.map((qq, i) => (
            <article key={i} className={`${s.qCard} ${regen.has(i) ? s.qBusy : ""}`} aria-busy={regen.has(i)}>
              <div className={s.qHead}>
                <span className={s.qNum}>Q{i + 1}</span>
                <select className={`input ${s.qSel}`} value={qq.t} onChange={(e) => setQ(i, { t: e.target.value as PracticeQuestion["t"] })} aria-label={`Question ${i + 1} section`}>
                  <option value={m.trade}>{TRADES[m.trade]}</option>
                  {qq.t !== m.trade && qq.t !== "law" && <option value={qq.t}>{TRADES[qq.t as Trade]}</option>}
                  <option value="law">Business &amp; Law</option>
                </select>
                <input className={`input ${s.qTopic}`} value={qq.topic} onChange={(e) => setQ(i, { topic: e.target.value })} placeholder="Topic" aria-label={`Question ${i + 1} topic`} maxLength={40} />
                <span className={s.qHeadActions}>
                  <MoveButtons what="question" disabled={regen.size > 0} onUp={() => move(i, -1)} onDown={() => move(i, 1)} upDisabled={i === 0} downDisabled={i === d.questions.length - 1} />
                  <button type="button" className="btn sm" onClick={() => regenerateOne(i)} disabled={regen.has(i) || !!gen} title="Ask the AI for a different question on the same topic">
                    <RefreshCw aria-hidden="true" className={regen.has(i) ? s.spinIco : ""} />{regen.has(i) ? "Rewriting…" : "New version"}
                  </button>
                  <button type="button" className={s.iconBtn} disabled={regen.size > 0} onClick={() => setD((x) => ({ ...x, questions: x.questions.filter((_, k) => k !== i) }))} aria-label={`Delete question ${i + 1}`} title="Delete question"><Trash2 /></button>
                </span>
              </div>
              <label className="field">Question
                <textarea rows={2} value={qq.q} onChange={(e) => setQ(i, { q: e.target.value })} />
              </label>
              <ChoiceRows choices={qq.c} answer={qq.a} onChoices={(c) => setQ(i, { c })} onAnswer={(a) => setQ(i, { a })} />
              <div className="grid2">
                <label className="field">Citation
                  <input value={qq.ref} onChange={(e) => setQ(i, { ref: e.target.value })} placeholder="NEC 2023 210.8(A)(1)" />
                  <span className="hint">Code book and section students can look up.</span>
                </label>
                <label className="field">Explanation
                  <textarea rows={2} value={qq.why} onChange={(e) => setQ(i, { why: e.target.value })} placeholder="Why the right answer is right." style={{ minHeight: 64 }} />
                </label>
              </div>
            </article>
          ))}
          <div><button type="button" className="btn sm" onClick={() => setD((x) => ({ ...x, questions: [...x.questions, { t: fallbackT, topic: m.topic.trim() || "General", q: "", c: ["", "", "", ""], a: 0, ref: "", why: "" }] }))}>
            <Plus aria-hidden="true" />Add a blank question
          </button></div>
        </section>
      )}

      {(d.questions.length > 0 || d.id) && (
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <FormPanel code="Form AT-2 · Save" title="Save the practice test">
            <label className="field"><span>Title <span className="req">*</span></span>
              <input value={d.title} onChange={(e) => setD((x) => ({ ...x, title: e.target.value }))} maxLength={160} placeholder={autoTitle(m, d.questions.length)} />
            </label>
            <Toggle checked={d.is_free} onChange={(v) => setD((x) => ({ ...x, is_free: v }))} label="Free for everyone"
              hint="On = free accounts can take it too (a good teaser). Off = only students who bought a course." />
            <Toggle checked={d.published} onChange={(v) => setD((x) => ({ ...x, published: v }))} label="Publish"
              hint="On = students can see and take it. Leave off while you review." />
            {problem && <p className="err" role="alert" style={{ margin: 0 }}>{problem}</p>}
            <button type="submit" className="btn navy cta block" disabled={saving || !!gen || (!dirty && !!d.id)}>
              {saving ? "Saving…" : d.id ? (dirty ? "Save practice test" : "All changes saved") : "Save practice test"}
            </button>
          </FormPanel>
        </form>
      )}

      {d.questions.length === 0 && !gen && (
        <div className="card">
          <Empty icon={Sparkles} title="No questions yet">Pick the trade, state and section above, then let the AI write them. You can also add questions by hand.
          </Empty>
          <div className="center"><button type="button" className="btn sm" onClick={() => setD((x) => ({ ...x, questions: [{ t: fallbackT, topic: m.topic.trim() || "General", q: "", c: ["", "", "", ""], a: 0, ref: "", why: "" }] }))}><Plus aria-hidden="true" />Write one by hand</button></div>
        </div>
      )}

      <SaveBar dirty={dirty} saving={saving} onSave={save} label="Save practice test" disabledReason={gen ? "The AI is writing… wait for it to finish" : undefined} />
    </div>
  );
}
