"use client";
// "Ask Bro" drawer on a lesson: text Q&A with the AI tutor, grounded in this lesson.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MessageCircle, Send, Square, Sparkles, LogIn, ArrowRight, GraduationCap } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { streamFn } from "@/lib/api";
import { routes } from "@/lib/nav";
import type { Trade } from "@/lib/types";
import { hereWith } from "./courseData";
import { renderMarkdown } from "./markdown";
import Drawer from "./Drawer";
import s from "./Lesson.module.css";
import prose from "./Prose.module.css";

type Msg = { role: "user" | "assistant"; content: string; error?: boolean };
type Blocked = { code: "limit_reached" | "upgrade_required"; message: string };

const STARTERS = [
  "Explain this lesson in plain words",
  "Quiz me on this lesson",
  "What from this is most likely on the exam?",
  "Give me a real job-site example"
];

type Props = {
  open: boolean;
  onClose: () => void;
  /** Lesson title + summary + start of the lesson text */
  context: string;
  lessonTitle: string;
  /** For the upgrade nudge */
  course: { id: string; is_free: boolean } | null;
  fallbackTrade?: Trade;
};

export default function AskBro({ open, onClose, context, lessonTitle, course, fallbackTrade = "gc" }: Props) {
  const { user, profile, account, settings } = useAuth();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => ctl.current?.abort(), []);
  // The drawer body is the scroll container
  useEffect(() => { const el = listRef.current?.parentElement; if (el) el.scrollTop = el.scrollHeight; }, [msgs, blocked, open]);
  useEffect(() => {
    const t = taRef.current;
    if (t) { t.style.height = "auto"; t.style.height = Math.min(140, t.scrollHeight) + "px"; }
  }, [input]);

  const state = profile?.state || "Tennessee";
  const trade: Trade = profile?.trade || fallbackTrade;

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || busy) return;
    const history: Msg[] = [...msgs.filter((m) => !m.error), { role: "user", content: text }];
    setMsgs([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    setBlocked(null);
    ctl.current = new AbortController();
    try {
      const full = await streamFn(
        "tutor",
        { state, trade, messages: history.slice(-12).map(({ role, content }) => ({ role, content })), context },
        (t) => setMsgs([...history, { role: "assistant", content: t }]),
        ctl.current.signal
      );
      setMsgs([...history, { role: "assistant", content: full || "I didn't get an answer back. Try asking again." }]);
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setMsgs((m) => { const last = m[m.length - 1]; return last && last.role === "assistant" && !last.content ? m.slice(0, -1) : m; });
      } else if (e?.code === "limit_reached" || e?.code === "upgrade_required") {
        setMsgs(history);
        setBlocked({ code: e.code, message: e.message });
      } else {
        setMsgs([...history, { role: "assistant", content: e?.message || "Something interrupted the AI. Try again.", error: true }]);
      }
    } finally {
      setBusy(false);
    }
  }

  const paidDaily = settings.paid_limits?.ai_daily;
  const canBuyThis = !!course && !course.is_free && !account?.enrolled?.includes(course.id);

  const footer = user ? (
    <div className={s.askFoot}>
      <div className={s.compose}>
        <label htmlFor="askbro-input" className={s.sr}>Your question</label>
        <textarea
          id="askbro-input"
          ref={taRef}
          rows={1}
          value={input}
          maxLength={2000}
          placeholder="Ask about this lesson…"
          data-autofocus
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        {busy
          ? <button className="iconbtn" onClick={() => ctl.current?.abort()} aria-label="Stop answer"><Square aria-hidden="true" /></button>
          : <button className="iconbtn go" onClick={() => send()} aria-label="Send question" disabled={!input.trim()}><Send aria-hidden="true" /></button>}
      </div>
      {account && !account.paid && !account.is_admin && account.limits?.ai_daily ? (
        <p className={s.askNote}>Free accounts get {account.limits.ai_daily} AI questions a day.</p>
      ) : null}
    </div>
  ) : null;

  return (
    <Drawer open={open} onClose={onClose} title={<><MessageCircle aria-hidden="true" /> Ask Bro</>} footer={footer}>
      {!user ? (
        <div className={s.askGate}>
          <Sparkles className={s.askGateIco} aria-hidden="true" />
          <h3>Sign in to ask Bro</h3>
          <p>Bro is the AI tutor. He knows this lesson and the code books, and checks state-specific rules for you.</p>
          <Link className="btn primary block" href={routes.login(undefined, hereWith())}><LogIn aria-hidden="true" /> Sign in</Link>
          <Link className="btn block" href={routes.login("signup", hereWith())}>Create a free account</Link>
        </div>
      ) : (
        <div className={s.askBody} ref={listRef} aria-live="polite">
          <div className={`msg ai ${s.askMsg}`}>
            <div className={`${prose.prose} ${prose.compact}`}>
              <p>I&rsquo;ve read this lesson: <strong>{lessonTitle}</strong>. Ask me anything about it. I&rsquo;ll answer for the <strong>{state}</strong> exam.</p>
            </div>
          </div>
          {msgs.length === 0 && (
            <div className={s.starters}>
              {STARTERS.map((q) => <button key={q} className="chip" onClick={() => send(q)} disabled={busy}>{q}</button>)}
            </div>
          )}
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className={`msg me ${s.askMsg}`}>{m.content}</div>
            ) : (
              <div key={i} className={`msg ai ${s.askMsg}`}>
                {m.content
                  ? m.error
                    ? <p className="err" style={{ margin: 0 }}>{m.content}</p>
                    : <div className={`${prose.prose} ${prose.compact}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                  : <p className={s.thinking}><span /><span /><span /> Thinking…</p>}
              </div>
            )
          )}
          {blocked && (
            <div className={`card tape ${s.nudge}`} role="alert">
              <h3>{blocked.code === "limit_reached" ? "You've hit today's AI limit" : "That's a Pro feature"}</h3>
              <p>{blocked.message}</p>
              {!account?.paid ? (
                <>
                  <p className={s.nudgeStrong}>
                    Get any course to unlock Pro study tools{paidDaily ? `, including up to ${paidDaily} AI questions a day` : ""}.
                  </p>
                  <div className="row">
                    {canBuyThis && course && <Link className="btn primary" href={routes.course(course.id)}>Get this course <ArrowRight aria-hidden="true" /></Link>}
                    <Link className={`btn ${canBuyThis ? "" : "primary"}`} href={routes.courses()}>Browse courses</Link>
                  </div>
                </>
              ) : (
                <Link className="btn" href={routes.learn()}><GraduationCap aria-hidden="true" /> Practice exams and games</Link>
              )}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
