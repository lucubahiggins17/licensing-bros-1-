"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, RotateCcw, ClipboardCheck, Gamepad2, Layers, Calculator, TrendingUp, Flame, Zap } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/auth";
import { STATES, TRADES, TradeKey, Question } from "@/lib/data";
import {
  BADGES, EMPTY, Progress, dailyGoal, daysLeft, dueMissed, localDay, normalize, readiness, streak, studiedToday,
  withAnswer, withBadges, withRecord, withSession
} from "@/lib/progress";
import { celebrate } from "@/components/motion";
import { takePendingAsk } from "@/lib/pendingAsk";
import { AppCtx, TalkOpts } from "@/components/ctx";
import Tutor from "@/components/Tutor";
import Review from "@/components/Review";
import Exam from "@/components/Exam";
import Games from "@/components/Games";
import Flashcards from "@/components/Flashcards";
import Calcs from "@/components/Calcs";
import ProgressPanel from "@/components/ProgressPanel";
import TalkMode, { TalkButton } from "@/components/voice/TalkMode";
import { primeSpeech } from "@/components/voice/speech";
import { IS_APP_BUILD, onBackButton, setupNativeChrome } from "@/lib/native";
import s from "./Study.module.css";

const TABS = [
  ["tutor", "AI Tutor", MessageCircle],
  ["review", "Smart Review", RotateCcw],
  ["exam", "Mock Exam", ClipboardCheck],
  ["games", "Games", Gamepad2],
  ["cards", "Flashcards", Layers],
  ["tools", "Field Calcs", Calculator],
  ["progress", "Progress", TrendingUp]
] as const;
type Tab = (typeof TABS)[number][0];
const isTab = (h: string): h is Tab => TABS.some(([k]) => k === h);
const LOCAL = "licensingbros.progress";
const FAB_TABS: Tab[] = ["review", "games", "cards", "tools", "progress"];
type Picks = Partial<Pick<Progress, "state" | "trade" | "examDate">>;

const readLocal = (key: string) => {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
};

