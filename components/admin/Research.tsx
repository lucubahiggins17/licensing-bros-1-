"use client";
// Bro's research desk (in Knowledge): the knowledge base keeps learning. Shows questions students asked that the
// knowledge base couldn't answer well, the studies the desk ran (each finding with its verdict and source), and lets
// staff send it to research something now. Admins publish or discard findings that need a person.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ExternalLink, FlaskConical, HelpCircle, Loader2, RotateCcw, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { callFn } from "@/lib/api";
import { STATES } from "@/lib/data";
import { errMsg, num, relTime } from "./format";
import { useAdmin, useMounted, ErrorBox, FormPanel, Loading } from "./ui";
import { KB_TRADES } from "./Knowledge";
import r from "./Research.module.css";

type Verdict = "confirmed" | "corrected" | "disputed" | "unclear";
type Claim = { claim: string; source_url: string | null; source_title: string | null; verdict: Verdict; correction?: string | null; note?: string | null; conflicts: string[]; official: boolean; kept: boolean };
type Study = { id: string; topic: string; trade: string | null; state: string | null; origin: "schedule" | "gap" | "staff"; status: string; claims: Claim[]; summary: string | null; flags: number; tokens: number; error: string | null; created_at: string; finished_at: string | null };
type Gap = { id: string; question: string; trade: string | null; state: string | null; hits: number; reason: string; last_seen: string };
type Stats = { studies_week: number; learned_week: number; flags_week: number; tokens_week: number; open_gaps: number; waiting_review: number; published_total: number };
type Auto = { enabled: boolean; config: Record<string, any>; last_run_at: string | null; last_result: string | null } | null;
type Data = { studies: Study[]; gaps: Gap[]; stats: Stats | null; automation: Auto };

const STATUS: Record<string, { label: string; tone: string }> = {
  queued: { label: "Queued", tone: "info" }, running: { label: "Researching", tone: "info" }, published: { label: "Published", tone: "ok" },
  review: { label: "Needs review", tone: "warn" }, nothing: { label: "Nothing confirmed", tone: "muted" }, failed: { label: "Failed", tone: "bad" }, rejected: { label: "Discarded", tone: "muted" }
};
const VERDICT: Record<Verdict, { label: string; Icon: any; tone: string }> = {
  confirmed: { label: "Confirmed", Icon: ShieldCheck, tone: "ok" }, corrected: { label: "Corrected", Icon: Check, tone: "ok" },
  disputed: { label: "Disputed", Icon: AlertTriangle, tone: "bad" }, unclear: { label: "Couldn't confirm", Icon: HelpCircle, tone: "muted" }
};
const ORIGIN: Record<Study["origin"], string> = { schedule: "Scheduled", gap: "Student question", staff: "Asked by staff" };

