"use client";
import { createContext, useContext } from "react";
import Link from "next/link";
import { ExternalLink, ShieldCheck, Sparkles, WifiOff, LockKeyhole, LogIn, TriangleAlert } from "lucide-react";
import { Progress } from "@/lib/progress";
import type { Question } from "@/lib/data";
import type { Limits } from "@/lib/types";
import { DEFAULT_FREE_LIMITS, useAuth } from "@/lib/auth";
import { hostOf, Source } from "@/lib/ai";
import { routes } from "@/lib/nav";
import s from "./Study.module.css";

export type TalkOpts = { context?: string; title?: string; initialQuestion?: string };

export type Ctx = {
  p: Progress;
  update: (fn: (p: Progress) => Progress) => void;
  /** Topic-only result (games, flashcards) */
  record: (topic: string, ok: boolean) => void;
  /** Full question result: also schedules misses for Smart Review */
  answer: (q: Question, ok: boolean) => void;
  log: (kind: string, detail: string) => void;
  askTutor: (text: string) => void;
  /** Opens the full-screen "Talk to Bro" voice chat. Call from a click so speech is allowed on iPhone. */
  talk: (o?: TalkOpts) => void;
};

export const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error("AppCtx missing");
  return c;
};

/** The student's plan limits (free limits until the account loads). */
export function usePlan(): { limits: Limits; paid: boolean } {
  const { account } = useAuth();
  return { limits: account?.limits ?? DEFAULT_FREE_LIMITS, paid: !!account?.paid || !!account?.is_admin };
}

export function TopicBar({ name, c, a }: { name: string; c: number; a: number }) {
  const pct = Math.round((100 * c) / a);
  const cls = pct >= 80 ? "ok" : pct >= 65 ? "mid" : "low";
  return (
    <div className="tbar">
      <span>{name}</span>
      <div className={`bar ${cls}`}><i style={{ width: `${pct}%` }} /></div>
      <em>{pct}%</em>
    </div>
  );
}

/** Section heading in the site style: orange eyebrow, heavy headline with an orange second line. */
export function PanelHead({ eyebrow, title, accent, lede, action }: { eyebrow: string; title: string; accent?: string; lede?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <header className={s.panelHead}>
      <div className={s.panelHeadText}>
        <span className="eyebrow orange">{eyebrow}</span>
        <h2>{title}{accent && <> <span>{accent}</span></>}</h2>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {action && <div className={s.panelAction}>{action}</div>}
    </header>
  );
}

/** "Sources" links under a tutor answer, with the state-rules chip. */
export function SourceList({ sources, state, tone = "light" }: { sources: Source[]; state: string; tone?: "light" | "dark" }) {
  if (!sources.length) return null;
  return (
    <div className={`${s.sources} ${tone === "dark" ? s.sourcesDark : ""}`}>
      <span className={s.checked}><ShieldCheck aria-hidden="true" />Checked against {state} rules</span>
      <ul className={s.srcLinks} aria-label="Sources">
        {sources.map((x) => (
          <li key={x.url}>
            <a href={x.url} target="_blank" rel="noopener noreferrer" className={s.srcLink}>
              <ExternalLink aria-hidden="true" />
              <span>{x.title}</span>
              <small>{hostOf(x.url)}</small>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Friendly explanation for an AI error, with the right next step (upgrade, sign in, try again). */
export function AiErrorNote({ error, tone = "light", onRetry }: { error: any; tone?: "light" | "dark"; onRetry?: () => void }) {
  const { limits, paid } = usePlan();
  const { settings } = useAuth();
  const code: string = error?.code || "error";
  const data = error?.data || {};
  const proDaily = settings.paid_limits?.ai_daily;
  let Icon = TriangleAlert;
  let title = "The AI hit a snag";
  // Server errors (ApiError) carry a student-friendly message; anything else gets a plain one
  const fromServer = typeof error?.status === "number";
  let body: string = (fromServer && error?.message) || "Something interrupted the AI. Try again.";
  let cta: { href: string; label: string } | null = null;
  let retry = !!onRetry;

  if (code === "limit_reached") {
    const lim = Number(data.limit) || limits.ai_daily;
    const isPaid = typeof data.paid === "boolean" ? data.paid : paid;
    Icon = Sparkles;
    title = "Today's AI questions are used up";
    body = isPaid
      ? `You've used all ${lim} AI requests for today. They reset tomorrow. Practice exams, games and calculators still work.`
      : `Free accounts get ${lim} AI questions a day and you've used them. They reset tomorrow.${proDaily ? ` Any paid course unlocks ${proDaily} a day plus AI exams for your state.` : " Any paid course unlocks more every day plus AI exams for your state."}`;
    if (!isPaid) cta = { href: routes.courses(), label: "See courses" };
    retry = false;
  } else if (code === "upgrade_required") {
    Icon = LockKeyhole;
    title = "That's a Pro tool";
    body = error?.message && !/^Something/.test(error.message) ? error.message : "Any paid course unlocks it.";
    cta = { href: routes.courses(), label: "See courses" };
    retry = false;
  } else if (code === "signed_out") {
    Icon = LogIn;
    title = "Sign in first";
    body = "Sign in to use the AI tutor. Your progress is saved to your account.";
    cta = { href: routes.login(undefined, typeof window !== "undefined" ? window.location.pathname + window.location.hash : "/learn/"), label: "Sign in" };
    retry = false;
  } else if (code === "offline") {
    Icon = WifiOff;
    title = "You're offline";
  } else if (code === "session_replaced" || code === "no_session" || code === "in_use") {
    title = "Paused on this device";
    body = "Your account is open on another device. Choose \"Use it here instead\" to keep going.";
  } else if (code === "outside_home") {
    title = "Outside your home area";
  }

  return (
    <div className={`${s.aiNote} ${tone === "dark" ? s.aiNoteDark : ""}`} role="alert">
      <Icon aria-hidden="true" className={s.aiNoteIcon} />
      <div>
        <b>{title}</b>
        <p>{body}</p>
        {(cta || retry) && (
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            {cta && <Link className="btn sm primary" href={cta.href}>{cta.label}</Link>}
            {retry && <button type="button" className="btn sm" onClick={onRetry}>Try again</button>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Small "Pro" upsell line used next to locked options. */
export function ProNote({ children }: { children: React.ReactNode }) {
  return (
    <p className={s.proNote}>
      <LockKeyhole aria-hidden="true" />
      <span>{children}</span>
      <Link href={routes.courses()}>See courses</Link>
    </p>
  );
}
