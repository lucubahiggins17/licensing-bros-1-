"use client";
// What students see when the host pushes a call to action: the newest active one slides in over the video.
// Dismissible, with a chip to bring it back. Course offers check out with Stripe, polls vote and show live results.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, Tag, Copy, Check, ExternalLink, Megaphone, BarChart3, GraduationCap, Link2, ChevronUp } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { callFn } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { routes, IS_APP_BUILD, SITE_URL } from "@/lib/nav";
import { money, type Course, type LiveCta } from "@/lib/types";
import { useLiveCtas, usePollResults } from "@/components/live/useLiveData";
import { PollBars } from "@/components/live/LiveBits";
import { copyText } from "@/components/live/liveUtils";
import s from "./live.module.css";

const KIND_LABEL: Record<LiveCta["kind"], string> = { course: "Special offer", link: "From the host", poll: "Quick poll", message: "Message from the host" };
const KIND_ICON: Record<LiveCta["kind"], any> = { course: GraduationCap, link: Link2, poll: BarChart3, message: Megaphone };

export default function CtaOverlay({ liveId, enabled, className }: { liveId: string; enabled: boolean; className?: string }) {
  const { ctas } = useLiveCtas(liveId, enabled, true);
  const current = ctas.find((c) => c.active) || null;
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (!current) return null;
  const Icon = KIND_ICON[current.kind];
  return (
    <div className={`${s.ctaDock} ${className || ""}`}>
      {dismissed === current.id ? (
        <button type="button" className={s.reopen} onClick={() => setDismissed(null)}>
          <Icon size={15} aria-hidden="true" /> {current.kind === "poll" ? "Show the poll" : current.kind === "course" ? "Show the offer" : "Show message"} <ChevronUp size={15} aria-hidden="true" />
        </button>
      ) : (
        <CtaCard key={current.id} cta={current} onClose={() => setDismissed(current.id)} />
      )}
    </div>
  );
}