export default function ResearchDesk() {
  const { toast, role, nav } = useAdmin();
  const mounted = useMounted();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [topic, setTopic] = useState("");
  const [trade, setTrade] = useState("gc");
  const [state, setState] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await callFn<Data>("research", { action: "list" });
      if (mounted.current) { setData(d); setErr(""); }
    } catch (e) {
      if (mounted.current) setErr(errMsg(e, "Couldn't load the research desk. Check that Build Android app has deployed the functions and that schema.sql was rerun."));
    }
  }, [mounted]);
  useEffect(() => { load(); }, [load]);
  // Follow studies while they run
  const running = !!data?.studies.some((x) => x.status === "queued" || x.status === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [running, load]);

  async function act(key: string, body: Record<string, unknown>, msg: string) {
    setBusy(key);
    try { await callFn("research", body); toast(msg); await load(); }
    catch (e) { toast(errMsg(e), "bad"); }
    if (mounted.current) setBusy(null);
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (topic.trim().length < 8) { toast("Say what to research in a few words.", "bad"); return; }
    await act("queue", { action: "queue", topic: topic.trim(), trade, state: state || null }, "Research started. Findings that pass the check appear here in a few minutes.");
    if (mounted.current) setTopic("");
  }

  const a = data?.automation;
  const st = data?.stats;
  return (
    <FormPanel code={a?.enabled ? "Learning" : "Paused"} title="Bro's research desk"
      aside={<button type="button" className="btn sm" onClick={() => nav("automations")}>Schedule</button>}>
      <p className="note" style={{ marginTop: 0 }}>
        Bro keeps studying on its own: questions students asked that the knowledge base couldn&rsquo;t answer well, then the license, exam and code-adoption rules for the states and trades your students study. A second, independent check re-verifies every finding against official sources (state boards, statutes, ICC, NFPA, OSHA, testing companies). Only confirmed findings go into the library; anything disputed or that disagrees with a built-in fact waits for an admin here.
      </p>

      {err ? <ErrorBox text={err} onRetry={load} /> : !data ? <Loading text="Loading the research desk…" /> : (
        <>
          <div className={r.chips}>
            <span className={r.chip} data-tone={a?.enabled ? "ok" : "muted"}><Sparkles aria-hidden="true" />{a?.enabled ? `On · every ${a.config?.every_hours ?? 6}h · up to ${a.config?.daily_cap ?? 4} topics a day${a.config?.review_first ? " · review first" : ""}` : "Scheduled research is off"}</span>
            {st && <span className={r.chip}><b>{num(st.learned_week)}</b> facts learned this week</span>}
            {st && <span className={r.chip}><b>{num(st.studies_week)}</b> studies this week</span>}
            {st && st.waiting_review > 0 && <span className={r.chip} data-tone="warn"><b>{num(st.waiting_review)}</b> waiting for review</span>}
            {st && <span className={r.chip}><b>{num(st.open_gaps)}</b> open questions</span>}
          </div>
          {a?.last_result && <p className="note" style={{ margin: 0 }}>Last scheduled run {relTime(a.last_run_at)}: {a.last_result}</p>}

          <form className={r.ask} onSubmit={start}>
            <label className="field" style={{ flex: "2 1 280px" }}>Research something now
              <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Georgia preliminary lien notice deadlines" maxLength={300} />
            </label>
            <label className="field" style={{ flex: "1 1 150px" }}>Trade
              <select value={trade} onChange={(e) => setTrade(e.target.value)}>{Object.entries(KB_TRADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <label className="field" style={{ flex: "1 1 150px" }}>State
              <select value={state} onChange={(e) => setState(e.target.value)}><option value="">National</option>{STATES.map((x) => <option key={x}>{x}</option>)}</select>
            </label>
            <button type="submit" className="btn primary" disabled={busy === "queue"}><FlaskConical aria-hidden="true" />{busy === "queue" ? "Starting…" : "Research it"}</button>
          </form>

          <div className={r.cols}>
            <section aria-labelledby="gaps-h" className={r.col}>
              <h3 id="gaps-h" className={r.h3}>Questions Bro couldn&rsquo;t answer well</h3>
              <p className="note" style={{ margin: "0 0 8px" }}>Logged by the tutor with nothing about who asked. The desk researches the most-asked first.</p>
              {data.gaps.length === 0 ? <p className={r.empty}>None right now. The knowledge base covered everything students asked.</p> : (
                <ul className={r.gaps}>
                  {data.gaps.map((g) => (
                    <li key={g.id}>
                      <span className={r.gapQ}>&ldquo;{g.question}&rdquo;</span>
                      <span className={r.gapMeta}>{g.trade ? KB_TRADES[g.trade] : "Any trade"}{g.state ? ` · ${g.state}` : ""} · asked {g.hits}× · {relTime(g.last_seen)}{g.reason === "state" ? " · state rule" : ""}</span>
                      <span className={r.gapBtns}>
                        <button type="button" className="btn sm" disabled={!!busy} onClick={() => act(`g${g.id}`, { action: "research_gap", gap_id: g.id }, "Researching that question now.")}><Search aria-hidden="true" />Research</button>
                        <button type="button" className="btn sm ghost" disabled={!!busy} onClick={() => act(`d${g.id}`, { action: "dismiss_gap", gap_id: g.id }, "Dismissed.")} aria-label={`Dismiss: ${g.question}`}><X aria-hidden="true" /></button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="studies-h" className={r.col}>
              <h3 id="studies-h" className={r.h3}>Recent studies</h3>
              {data.studies.length === 0 ? <p className={r.empty}>No studies yet. The first scheduled run starts within a few hours, or research something above.</p> : (
                <ul className={r.studies}>
                  {data.studies.map((x) => <StudyRow key={x.id} x={x} open={open === x.id} onToggle={() => setOpen(open === x.id ? null : x.id)} admin={role === "admin"} busy={busy} act={act} />)}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </FormPanel>
  );
}

function StudyRow({ x, open, onToggle, admin, busy, act }: { x: Study; open: boolean; onToggle: () => void; admin: boolean; busy: string | null; act: (k: string, b: Record<string, unknown>, m: string) => Promise<void> }) {
  const s = STATUS[x.status] || { label: x.status, tone: "muted" };
  const kept = x.claims.filter((c) => c.kept).length;
  const reviewable = admin && (x.status === "review" || (x.status === "published" && x.flags > 0));
  const initial = useMemo(() => new Set(x.claims.map((c, i) => (c.kept || ((c.verdict === "confirmed" || c.verdict === "corrected") && !c.conflicts.length) ? i : -1)).filter((i) => i >= 0)), [x.claims]);
  const [pick, setPick] = useState<Set<number>>(initial);
  useEffect(() => setPick(initial), [initial]);
  const working = x.status === "queued" || x.status === "running";
  return (
    <li className={r.study} data-open={open ? "1" : "0"}>
      <button type="button" className={r.studyHead} onClick={onToggle} aria-expanded={open}>
        <span className={r.badge} data-tone={s.tone}>{working && <Loader2 className={r.spin} aria-hidden="true" />}{s.label}</span>
        <span className={r.studyTopic}>{x.topic}</span>
        <span className={r.studyMeta}>{ORIGIN[x.origin]}{x.state ? ` · ${x.state}` : ""}{x.trade ? ` · ${KB_TRADES[x.trade] || x.trade}` : ""} · {relTime(x.created_at)}{x.claims.length ? ` · ${kept} of ${x.claims.length} published` : ""}{x.flags ? ` · ${x.flags} to check` : ""}</span>
        <ChevronDown className={r.chev} aria-hidden="true" />
      </button>
      {open && (
        <div className={r.studyBody}>
          {x.summary && <p className={r.summary}>{x.summary}</p>}
          {x.error && <p className={r.error}>{x.error}</p>}
          {working && <p className="note" style={{ margin: 0 }}>Searching official sources, then a second check verifies each finding. This takes a few minutes.</p>}
          {x.claims.length > 0 && (
            <ol className={r.claims}>
              {x.claims.map((c, i) => {
                const v = VERDICT[c.verdict] || VERDICT.unclear;
                return (
                  <li key={i} className={r.claim} data-kept={c.kept ? "1" : "0"}>
                    {reviewable && (
                      <input type="checkbox" aria-label={`Publish finding ${i + 1}`} checked={pick.has(i)} onChange={(e) => setPick((p) => { const n = new Set(p); e.target.checked ? n.add(i) : n.delete(i); return n; })} />
                    )}
                    <div className={r.claimBody}>
                      <span className={r.verdict} data-tone={v.tone}><v.Icon aria-hidden="true" />{v.label}{c.kept ? " · in the library" : ""}{!c.official && c.source_url ? " · not an official source" : ""}</span>
                      <p className={r.claimText}>{c.verdict === "corrected" && c.correction ? <><s className={r.struck}>{c.claim}</s> {c.correction}</> : c.claim}</p>
                      {c.note && <small className={r.noteLine}>{c.note}</small>}
                      {c.conflicts.length > 0 && <small className={r.conflict}><AlertTriangle aria-hidden="true" />Disagrees with built-in fact {c.conflicts.join(", ")}. If this finding is right, that fact may be out of date.</small>}
                      {c.source_url && <a className={r.src} href={c.source_url} target="_blank" rel="noreferrer">{c.source_title || c.source_url}<ExternalLink aria-hidden="true" /></a>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <div className={r.studyBtns}>
            {reviewable && <button type="button" className="btn sm primary" disabled={!!busy} onClick={() => act(`a${x.id}`, { action: "approve", id: x.id, keep: [...pick] }, pick.size ? `Published ${pick.size} finding${pick.size === 1 ? "" : "s"} to the library.` : "Nothing published.")}><Check aria-hidden="true" />Publish {pick.size} selected</button>}
            {admin && !working && x.status !== "rejected" && <button type="button" className="btn sm ghost" disabled={!!busy} onClick={() => act(`r${x.id}`, { action: "reject", id: x.id }, "Discarded. Nothing from this study is in the library.")}><X aria-hidden="true" />Discard</button>}
            {(x.status === "failed" || x.status === "nothing") && <button type="button" className="btn sm" disabled={!!busy} onClick={() => act(`t${x.id}`, { action: "retry", id: x.id }, "Trying again.")}><RotateCcw aria-hidden="true" />Retry</button>}
          </div>
        </div>
      )}
    </li>
  );
}
