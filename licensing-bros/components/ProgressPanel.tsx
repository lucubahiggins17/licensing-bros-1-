"use client";
import { useState } from "react";
import { ClipboardCheck, Flame, ListChecks, Gauge, Trophy } from "lucide-react";
import { useApp, TopicBar, PanelHead, AiErrorNote } from "./ctx";
import { REFS, TRADES } from "@/lib/data";
import { BADGES, daysLeft, readiness, streak } from "@/lib/progress";
import { generate, md } from "@/lib/ai";
import { supabase } from "@/lib/supabaseClient";
import s from "./Study.module.css";

const BADGE_ICONS: Record<string, any> = { first_exam: ClipboardCheck, streak_7: Flame, q_100: ListChecks, ready_70: Gauge, ready_85: Trophy };

export default function ProgressPanel() {
  const { p, update } = useApp();
  const [plan, setPlan] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<any>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [delMsg, setDelMsg] = useState("");

  async function deleteAccount() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDelMsg("Deleting…");
    try {
      await generate({ kind: "delete_account" });
      try { Object.keys(localStorage).filter((k) => k.startsWith("licensingbros.progress")).forEach((k) => localStorage.removeItem(k)); } catch { /* storage blocked */ }
      await supabase().auth.signOut();
    } catch (e: any) { setDelMsg(e?.message || "Couldn't delete the account."); setConfirmDelete(false); }
  }

  const st = p.stats[p.trade] || {};
  const ents = Object.entries(st).sort((a, b) => a[1].c / a[1].a - b[1].c / b[1].a);
  let c = 0, a = 0; ents.forEach(([, v]) => { c += v.c; a += v.a; });
  const r = readiness(p);
  const hist = p.hist.filter((h) => h.trade === p.trade).slice(0, 8);
  const days = streak(p);
  const earned = BADGES.filter((b) => p.badges[b.id]).length;

  async function buildPlan() {
    setBusy(true); setErr(null);
    try {
      const weak = ents.map(([k, v]) => `${k}: ${Math.round((100 * v.c) / v.a)}% of ${v.a}`).join("; ");
      const res = await generate<{ text: string }>({ kind: "plan", state: p.state, trade: p.trade, days: daysLeft(p.examDate), weak });
      setPlan(res.text);
    } catch (e: any) { setErr(e); }
    setBusy(false);
  }

  function reset() {
    if (!confirmReset) { setConfirmReset(true); return; }
    setConfirmReset(false);
    update((prev) => {
      const stats = { ...prev.stats }; delete stats[prev.trade];
      const cards = Object.fromEntries(Object.entries(prev.cards).filter(([k]) => !k.startsWith(prev.trade + ":")));
      const missed = Object.fromEntries(Object.entries(prev.missed).filter(([, m]) => m.trade !== prev.trade));
      return { ...prev, stats, cards, missed, hist: prev.hist.filter((h) => h.trade !== prev.trade) };
    });
  }

  return (
    <section className="panel">
      <PanelHead eyebrow="Progress" title="Your" accent="progress"
        lede="Accuracy by topic across exams, reviews, games and flashcards. Your weakest topics drive Smart Review and the study plan." />
      <div className="grid2">
        <div className="card">
          <div className="stat">
            <div><b>{r ?? "—"}</b><span>Readiness</span></div>
            <div><b>{a}</b><span>Answered</span></div>
            <div><b>{a ? Math.round((100 * c) / a) + "%" : "—"}</b><span>Accuracy</span></div>
            <div><b>{days}</b><span>Day streak</span></div>
            <div><b>{p.xp.toLocaleString()}</b><span>XP</span></div>
          </div>
          <h3 style={{ fontSize: 22, marginTop: 16 }}>By topic</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            {ents.length ? ents.map(([k, v]) => <TopicBar key={k} name={k} {...v} />) : <p className="empty">Take a mock exam, a Smart Review or a game to see your topic breakdown.</p>}
          </div>
        </div>
        <div className="card">
          <h3 style={{ fontSize: 22 }}>Study plan</h3>
          <p className="note">Built from your exam date and weakest topics.</p>
          <button className="btn primary" onClick={buildPlan} disabled={busy}>{busy ? "Building your plan…" : plan ? "Rebuild my plan" : "Build my plan"}</button>
          {err && <div style={{ marginTop: 10 }}><AiErrorNote error={err} onRetry={buildPlan} /></div>}
          {plan && <div className="msg ai" style={{ maxWidth: "100%", marginTop: 12 }} dangerouslySetInnerHTML={{ __html: md(plan) }} />}
          <h3 style={{ fontSize: 22, marginTop: 18 }}>Recent sessions</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {hist.length ? hist.map((h, i) => (
              <div key={i} className="row" style={{ justifyContent: "space-between", fontSize: 14, borderBottom: "1px solid var(--line)", paddingBottom: 4 }}>
                <span><b>{h.kind}</b> · {h.detail}</span><span className="note">{new Date(h.at).toLocaleDateString()}</span>
              </div>
            )) : <p className="empty">No sessions yet.</p>}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn sm" onClick={reset}>{confirmReset ? `Tap again to erase ${TRADES[p.trade]} progress` : "Reset progress"}</button>
            <button className="btn sm" onClick={() => supabase().auth.signOut()}>Sign out</button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm" style={{ color: "var(--bad)" }} onClick={deleteAccount}>{confirmDelete ? "Tap again to permanently delete your account" : "Delete my account"}</button>
            {delMsg && <span className="note">{delMsg}</span>}
          </div>
        </div>
      </div>
      <div className="card">
        <div className="row between">
          <h3 style={{ fontSize: 22 }}>Badges</h3>
          <span className="note">{earned} of {BADGES.length} earned · 2 XP per question, +10 when correct, +50 per finished exam</span>
        </div>
        <div className={s.shelf}>
          {BADGES.map((b) => {
            const Icon = BADGE_ICONS[b.id] || Trophy;
            const at = p.badges[b.id];
            const prog = Math.min(b.goal, b.progress(p));
            return (
              <div key={b.id} className={`${s.badgeCard}${at ? ` ${s.earned}` : ""}`}>
                <span className={s.badgeIco}><Icon aria-hidden="true" /></span>
                <div className={s.badgeMeta}>
                  <b>{b.name}</b>
                  <small>{at ? `Earned ${new Date(at).toLocaleDateString()}` : `${b.desc} · ${prog}/${b.goal}`}</small>
                  {!at && <div className={s.badgeBar} aria-hidden="true"><i style={{ width: `${(100 * prog) / b.goal}%` }} /></div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="card">
        <h3 style={{ fontSize: 22 }}>Reference books to bring</h3>
        <p className="note">Typical references for this trade. Your state&rsquo;s Candidate Information Bulletin is the final word on editions and which books are allowed in the room.</p>
        <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>{REFS[p.trade].map((x) => <li key={x}>{x}</li>)}</ul>
      </div>
    </section>
  );
}
