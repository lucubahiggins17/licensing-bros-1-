"use client";
// Knowledge library: what the AI knows. Shows the built-in verified facts, and lets admins and instructors add their
// own material (PDF bulletins, board rules, notes, web pages). Each document is split into cited passages the tutor
// and the AI builders search by keyword right away and by meaning once indexed.
import { useCallback, useEffect, useRef, useState } from "react";
import { BookMarked, Brain, FileText, Gauge, Globe, Library, Search, Trash2, Upload, ClipboardPaste, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { callFn } from "@/lib/api";
import { BANK, STATES, type Question } from "@/lib/data";
import { errMsg, fmtDate, num, plural, q } from "./format";
import { useAdmin, useDirty, useMounted, ConfirmButton, Empty, ErrorBox, FormPanel, Loading, SectionHead, Step } from "./ui";
import s from "./admin.module.css";
import ResearchDesk from "./Research";

type Doc = { id: string; title: string; kind: string; trade: string | null; state: string | null; source_url: string | null; status: string; error: string | null; chunk_count: number; char_count: number; created_at: string };
type Stats = { builtin: { facts: number; verified: number; byTrade: Record<string, number>; states: string[] }; library: { docs: number; passages: number; unindexed: number } };
type Hit = { id: string; ref: string; text: string; score: number };

export const KB_TRADES: Record<string, string> = { gc: "General Contractor", elec: "Electrical", plumb: "Plumbing", hvac: "HVAC / Mechanical", law: "Business & Law" };
const KINDS: Record<string, string> = { notes: "Study notes", bulletin: "Candidate bulletin", rules: "Board rules or statute", code: "Code summary", lesson: "Lesson material", web: "Web page", research: "Bro's research", other: "Other" };
type Mode = "file" | "paste" | "url";

export default function Knowledge() {
  const { toast } = useAdmin();
  const mounted = useMounted();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [err, setErr] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);

  const load = useCallback(async () => {
    setErr("");
    try {
      const rows = (await q(supabase().from("kb_docs").select("id,title,kind,trade,state,source_url,status,error,chunk_count,char_count,created_at").order("created_at", { ascending: false }).limit(300))) as Doc[];
      if (mounted.current) setDocs(rows || []);
    } catch (e: any) {
      if (!mounted.current) return;
      const m = String(e?.message || "");
      setErr(/kb_docs|does not exist|schema cache/i.test(m) ? "The knowledge library isn't set up in your database yet. In Supabase, open SQL Editor, paste all of supabase/schema.sql and click Run (it's safe to rerun), then reload this page." : errMsg(e, "Couldn't load the library."));
    }
    try { const st = await callFn<Stats>("library", { action: "stats" }); if (mounted.current) setStats(st); } catch { /* functions not deployed yet: the list still works */ }
  }, [mounted]);
  useEffect(() => { load(); }, [load]);

  async function remove(d: Doc) {
    try {
      await q(supabase().from("kb_docs").delete().eq("id", d.id));
      setDocs((r) => r?.filter((x) => x.id !== d.id) ?? r);
      toast("Removed from the library. The AI won't use it anymore.");
    } catch (e) { toast(errMsg(e), "bad"); }
  }

  const b = stats?.builtin;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <SectionHead eyebrow="What the AI knows" title="Knowledge" accent="library"
        sub="The tutor, the AI builders and the command center answer from these sources first. Add your bulletins, board rules and notes to make it smarter for your students." />

      <div className={s.statGrid}>
        <div className={`statcard navy ${s.stat}`}>
          <div className="ico"><ShieldCheck aria-hidden="true" /></div>
          <div className={s.statText}><b>{b ? num(b.facts) : "…"}</b><span className={s.statLabel}>Built-in verified facts</span>
            <span className={s.statHint}>{b ? `${num(b.verified)} checked against the codes` : "Checked against the codes and regulations"}</span></div>
        </div>
        {b && (["gc", "elec", "plumb", "hvac", "law"] as const).map((t) => (
          <div key={t} className={`statcard ${s.stat}`}>
            <div className="ico"><BookMarked aria-hidden="true" /></div>
            <div className={s.statText}><b>{num(b.byTrade[t] || 0)}</b><span className={s.statLabel}>{KB_TRADES[t]}</span></div>
          </div>
        ))}
        <div className={`statcard ${s.stat}`}>
          <div className="ico"><Library aria-hidden="true" /></div>
          <div className={s.statText}><b>{stats ? num(stats.library.docs) : docs ? num(docs.length) : "…"}</b><span className={s.statLabel}>Your documents</span>
            <span className={s.statHint}>{stats ? `${plural(stats.library.passages, "passage")}${stats.library.unindexed ? `, ${num(stats.library.unindexed)} waiting for meaning search` : ""}` : "Added by your team"}</span></div>
        </div>
      </div>
      {b && b.states.length > 0 && <p className="note" style={{ margin: 0 }}>State-specific facts built in for: {b.states.join(", ")}. Students only see their own state&rsquo;s rules.</p>}

      <ResearchDesk />
      <AddKnowledge onAdded={load} />
      <SearchTester />
      <AccuracyCheck />

      <section className="stack" style={{ gap: 10 }} aria-label="Your documents">
        <h3 className={s.h3}>Your documents</h3>
        {err ? <ErrorBox text={err} onRetry={load} /> : !docs ? <Loading text="Loading the library…" /> : !docs.length ? (
          <div className="card"><Empty icon={Library} title="No documents yet">Add a candidate bulletin, your state board&rsquo;s rules, or your own class notes above. The AI starts using them right away.</Empty></div>
        ) : (
          <ul className={s.cardList}>
            {docs.map((d) => (
              <li key={d.id} className={`card ${s.setRow}`}>
                <div className={s.setInfo}>
                  <b>{d.title}</b>
                  <span className="note">{KINDS[d.kind] || "Document"} · {d.trade ? KB_TRADES[d.trade] : "All trades"} · {d.state || "All states"} · {plural(d.chunk_count, "passage")} · {fmtDate(d.created_at)}</span>
                  {d.source_url && <a className="note" href={d.source_url} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere" }}>{d.source_url}</a>}
                  {d.status === "error" && <span className="note" style={{ color: "var(--bad)" }}>Couldn&rsquo;t finish: {d.error || "try adding it again"}</span>}
                </div>
                <div className={s.setActions}>
                  <span className={`badge ${d.status === "ready" ? "free" : ""}`}>{d.status === "ready" ? "In use" : d.status === "error" ? "Problem" : "Adding…"}</span>
                  <ConfirmButton className={s.iconBtn} title={`Remove ${d.title}`} onConfirm={() => remove(d)} message={<>Remove &ldquo;{d.title}&rdquo; from the library?</>} confirmLabel="Yes, remove"><Trash2 aria-hidden="true" /></ConfirmButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
function AddKnowledge({ onAdded }: { onAdded: () => void }) {
  const { toast } = useAdmin();
  const mounted = useMounted();
  const [mode, setMode] = useState<Mode>("file");
  const [title, setTitle] = useState("");
  const [trade, setTrade] = useState("");
  const [state, setState] = useState("");
  const [kind, setKind] = useState("bulletin");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<null | { step: string; pct: number }>(null);
  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useDirty("knowledge", !!busy || !!text.trim() || !!url.trim() || !!file);
  useEffect(() => () => abort.current?.abort(), []);

  function pickFile(f: File | null) {
    setFile(f);
    if (f && !title.trim()) setTitle(f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").slice(0, 200));
  }

  async function readFile(f: File, signal: AbortSignal): Promise<string> {
    if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") {
      const { pdfToText } = await import("@/lib/pdfText");
      return pdfToText(f, (i, n) => mounted.current && setBusy({ step: `Reading page ${i} of ${n}…`, pct: Math.round((i / n) * 35) }), signal);
    }
    if (f.size > 8_000_000) throw new Error("That file is over 8 MB. Split it into smaller files.");
    const raw = await f.text();
    if (/\.html?$/i.test(f.name)) {
      const doc = new DOMParser().parseFromString(raw, "text/html");
      doc.querySelectorAll("script,style,nav,header,footer,noscript").forEach((n) => n.remove());
      return (doc.body?.innerText || doc.body?.textContent || "").trim();
    }
    return raw;
  }

  async function add() {
    if (busy) return;
    if (mode !== "url" && !title.trim()) { toast("Give the document a title.", "bad"); return; }
    abort.current = new AbortController();
    const signal = abort.current.signal;
    try {
      let res: { doc_id: string; passages: number; truncated?: boolean; title?: string };
      const meta = { title: title.trim(), trade: trade || null, state: state || null, kind };
      if (mode === "url") {
        if (!/^https?:\/\//i.test(url.trim())) throw new Error("Paste a full web address starting with https://");
        setBusy({ step: "Reading the page…", pct: 15 });
        res = await callFn("library", { action: "add_url", url: url.trim(), ...meta, kind: "web" }, { signal });
      } else {
        let body = text;
        if (mode === "file") {
          if (!file) throw new Error("Choose a file first.");
          setBusy({ step: "Reading the file…", pct: 5 });
          body = await readFile(file, signal);
        }
        if (body.trim().length < 20) throw new Error(mode === "file" ? "No readable text found in that file. Scanned PDFs (pictures of pages) can't be read; use a text PDF." : "Paste some text first.");
        setBusy({ step: "Splitting it into passages…", pct: 40 });
        res = await callFn("library", { action: "add_text", ...meta, text: body }, { signal });
      }
      if (!mounted.current) return;
      toast(`Added ${plural(res.passages, "passage")}. The AI can search it by keyword now.${res.truncated ? " It was very long, so only the first part was kept." : ""}`);
      onAdded();
      // Meaning search: index a few passages per call until done
      let remaining = res.passages, total = res.passages, guard = 0;
      while (remaining > 0 && guard++ < 2000 && !signal.aborted) {
        setBusy({ step: `Teaching the AI what it means… ${num(total - remaining)} of ${num(total)} passages`, pct: 45 + Math.round(((total - remaining) / Math.max(1, total)) * 55) });
        const r = await callFn<{ done: number; remaining: number; available: boolean }>("library", { action: "embed", doc_id: res.doc_id }, { signal });
        if (!r.available) { toast("Meaning search isn't available on this server, so this document uses keyword search only. That still works well.", "info"); break; }
        if (r.done === 0) break;
        remaining = r.remaining;
        total = Math.max(total, remaining);
      }
      if (!mounted.current) return;
      setText(""); setUrl(""); setFile(null); setTitle("");
      if (fileRef.current) fileRef.current.value = "";
      onAdded();
    } catch (e: any) {
      if (mounted.current && e?.name !== "AbortError") toast(errMsg(e, "Couldn't add that. Try again."), "bad");
    }
    if (mounted.current) setBusy(null);
  }

  return (
    <FormPanel code="Form KL-1 · Knowledge library" title="Teach the AI something new">
      <div className={`seg ${s.kbModes}`} role="group" aria-label="What are you adding?">
        <button type="button" aria-pressed={mode === "file"} onClick={() => setMode("file")} disabled={!!busy}><Upload aria-hidden="true" />Upload a file</button>
        <button type="button" aria-pressed={mode === "paste"} onClick={() => setMode("paste")} disabled={!!busy}><ClipboardPaste aria-hidden="true" />Paste text</button>
        <button type="button" aria-pressed={mode === "url"} onClick={() => setMode("url")} disabled={!!busy}><Globe aria-hidden="true" />Web page</button>
      </div>
      <Step n={1}>The material</Step>
      {mode === "file" && (
        <label className="field">File (PDF, TXT, Markdown, HTML or CSV)
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.markdown,.html,.htm,.csv,application/pdf,text/plain,text/markdown,text/html,text/csv" disabled={!!busy}
            onChange={(e) => pickFile(e.target.files?.[0] || null)} />
          <span className="hint">The text is read on your device; only the text is saved. Scanned page images can&rsquo;t be read.</span>
        </label>
      )}
      {mode === "paste" && (
        <label className="field">Text
          <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} disabled={!!busy} placeholder="Paste class notes, a board rule, a bulletin section…" />
          <span className="hint">{text ? `${num(text.length)} characters` : "Headings on their own line become the citation for the passages under them."}</span>
        </label>
      )}
      {mode === "url" && (
        <label className="field">Web address
          <input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} disabled={!!busy} placeholder="https://www.tn.gov/commerce/regboards/contractors.html" />
          <span className="hint">Best for official pages: state boards, statutes, PSI bulletins. PDFs: download them and upload the file instead.</span>
        </label>
      )}
      <Step n={2}>Who it&rsquo;s for</Step>
      <div className="grid2">
        <label className="field">Title{mode === "url" ? " (optional)" : ""}
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!!busy} maxLength={200} placeholder={mode === "url" ? "Uses the page title if empty" : "Tennessee BC candidate bulletin 2026"} />
        </label>
        <label className="field">Type
          <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={!!busy || mode === "url"}>
            {Object.entries(KINDS).filter(([k]) => mode === "url" ? k === "web" : k !== "web").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">Trade
          <select value={trade} onChange={(e) => setTrade(e.target.value)} disabled={!!busy}>
            <option value="">All trades</option>
            {Object.entries(KB_TRADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">State
          <select value={state} onChange={(e) => setState(e.target.value)} disabled={!!busy}>
            <option value="">All states (national)</option>
            {STATES.map((st) => <option key={st} value={st}>{st}</option>)}
          </select>
          <span className="hint">State material is only used for students in that state.</span>
        </label>
      </div>
      <div className={s.warnBox}><FileText aria-hidden="true" /><p>Only add material you have the right to use, like official bulletins, public rules and your own notes. Don&rsquo;t upload copyrighted code books.</p></div>
      {busy ? (
        <div className={s.genBox} role="status" aria-live="polite">
          <div className={s.genTop}><span className="spin" aria-hidden="true" /><div><b>{busy.step}</b><p className="note" style={{ margin: 0 }}>You can keep this tab open while it finishes. Big documents take a few minutes.</p></div></div>
          <div className="bar" aria-hidden="true"><i style={{ width: `${Math.max(4, Math.min(100, busy.pct))}%` }} /></div>
          <div><button type="button" className="btn sm" onClick={() => abort.current?.abort()}>Stop</button></div>
        </div>
      ) : (
        <button type="button" className="btn primary cta block" onClick={add}><Brain aria-hidden="true" />Add to the AI&rsquo;s knowledge</button>
      )}
    </FormPanel>
  );
}

// ------------------------------------------------------------------------------------------------
function SearchTester() {
  const { toast } = useAdmin();
  const [query, setQuery] = useState("");
  const [trade, setTrade] = useState("");
  const [state, setState] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    if (query.trim().length < 3) return;
    setBusy(true);
    try { setHits((await callFn<{ hits: Hit[] }>("library", { action: "search", query: query.trim(), trade: trade || null, state: state || null })).hits || []); }
    catch (er) { toast(errMsg(er), "bad"); }
    setBusy(false);
  }

  return (
    <section className="card hard stack" style={{ gap: 12 }} aria-label="Test the library search">
      <div className={s.cardHead}><h3><Search aria-hidden="true" style={{ width: 18, height: 18, verticalAlign: "-3px", marginRight: 6 }} />Test what the AI finds</h3></div>
      <form className="stack" style={{ gap: 10 }} onSubmit={run}>
        <div className="grid2">
          <label className="field span2" style={{ gridColumn: "1 / -1" }}>Ask like a student would
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="How long do I have to file a lien in Tennessee?" />
          </label>
          <label className="field">Trade
            <select value={trade} onChange={(e) => setTrade(e.target.value)}><option value="">Any</option>{Object.entries(KB_TRADES).filter(([k]) => k !== "law").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label className="field">State
            <select value={state} onChange={(e) => setState(e.target.value)}><option value="">Any</option>{STATES.map((st) => <option key={st} value={st}>{st}</option>)}</select>
          </label>
        </div>
        <button type="submit" className="btn navy" disabled={busy || query.trim().length < 3}><Search aria-hidden="true" />{busy ? "Searching…" : "Search your library"}</button>
      </form>
      {hits && (hits.length ? (
        <ol className="stack" style={{ gap: 8, margin: 0, paddingLeft: 20 }}>
          {hits.map((h) => <li key={h.id}><b>{h.ref}</b><p className="note" style={{ margin: "2px 0 0" }}>{h.text.length > 320 ? `${h.text.slice(0, 320)}…` : h.text}</p></li>)}
        </ol>
      ) : <p className="note" style={{ margin: 0 }}>Nothing in your library matches yet. The tutor still answers from the built-in verified facts.</p>)}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------
type Graded = { q: Question; pick: number | null; why: string };
const SIZES = [20, 50, 100];

/** Runs real exam-style questions from the verified bank through the tutor (same facts, routing and calculator
 *  students get) and grades the answers, so you can see the accuracy instead of trusting it. */
function AccuracyCheck() {
  const { toast } = useAdmin();
  const mounted = useMounted();
  const [trade, setTrade] = useState("all");
  const [size, setSize] = useState(20);
  const [state, setState] = useState("Tennessee");
  const [run, setRun] = useState<null | { done: number; total: number }>(null);
  const [graded, setGraded] = useState<Graded[] | null>(null);
  const stop = useRef(false);

  async function start() {
    const pool = BANK.filter((x) => trade === "all" || x.t === trade || (trade === "law" && x.t === "law"));
    if (!pool.length) { toast("No verified questions for that trade yet.", "info"); return; }
    const pick = [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(size, pool.length));
    stop.current = false;
    setGraded([]);
    setRun({ done: 0, total: pick.length });
    const out: Graded[] = [];
    try {
      for (let i = 0; i < pick.length && !stop.current; i += 5) {
        const batch = pick.slice(i, i + 5);
        const r = await callFn<{ results: { pick: number | null; why: string }[] }>("library", {
          action: "accuracy_check", questions: batch.map((x) => ({ q: x.q, c: x.c, trade: x.t, state }))
        });
        batch.forEach((x, k) => out.push({ q: x, pick: r.results?.[k]?.pick ?? null, why: r.results?.[k]?.why || "" }));
        if (!mounted.current) return;
        setGraded([...out]);
        setRun({ done: out.length, total: pick.length });
      }
    } catch (e) { toast(errMsg(e, "The check stopped. Try again."), "bad"); }
    if (mounted.current) setRun(null);
  }

  const right = (graded || []).filter((g) => g.pick === g.q.a).length;
  const total = (graded || []).length;
  const misses = (graded || []).filter((g) => g.pick !== g.q.a);
  const pct = total ? Math.round((right / total) * 100) : 0;
  return (
    <section className="card hard stack" style={{ gap: 12 }} aria-label="Accuracy check">
      <div className={s.cardHead}><h3><Gauge aria-hidden="true" style={{ width: 18, height: 18, verticalAlign: "-3px", marginRight: 6 }} />Accuracy check</h3></div>
      <p className="note" style={{ margin: 0 }}>The tutor answers real exam-style questions from the verified bank, using exactly what students get, and we grade it against the known answers. Each question uses one AI request.</p>
      <div className="grid2">
        <label className="field">Trade
          <select value={trade} onChange={(e) => setTrade(e.target.value)} disabled={!!run}>
            <option value="all">All trades</option>
            {Object.entries(KB_TRADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">Questions
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} disabled={!!run}>{SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
        <label className="field">Student&rsquo;s state
          <select value={state} onChange={(e) => setState(e.target.value)} disabled={!!run}>{STATES.map((st) => <option key={st} value={st}>{st}</option>)}</select>
        </label>
      </div>
      {run ? (
        <div className={s.genBox} role="status" aria-live="polite">
          <div className={s.genTop}><span className="spin" aria-hidden="true" /><div><b>Checking {run.done} of {run.total}…{total ? ` ${right} right so far` : ""}</b></div></div>
          <div className="bar" aria-hidden="true"><i style={{ width: `${Math.max(4, (run.done / run.total) * 100)}%` }} /></div>
          <div><button type="button" className="btn sm" onClick={() => { stop.current = true; }}>Stop</button></div>
        </div>
      ) : (
        <button type="button" className="btn navy" onClick={start}><Gauge aria-hidden="true" />Run the accuracy check</button>
      )}
      {graded && total > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <p style={{ margin: 0, fontSize: 18 }}><b>{right} of {total} right ({pct}%)</b>{run ? "" : misses.length ? " · misses below" : " · perfect score"}</p>
          {misses.slice(0, 20).map((g, i) => (
            <details key={i} className="note" style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}>
              <summary style={{ cursor: "pointer" }}>{g.q.q}</summary>
              <p style={{ margin: "6px 0 0" }}>Correct: <b>{"ABCD"[g.q.a]}. {g.q.c[g.q.a]}</b> ({g.q.ref}) · Tutor picked: <b>{g.pick === null ? "no clear answer" : `${"ABCD"[g.pick]}. ${g.q.c[g.pick]}`}</b></p>
              {g.why && <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{g.why}</p>}
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