// The signed-in study workspace at /learn/ (#tutor #review #exam #games #cards #tools #progress).
export default function Workspace({ onSignedOut }: { onSignedOut: () => void }) {
  const { profile, refresh } = useAuth();
  const [userId, setUserId] = useState<string | null>(null);
  const [p, setP] = useState<Progress>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>("tutor");
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "offline">("");
  const [recovery, setRecovery] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [talk, setTalk] = useState<TalkOpts & { open: boolean }>({ open: false });
  const [toast, setToast] = useState("");
  const saveTimer = useRef<any>(null);
  const firstLoad = useRef(true);
  const userRef = useRef<string | null>(null);
  const isNew = useRef(false);
  const seeded = useRef(false);
  const profTimer = useRef<any>(null);
  const profPending = useRef<Picks>({});
  const badgeSeen = useRef<Set<string> | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  // Auth + initial load
  useEffect(() => {
    const sb = supabase();
    let alive = true;
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") onSignedOut();
    });
    (async () => {
      const { data } = await sb.auth.getSession();
      const session = data.session;
      if (!session) { onSignedOut(); return; }
      const uid = session.user.id;
      userRef.current = uid;
      setUserId(uid);
      const local = readLocal(`${LOCAL}.${uid}`);
      const { data: row, error } = await sb.from("progress").select("data").eq("user_id", uid).maybeSingle();
      if (!alive) return;
      let next: Progress;
      if (error) { next = normalize(local ?? readLocal(LOCAL)); setSaveState("offline"); }
      else if (row?.data && Object.keys(row.data).length) next = normalize(row.data);
      else if (local) next = normalize(local);
      else { next = normalize(null); isNew.current = true; } // brand-new record: state/trade/exam date come from the profile
      next = withBadges(next);
      badgeSeen.current = new Set(Object.keys(next.badges));
      setP(next);
      const h = window.location.hash.slice(1);
      if (isTab(h)) setTab(h);
      setLoaded(true);
    })();
    setupNativeChrome();
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [onSignedOut]);

  // New record: start from the profile's state, trade and exam date (the profile may load a moment later)
  useEffect(() => {
    if (!loaded || !isNew.current || seeded.current || !profile) return;
    seeded.current = true;
    setP((prev) => ({
      ...prev,
      state: STATES.includes(profile.state) ? profile.state : prev.state,
      trade: profile.trade in TRADES ? (profile.trade as TradeKey) : prev.trade,
      examDate: profile.exam_date || prev.examDate
    }));
  }, [loaded, profile]);

  // Debounced save to the database (and a copy on this device for offline use)
  useEffect(() => {
    if (!loaded || !userId) return;
    if (firstLoad.current) { firstLoad.current = false; return; }
    try { localStorage.setItem(`${LOCAL}.${userId}`, JSON.stringify(p)); } catch { /* storage blocked */ }
    clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(async () => {
      const { error } = await supabase().from("progress").upsert({ user_id: userId, data: p, updated_at: new Date().toISOString() });
      setSaveState(error ? "offline" : "saved");
    }, 1200);
  }, [p, loaded, userId]);

  // Celebrate new badges
  useEffect(() => {
    const seen = badgeSeen.current;
    if (!loaded || !seen) return;
    const fresh = Object.keys(p.badges).filter((k) => !seen.has(k));
    if (!fresh.length) return;
    fresh.forEach((k) => seen.add(k));
    const b = BADGES.find((x) => x.id === fresh[fresh.length - 1]);
    if (b) { setToast(`Badge earned: ${b.name}`); celebrate(); }
  }, [p.badges, loaded]);

  // Celebrate hitting today's question goal (once per day)
  const goalSeen = useRef<number | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const done = p.daily[localDay()] || 0;
    const goal = dailyGoal(p.examDate);
    const before = goalSeen.current;
    goalSeen.current = done;
    if (before !== null && before < goal && done >= goal) { setToast(`Daily goal reached: ${goal} questions`); celebrate(); }
  }, [p.daily, p.examDate, loaded]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const go = useCallback((t: Tab) => {
    setTab(t);
    if (!IS_APP_BUILD) history.replaceState(null, "", "#" + t);
    window.scrollTo({ top: 0 });
  }, []);

  // Links like /learn/#review while already on the page
  useEffect(() => {
    const onHash = () => { const h = window.location.hash.slice(1); if (isTab(h)) setTab(h); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Android back button: return to the tutor tab first
  const tabRef = useRef<Tab>("tutor");
  tabRef.current = tab;
  useEffect(() => onBackButton(() => { if (tabRef.current !== "tutor") { go("tutor"); return true; } return false; }), [go]);

  // Keep the selected tab visible in the sideways-scrolling tab row
  useEffect(() => {
    const bar = tabsRef.current;
    const el = bar?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    if (!bar || !el) return;
    const left = el.offsetLeft - 16, right = el.offsetLeft + el.offsetWidth + 16;
    if (left < bar.scrollLeft) bar.scrollTo({ left, behavior: "smooth" });
    else if (right > bar.scrollLeft + bar.clientWidth) bar.scrollTo({ left: right - bar.clientWidth, behavior: "smooth" });
  }, [tab, loaded]);

  const update = useCallback((fn: (p: Progress) => Progress) => setP((prev) => withBadges(fn(prev))), []);
  const record = useCallback((topic: string, ok: boolean) => update((prev) => withRecord(prev, topic, ok)), [update]);
  const answer = useCallback((q: Question, ok: boolean) => update((prev) => withAnswer(prev, q, ok)), [update]);
  const log = useCallback((kind: string, detail: string) => update((prev) => withSession(prev, kind, detail)), [update]);
  const askTutor = useCallback((text: string) => { setDraft(text); go("tutor"); }, [go]);
  const clearDraft = useCallback(() => setDraft(""), []);
  // A question handed over from another page (today's plan, the welcome screen)
  useEffect(() => { if (!loaded) return; const q = takePendingAsk(); if (q) askTutor(q); }, [loaded, askTutor]);
  const openTalk = useCallback((o?: TalkOpts) => { primeSpeech(); setTalk({ open: true, ...(o || {}) }); }, []);
  const closeTalk = useCallback(() => setTalk((t) => ({ ...t, open: false })), []);

  // State / trade / exam date picks also update the profile (debounced) so the rest of the site matches
  const saveProfile = useCallback(async (andRefresh = true) => {
    const patch = profPending.current;
    profPending.current = {};
    profTimer.current = null;
    const uid = userRef.current;
    if (!uid || !Object.keys(patch).length) return;
    const row: Record<string, string | null> = {};
    if (patch.state) row.state = patch.state;
    if (patch.trade) row.trade = patch.trade;
    if ("examDate" in patch) row.exam_date = patch.examDate || null;
    const { error } = await supabase().from("profiles").update(row).eq("id", uid);
    if (!error && andRefresh) refresh().catch(() => {});
  }, [refresh]);
  const saveProfileRef = useRef(saveProfile);
  saveProfileRef.current = saveProfile;
  useEffect(() => () => { if (profTimer.current) { clearTimeout(profTimer.current); saveProfileRef.current(false); } }, []);

  function setPick(patch: Picks) {
    seeded.current = true;
    update((x) => ({ ...x, ...patch }));
    Object.assign(profPending.current, patch);
    clearTimeout(profTimer.current);
    profTimer.current = setTimeout(() => saveProfileRef.current(), 1500);
  }

  async function setPassword(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase().auth.updateUser({ password: newPw });
    setPwMsg(error ? error.message : "Password updated.");
    if (!error) setTimeout(() => setRecovery(false), 1200);
  }

  function onTabKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = TABS.findIndex(([k]) => k === tab);
    const n = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    go(TABS[n][0]);
    tabsRef.current?.querySelector<HTMLElement>(`[data-tab="${TABS[n][0]}"]`)?.focus();
  }

  if (!loaded) return <main className="authwrap"><span className="spin" aria-hidden="true" /><span className="note">Loading your workspace…</span></main>;

  const r = readiness(p);
  const C = 2 * Math.PI * 19;
  const d = daysLeft(p.examDate);
  const st = streak(p);
  const today = studiedToday(p);
  const due = dueMissed(p).length;
  const fab = FAB_TABS.includes(tab);
  const panel = (k: Tab) => ({ role: "tabpanel", id: `panel-${k}`, "aria-labelledby": `tab-${k}`, hidden: tab !== k } as const);

  return (
    <AppCtx.Provider value={{ p, update, record, answer, log, askTutor, talk: openTalk }}>
      <header className={s.head}>
        <div className={`wrap ${s.headInner}`}>
          <div className={s.title}><small>Study HQ</small><b>My <span>Learning</span></b></div>
          <div className={s.picks}>
            <label className={s.pick} htmlFor="selState">State
              <select id="selState" value={p.state} onChange={(e) => setPick({ state: e.target.value })}>
                {STATES.map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
            <label className={s.pick} htmlFor="selTrade">Trade
              <select id="selTrade" value={p.trade} onChange={(e) => setPick({ trade: e.target.value as TradeKey })}>
                {(Object.keys(TRADES) as TradeKey[]).map((k) => <option key={k} value={k}>{TRADES[k]}</option>)}
              </select>
            </label>
            <label className={s.pick} htmlFor="examDate">Exam date
              <input id="examDate" type="date" value={p.examDate} onChange={(e) => setPick({ examDate: e.target.value })} />
            </label>
          </div>
          <div className={s.stats}>
            <div className={s.stat} aria-label={`Study streak: ${st} ${st === 1 ? "day" : "days"}`} title={today ? "You studied today. Nice." : st ? "Study today to keep your streak alive" : "Answer any question to start a streak"}>
              <span className={`${s.statIco}${today ? ` ${s.hot}` : ""}`}><Flame aria-hidden="true" /></span>
              <span><b>{st}</b><small>Streak</small></span>
            </div>
            <div className={s.stat} title="XP: 2 per question, +10 when correct, +50 per finished exam">
              <span className={s.statIco}><Zap aria-hidden="true" /></span>
              <span><b>{p.xp.toLocaleString()}</b><small>XP</small></span>
            </div>
            <div className={s.ring} title="Readiness score">
              <svg viewBox="0 0 46 46" aria-hidden="true">
                <circle cx="23" cy="23" r="19" fill="none" stroke="#ffffff22" strokeWidth="5" />
                <circle cx="23" cy="23" r="19" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${((r || 0) / 100) * C} ${C}`} transform="rotate(-90 23 23)" />
                <text x="23" y="27.5" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor" fontFamily="Archivo Black, Arial Black, sans-serif">{r ?? "—"}</text>
              </svg>
              <small><span className={s.srOnly}>Readiness score {r ?? "not set yet"}. </span>Readiness<br />{d === null ? "Set exam date" : d > 0 ? `${d} days to exam` : d === 0 ? "Exam today" : "Exam date passed"}</small>
            </div>
          </div>
        </div>
      </header>

      <nav className={s.tabsBar} aria-label="Study sections">
        <div className={`wrap ${s.tabsInner}`} role="tablist" ref={tabsRef} onKeyDown={onTabKey}>
          {TABS.map(([k, label, Icon]) => (
            <button key={k} type="button" role="tab" id={`tab-${k}`} data-tab={k} aria-controls={`panel-${k}`} aria-selected={tab === k} tabIndex={tab === k ? 0 : -1}
              className={`tab ${s.tab}`} onClick={() => go(k)}>
              <Icon aria-hidden="true" />{label}
              {k === "review" && due > 0 && <span className={s.dueDot} aria-label={`${due} due`}>{due}</span>}
            </button>
          ))}
        </div>
      </nav>

      <main className={`${s.main}${fab ? ` ${s.withFab}` : ""}`}>
        <div className="wrap">
          {recovery && (
            <form className="card row" onSubmit={setPassword} style={{ marginBottom: 16 }}>
              <label className="field" htmlFor="newPw" style={{ flex: "1 1 220px" }}>Set a new password
                <input id="newPw" type="password" minLength={8} required value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
              </label>
              <button className="btn primary">Save password</button>
              {pwMsg && <span className="note">{pwMsg}</span>}
            </form>
          )}
          <div {...panel("tutor")}><Tutor draft={draft} clearDraft={clearDraft} /></div>
          <div {...panel("review")}><Review /></div>
          <div {...panel("exam")}><Exam /></div>
          <div {...panel("games")}>{tab === "games" && <Games />}</div>
          <div {...panel("cards")}>{tab === "cards" && <Flashcards />}</div>
          <div {...panel("tools")}><Calcs /></div>
          <div {...panel("progress")}>{tab === "progress" && <ProgressPanel />}</div>
          <p className={`note ${s.saveNote}`} role="status">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Progress saved to your account." : saveState === "offline" ? "Couldn't reach the server. Progress is saved on this device for now." : ""}
          </p>
        </div>
      </main>

      {fab && !talk.open && <TalkButton onOpen={() => openTalk()} />}
      <TalkMode open={talk.open} onClose={closeTalk} context={talk.context} title={talk.title} initialQuestion={talk.initialQuestion} />
      {toast && <div className="toast" role="status">{toast}</div>}
    </AppCtx.Provider>
  );
}