function CtaCard({ cta, onClose }: { cta: LiveCta; onClose: () => void }) {
  const Icon = KIND_ICON[cta.kind];
  return (
    <section className={`${s.cta} ${s[`cta_${cta.kind}`] || ""}`} role="region" aria-live="polite" aria-label={KIND_LABEL[cta.kind]}>
      <div className="hazard thin" />
      <div className={s.ctaBody}>
        <div className={s.ctaTop}>
          <span className={s.ctaKind}><Icon size={14} aria-hidden="true" /> {KIND_LABEL[cta.kind]}</span>
          <button type="button" className={s.ctaClose} onClick={onClose} aria-label="Hide this"><X size={18} aria-hidden="true" /></button>
        </div>
        {cta.kind === "course" && <CourseOffer cta={cta} />}
        {cta.kind === "link" && <LinkOffer cta={cta} />}
        {cta.kind === "poll" && <Poll cta={cta} />}
        {cta.kind === "message" && (
          <div className={s.ctaMessage}>
            <h3>{cta.title}</h3>
            {cta.body && <p>{cta.body}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

function CourseOffer({ cta }: { cta: LiveCta }) {
  const { user, isEnrolled, refresh } = useAuth();
  const router = useRouter();
  const [ownedNow, setOwnedNow] = useState(false);
  const [course, setCourse] = useState<Pick<Course, "id" | "title" | "subtitle" | "price_cents" | "is_free"> | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!cta.course_id) return;
    let cancelled = false;
    supabase().from("courses").select("id,title,subtitle,price_cents,is_free").eq("id", cta.course_id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setCourse((data as any) || null); });
    return () => { cancelled = true; };
  }, [cta.course_id]);

  if (!cta.course_id) return <div className={s.ctaMessage}><h3>{cta.title}</h3>{cta.body && <p>{cta.body}</p>}</div>;
  const id = cta.course_id;
  const owned = ownedNow || isEnrolled(id);
  const here = typeof window !== "undefined" ? window.location.pathname + window.location.search : routes.lives;
  const title = cta.title || course?.title || "Course offer";
  const body = cta.body || course?.subtitle || "";

  async function buy() {
    if (!user) { router.push(routes.login("signup", here)); return; }
    setBusy(true); setErr("");
    // Open checkout in a new tab so the class keeps playing here
    let w: Window | null = null;
    try {
      w = window.open("", "_blank");
      if (w) {
        w.opener = null;
        w.document.title = "Opening checkout…";
        w.document.body.innerHTML = '<p style="font:600 16px system-ui;padding:32px;color:#1b1f3b">Opening secure checkout…</p>';
      }
    } catch { w = null; }
    try {
      const { url } = await callFn<{ url: string }>("stripe-checkout", { course_id: id, success_path: `/course/?id=${id}&paid=1` });
      if (w && !w.closed) w.location.href = url;
      else window.location.href = url;
    } catch (e: any) {
      try { w?.close(); } catch { /* ignore */ }
      if (e?.code === "signed_out") { router.push(routes.login(undefined, here)); return; }
      if (e?.code === "already_enrolled") { setOwnedNow(true); refresh(); setBusy(false); return; }
      setErr(e?.message || "Checkout didn't open. Try again.");
    }
    setBusy(false);
  }

  return (
    <div className={s.offer}>
      <div className={s.offerHead}>
        <h3>{title}</h3>
        {course && !owned && <span className={s.price}>{course.is_free ? "Free" : money(course.price_cents)}</span>}
      </div>
      {body && <p className={s.offerBody}>{body}</p>}
      {cta.promo_code && !owned && (
        <div className={s.promo}>
          <Tag size={15} aria-hidden="true" />
          <span>Use code <b className="mono">{cta.promo_code}</b> at checkout</span>
          <button type="button" className="btn sm" onClick={async () => { if (await copyText(cta.promo_code || "")) { setCopied(true); setTimeout(() => setCopied(false), 2000); } }}>
            {copied ? <><Check aria-hidden="true" /> Copied</> : <><Copy aria-hidden="true" /> Copy</>}
          </button>
        </div>
      )}
      <div className={s.ctaActions}>
        {owned ? (
          <Link className="btn navy cta" href={routes.course(id)} target="_blank">You own this course: open it</Link>
        ) : course && (course.is_free || course.price_cents <= 0) ? (
          <Link className="btn primary cta" href={routes.course(id)} target="_blank">Start free</Link>
        ) : IS_APP_BUILD ? (
          <a className="btn primary cta" href={`${SITE_URL}${routes.course(id)}`} target="_blank" rel="noopener noreferrer">
            {cta.button_label || "Get it now"} <ExternalLink aria-hidden="true" />
          </a>
        ) : (
          <button type="button" className="btn primary cta" onClick={buy} disabled={busy}>{busy ? "Opening checkout…" : cta.button_label || "Get it now"}</button>
        )}
        {!owned && <Link className="btn ghost sm" href={routes.course(id)} target="_blank">Course details</Link>}
      </div>
      {IS_APP_BUILD && !owned && <p className={s.ctaFine}>Checkout opens on our website.</p>}
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  );
}

function LinkOffer({ cta }: { cta: LiveCta }) {
  return (
    <div className={s.offer}>
      <h3>{cta.title}</h3>
      {cta.body && <p className={s.offerBody}>{cta.body}</p>}
      {cta.url && (
        <div className={s.ctaActions}>
          <a className="btn primary cta" href={cta.url} target="_blank" rel="noopener noreferrer">
            {cta.button_label || "Open link"} <ExternalLink aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  );
}

function Poll({ cta }: { cta: LiveCta }) {
  const { user } = useAuth();
  const [mine, setMine] = useState<number | null | undefined>(undefined); // undefined = still checking
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const voted = typeof mine === "number";
  const { counts, refresh } = usePollResults(cta.id, cta.options.length, voted);

  useEffect(() => {
    if (!user) { setMine(null); return; }
    let cancelled = false;
    supabase().from("poll_votes").select("choice").eq("cta_id", cta.id).eq("user_id", user.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setMine(typeof (data as any)?.choice === "number" ? (data as any).choice : null); });
    return () => { cancelled = true; };
  }, [cta.id, user]);

  async function vote(i: number) {
    if (!user || busy) return;
    setBusy(true); setErr("");
    const { error } = await supabase().from("poll_votes").insert({ cta_id: cta.id, user_id: user.id, choice: i });
    if (error && error.code !== "23505") {
      setErr(navigator.onLine === false ? "You're offline. Vote not sent." : "Your vote didn't go through. Try again.");
    } else if (error) {
      // Already voted (maybe in another tab): show what we have on file
      const { data } = await supabase().from("poll_votes").select("choice").eq("cta_id", cta.id).eq("user_id", user.id).maybeSingle();
      setMine(typeof (data as any)?.choice === "number" ? (data as any).choice : i);
    } else {
      setMine(i);
    }
    setBusy(false);
    refresh();
  }

  return (
    <div className={s.offer}>
      <h3>{cta.title}</h3>
      {cta.body && <p className={s.offerBody}>{cta.body}</p>}
      {mine === undefined ? (
        <p className={s.ctaFine}><span className="spin" aria-hidden="true" /> Loading…</p>
      ) : voted ? (
        <PollBars options={cta.options} counts={counts} mine={mine} />
      ) : (
        <div className={s.pollOpts} role="group" aria-label={cta.title}>
          {cta.options.map((o, i) => (
            <button key={i} type="button" className={s.pollOpt} onClick={() => vote(i)} disabled={busy || !user}>
              <span className={s.pollLetter}>{String.fromCharCode(65 + i)}</span>{o}
            </button>
          ))}
          {!user && <p className={s.ctaFine}>Sign in to vote.</p>}
        </div>
      )}
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  );
}
