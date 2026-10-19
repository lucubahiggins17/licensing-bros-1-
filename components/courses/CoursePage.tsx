"use client";
// /course/?id=  (&paid=1 after Stripe Checkout, &buy=1 after signing up to buy)
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight, Award, BadgeCheck, BookOpen, Check, CircleCheck, Clock, Copy, Eye, ExternalLink, Hourglass,
  MapPin, MessageCircle, Play, Radio, RefreshCw, Timer, TriangleAlert
} from "lucide-react";
import AppShell from "@/components/shell/AppShell";
import { useAuth, displayName } from "@/lib/auth";
import { routes, IS_APP_BUILD } from "@/lib/nav";
import { supabase } from "@/lib/supabaseClient";
import type { Live } from "@/lib/types";
import {
  useParam, fetchOutline, fetchProgress, completedCount, nextLessonFor, isFreeCourse, priceLabel, hoursLabel, minutesLabel,
  statesLabel, splitTitle, copyText, TRADE_META, type Outline, type ProgressMap
} from "./courseData";
import { renderMarkdown } from "./markdown";
import Curriculum from "./Curriculum";
import BuyButton from "./BuyButton";
import Certificate, { verifyUrlFor, type CertificateData } from "./Certificate";
import { CourseCover } from "./CourseCard";
import s from "./Course.module.css";
import prose from "./Prose.module.css";

export default function CoursePage() {
  return (
    <AppShell blueprint>
      <Suspense fallback={<HeroSkeleton />}>
        <CourseView />
      </Suspense>
    </AppShell>
  );
}

type PaidPhase = "off" | "waiting" | "done" | "slow";

function CourseView() {
  const router = useRouter();
  const id = useParam("id");
  const paid = useParam("paid") === "1";
  const buyIntent = useParam("buy") === "1";
  const { ready, user, profile, account, isEnrolled, refresh } = useAuth();

  const [outline, setOutline] = useState<Outline | null | undefined>(undefined); // undefined = loading, null = not found
  const [loadErr, setLoadErr] = useState("");
  const [progress, setProgress] = useState<ProgressMap>({});
  const [cert, setCert] = useState<CertificateData | null>(null);
  const [lives, setLives] = useState<Live[]>([]);

  const load = useCallback(async () => {
    if (!id) { setOutline(null); return; }
    setLoadErr("");
    setOutline(undefined);
    try {
      setOutline(await fetchOutline(id, true));
    } catch {
      setLoadErr(typeof navigator !== "undefined" && !navigator.onLine ? "You're offline. Connect to the internet and try again." : "We couldn't load this course right now.");
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const course = outline?.course || null;
  const courseId = course?.id || null;

  // The student's progress and certificate (keyed by user id: Supabase re-emits SIGNED_IN with a new user object)
  const uid = user?.id || null;
  useEffect(() => {
    if (!courseId || !ready) return;
    if (!uid) { setProgress({}); setCert(null); return; }
    let live = true;
    fetchProgress(uid, courseId).then((p) => { if (live) setProgress(p); }).catch(() => {});
    supabase().from("certificates").select("code,student_name,course_title,issued_at").eq("course_id", courseId).eq("user_id", uid).maybeSingle()
      .then(({ data }) => { if (live && data) setCert(data as CertificateData); }, () => {});
    return () => { live = false; };
  }, [courseId, ready, uid]);

  // Live classes linked to this course
  useEffect(() => {
    if (!courseId) return;
    let live = true;
    supabase().from("lives").select("*").eq("course_id", courseId).order("starts_at", { ascending: true })
      .then(({ data }) => {
        if (!live || !data) return;
        const now = Date.now();
        const rows = (data as Live[]).filter((l) =>
          l.status === "live" ||
          (l.status === "scheduled" && new Date(l.starts_at).getTime() > now - 6 * 3600_000) ||
          (l.status === "ended" && new Date(l.starts_at).getTime() > now - 60 * 86400_000));
        rows.sort((a, b) => (a.status === "live" ? -1 : 0) - (b.status === "live" ? -1 : 0) ||
          (a.status === "ended" ? 1 : 0) - (b.status === "ended" ? 1 : 0) || a.starts_at.localeCompare(b.starts_at));
        setLives(rows.slice(0, 5));
      }, () => {});
    return () => { live = false; };
  }, [courseId]);

  // ---- After Stripe Checkout: poll the account until the enrollment shows up (3 s, up to 45 s)
  const enrolledNow = courseId ? isEnrolled(courseId) : false;
  const [paidPhase, setPaidPhase] = useState<PaidPhase>("off");
  const phaseRef = useRef<PaidPhase>("off");
  phaseRef.current = paidPhase;
  useEffect(() => { if (paid) setPaidPhase((p) => (p === "off" ? "waiting" : p)); }, [paid]);
  useEffect(() => {
    if ((paidPhase === "waiting" || paidPhase === "slow") && enrolledNow) {
      setPaidPhase("done");
      if (courseId) router.replace(routes.course(courseId), { scroll: false });
    }
  }, [paidPhase, enrolledNow, courseId, router]);
  useEffect(() => {
    if (!paid || !courseId || !ready || !uid) return;
    let n = 0;
    const iv = window.setInterval(async () => {
      if (phaseRef.current !== "waiting") { window.clearInterval(iv); return; }
      n++;
      if (n >= 15) window.clearInterval(iv);
      try { await refresh(); } catch { /* try again next tick */ }
      if (n >= 15 && phaseRef.current === "waiting") setPaidPhase("slow");
    }, 3000);
    return () => window.clearInterval(iv);
  }, [paid, courseId, ready, uid, refresh]);

  if (loadErr) {
    return (
      <div className={`wrap ${s.message}`}>
        <div className="card hard stack" role="alert">
          <TriangleAlert size={30} color="var(--orange)" aria-hidden="true" />
          <h1 className={s.msgTitle}>Couldn&rsquo;t load this course</h1>
          <p className="lede" style={{ margin: 0 }}>{loadErr}</p>
          <div className="row"><button className="btn primary" onClick={load}><RefreshCw aria-hidden="true" /> Try again</button><Link className="btn" href={routes.courses()}>All courses</Link></div>
        </div>
      </div>
    );
  }
  if (outline === undefined) return <HeroSkeleton />;
  if (outline === null || !course) {
    return (
      <div className={`wrap ${s.message}`}>
        <div className={`plate ${s.notFound}`}>
          <p className="eyebrow orange">Error 404</p>
          <h1 className={s.msgTitle}>Course not found</h1>
          <p className="lede" style={{ margin: 0 }}>This course may have been taken down, or the link is missing a piece.</p>
          <Link className="btn primary cta" href={routes.courses()}>Browse courses <ArrowRight aria-hidden="true" /></Link>
          <span className="bolts" />
        </div>
      </div>
    );
  }

  const { groups, flat } = outline;
  const free = isFreeCourse(course);
  const owned = !!account?.enrolled?.includes(course.id);
  const admin = !!account?.is_admin;
  const open = free || isEnrolled(course.id);           // lessons open to this student (free, owned or admin)
  const tracking = !!user && open;
  const total = flat.length;
  const done = completedCount(flat, progress);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const next = nextLessonFor(flat, progress);
  const allDone = tracking && total > 0 && done === total;
  const previews = flat.filter((l) => l.is_preview);
  const totalMin = flat.reduce((m, l) => m + (l.duration_min || 0), 0);
  const meta = TRADE_META[course.trade] || TRADE_META.all;
  const TradeIcon = meta.Icon;
  const [t1, t2] = splitTitle(course.title);
  const hours = hoursLabel(course.est_hours);
  const nextIndex = next ? flat.findIndex((l) => l.id === next.id) + 1 : 0;

  const paying = paidPhase === "waiting" || paidPhase === "slow"; // never offer Buy again while a payment is landing

  return (
    <>
      {paidPhase !== "off" && (
        <div className={`wrap ${s.paidTop}`}>
          <PaidBanner phase={paidPhase} signedIn={!!user} firstLesson={flat[0]?.id || null} courseId={course.id} onRetry={() => { setPaidPhase("waiting"); refresh().catch(() => {}); }} />
        </div>
      )}

      {/* ---------------- Hero ---------------- */}
      <section className={s.hero}>
        <div className={`wrap ${s.heroGrid}`}>
          <div className={s.heroText}>
            <nav className={s.crumbs} aria-label="Breadcrumb">
              <Link href={routes.courses()}>Courses</Link>
              <span aria-hidden="true">/</span>
              <Link href={routes.courses({ trade: course.trade === "all" ? "" : course.trade })}>{meta.short}</Link>
            </nav>
            <div className={s.badges}>
              <span className={s.tradePill}><TradeIcon aria-hidden="true" /> {meta.label}</span>
              {course.level && <span className="badge">{course.level}</span>}
              {free ? <span className="badge free">Free course</span> : owned ? <span className="badge ok"><BadgeCheck size={12} aria-hidden="true" /> Owned</span> : null}
              {admin && !owned && !free && <span className="badge ai">Admin access</span>}
              {admin && !course.published && <span className="badge warn">Draft: only admins see this</span>}
            </div>
            <h1 className={s.title}>{t1}{t2 && <span>{t2}</span>}</h1>
            {course.subtitle && <p className={s.subtitle}>{course.subtitle}</p>}
            <ul className={s.facts}>
              {hours && <li><Clock aria-hidden="true" /> {hours} total</li>}
              <li><BookOpen aria-hidden="true" /> {total} {total === 1 ? "lesson" : "lessons"}</li>
              {totalMin > 0 && <li><Timer aria-hidden="true" /> {minutesLabel(totalMin)} of lessons</li>}
              <li title={course.states?.length ? course.states.join(", ") : undefined}><MapPin aria-hidden="true" /> {statesLabel(course.states)}</li>
              <li><Award aria-hidden="true" /> Certificate of completion</li>
            </ul>
          </div>

          <aside className={s.buy} aria-label="Get this course">
            <div className={s.buyCover}><CourseCover url={course.cover_url} trade={course.trade} /></div>
            <div className={s.buyBody}>
              {!open && <div className={s.bigPrice}>{priceLabel(course)}</div>}
              {!ready ? (
                <button className="btn primary cta block" disabled><span className="spin" aria-hidden="true" /> Loading…</button>
              ) : open ? (
                user ? (
                  total === 0 ? (
                    <button className="btn cta block" disabled><Hourglass aria-hidden="true" /> Lessons coming soon</button>
                  ) : (
                    <>
                      <Link className="btn primary cta block big" href={routes.lesson((allDone ? flat[0] : next || flat[0]).id)}>
                        <Play aria-hidden="true" /> {allDone ? "Review course" : done === 0 ? (free ? "Start free" : "Start course") : "Continue"}
                      </Link>
                      {next && !allDone && done > 0 && <p className={s.nextUp}>Up next: Lesson {nextIndex}, {next.title}</p>}
                      {tracking && total > 0 && <ProgressBar done={done} total={total} pct={pct} />}
                    </>
                  )
                ) : (
                  <>
                    <Link className="btn primary cta block big" href={routes.login("signup", routes.course(course.id))}><Play aria-hidden="true" /> Start free</Link>
                    <p className={s.small}>Free with a Licensing Bro&rsquo;s account. Have one? <Link href={routes.login(undefined, routes.course(course.id))}>Sign in</Link></p>
                  </>
                )
              ) : paying && user ? (
                <>
                  <button className="btn primary cta block" disabled aria-busy="true"><span className="spin" aria-hidden="true" /> Unlocking your course…</button>
                  <p className={s.small}>{paidPhase === "slow" ? "Your payment is still processing. Tap Check again above, or refresh in a minute." : "Your payment went through. This page updates on its own."}</p>
                </>
              ) : (
                <>
                  {buyIntent && user && !IS_APP_BUILD && <p className={s.intent} role="status"><Check aria-hidden="true" /> You&rsquo;re signed in. Tap Buy to finish.</p>}
                  <BuyButton course={course} />
                  {previews.length > 0 && (
                    <Link className="btn block" href={routes.lesson(previews[0].id)}><Eye aria-hidden="true" /> Watch a free preview</Link>
                  )}
                  {!IS_APP_BUILD && <p className={s.small}>One-time payment. Unlocks every lesson and quiz, the live classes for this course, and Pro study tools.</p>}
                </>
              )}
            </div>
          </aside>
        </div>
      </section>
      <div className="hazard" />

      {/* ---------------- Body ---------------- */}
      <div className={`wrap ${s.body}`}>
        <div className={s.layout}>
          <div className={s.main}>
            {(cert || allDone) && (
              <section className={s.block} aria-labelledby="cert-title">
                <p className="eyebrow orange">Finished</p>
                <h2 id="cert-title" className={s.h2}>Your certificate</h2>
                {cert
                  ? <CertificateBlock cert={cert} />
                  : <ClaimCertificate courseId={course.id} courseTitle={course.title} fallbackName={displayName(profile, user)} onClaimed={setCert} />}
              </section>
            )}

            {course.what_you_learn?.filter(Boolean).length > 0 && (
              <section className={s.block} aria-labelledby="learn-title">
                <p className="eyebrow orange">The plan</p>
                <h2 id="learn-title" className={s.h2}>What you&rsquo;ll learn</h2>
                <ul className={`card ${s.learn}`}>
                  {course.what_you_learn.filter(Boolean).map((w, i) => (
                    <li key={i}><span className={s.tick} aria-hidden="true"><Check /></span>{w}</li>
                  ))}
                </ul>
              </section>
            )}

            {course.description?.trim() && (
              <section className={s.block} aria-labelledby="about-title">
                <p className="eyebrow orange">Overview</p>
                <h2 id="about-title" className={s.h2}>About this course</h2>
                <div className={`card ${prose.prose}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(course.description) }} />
              </section>
            )}

            <section className={s.block} aria-labelledby="curr-title">
              <p className="eyebrow orange">Curriculum</p>
              <div className={s.currHead}>
                <h2 id="curr-title" className={s.h2}>Course lessons</h2>
                <span className={s.currMeta}>
                  {groups.filter((g) => g.title).length > 0 && `${groups.filter((g) => g.title).length} modules · `}
                  {total} {total === 1 ? "lesson" : "lessons"}{totalMin ? ` · ${minutesLabel(totalMin)}` : ""}
                </span>
              </div>
              {!open && previews.length > 0 && <p className={s.small}><Eye aria-hidden="true" /> Lessons marked <b>Free preview</b> are open with a free account.</p>}
              <Curriculum groups={groups} progress={progress} hasAccess={open} showPreviewTags={!open} />
            </section>
          </div>

          {tracking && total > 0 && (
            <div className={s.sideTop}>
              <div className={`card hard ${s.progressCard}`}>
                <p className="eyebrow">Your progress</p>
                <div className={s.pctRow}><b>{pct}%</b><span>{done} of {total} lessons done</span></div>
                <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Course progress"><i style={{ width: `${pct}%` }} /></div>
                {allDone
                  ? <p className={`${s.small} ok-text`}><CircleCheck aria-hidden="true" /> Every lesson complete.</p>
                  : next && <Link className="btn primary block" href={routes.lesson(next.id)}>{done ? "Continue" : "Start"}: Lesson {nextIndex} <ArrowRight aria-hidden="true" /></Link>}
              </div>
            </div>
          )}

          <div className={s.sideBottom}>
            {lives.length > 0 && (
              <div className={`card ${s.livesCard}`}>
                <p className="eyebrow"><Radio size={12} aria-hidden="true" style={{ verticalAlign: "-1px" }} /> Live classes for this course</p>
                <ul className={s.lives}>
                  {lives.map((l) => <LiveRow key={l.id} live={l} />)}
                </ul>
                <Link className="btn sm ghost" href={routes.lives}>All live classes <ArrowRight aria-hidden="true" /></Link>
              </div>
            )}
            <div className={`card tape ${s.helpCard}`}>
              <h3><MessageCircle aria-hidden="true" /> Stuck on something?</h3>
              <p>Ask Bro, our AI tutor, about any code section, calculation or law question. Answers cite the book and section.</p>
              <Link className="btn navy block" href={routes.learn("tutor")}>Ask Bro <ArrowRight aria-hidden="true" /></Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function ProgressBar({ done, total, pct }: { done: number; total: number; pct: number }) {
  return (
    <div className={s.miniProgress}>
      <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Course progress"><i style={{ width: `${pct}%` }} /></div>
      <span>{done}/{total} lessons · {pct}%</span>
    </div>
  );
}

function PaidBanner({ phase, signedIn, firstLesson, courseId, onRetry }: { phase: PaidPhase; signedIn: boolean; firstLesson: string | null; courseId: string; onRetry: () => void }) {
  const { settings } = useAuth();
  const support = settings.support?.email || settings.support?.phone || "";
  if (phase === "done") {
    return (
      <div className={`${s.banner} ${s.bannerOk}`} role="status">
        <CircleCheck aria-hidden="true" />
        <div>
          <b>You&rsquo;re in. Your course is unlocked.</b>
          <p>Thanks for your purchase. Every lesson is open now.</p>
        </div>
        {firstLesson && <Link className="btn primary" href={routes.lesson(firstLesson)}>Start lesson 1 <ArrowRight aria-hidden="true" /></Link>}
      </div>
    );
  }
  if (phase === "slow" || !signedIn) {
    return (
      <div className={`${s.banner} ${s.bannerWarn}`} role="status">
        <Hourglass aria-hidden="true" />
        <div>
          <b>{signedIn ? "Payment received. Still unlocking…" : "Sign in to see your course"}</b>
          <p>
            {signedIn
              ? `It can take a minute for the payment to reach us. Refresh this page in a moment. If it still isn't unlocked in 10 minutes, contact support${support ? ` (${support})` : ""} and we'll sort it out.`
              : "Your payment went through. Sign in with the account you used at checkout to open the course."}
          </p>
        </div>
        {signedIn
          ? <button className="btn" onClick={onRetry}><RefreshCw aria-hidden="true" /> Check again</button>
          : <Link className="btn primary" href={routes.login(undefined, routes.course(courseId) + "&paid=1")}>Sign in</Link>}
      </div>
    );
  }
  return (
    <div className={`${s.banner} ${s.bannerWait}`} role="status" aria-live="polite">
      <span className={s.bannerSpin} aria-hidden="true" />
      <div>
        <b>Payment received. Unlocking your course…</b>
        <p>This usually takes a few seconds. Keep this page open.</p>
      </div>
    </div>
  );
}

function ClaimCertificate({ courseId, courseTitle, fallbackName, onClaimed }: { courseId: string; courseTitle: string; fallbackName: string; onClaimed: (c: CertificateData) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function claim() {
    setBusy(true);
    setErr("");
    try {
      const { data: code, error } = await supabase().rpc("claim_certificate", { p_course: courseId });
      if (error) throw error;
      const { data: rows } = await supabase().rpc("verify_certificate", { p_code: code as string });
      const row = Array.isArray(rows) ? rows[0] : rows;
      onClaimed((row as CertificateData) || { code: code as string, student_name: fallbackName, course_title: courseTitle, issued_at: new Date().toISOString() });
    } catch (e: any) {
      setErr(/finish every lesson/i.test(e?.message || "") ? "Finish every lesson first, then try again." : "We couldn't create your certificate. Try again in a moment.");
      setBusy(false);
    }
  }
  return (
    <div className={`card tape ${s.claim}`}>
      <Award className={s.claimIco} aria-hidden="true" />
      <div className={s.claimText}>
        <h3>You finished every lesson. Nice work.</h3>
        <p>Get your certificate of completion. It has a code anyone can check on our website.</p>
        <p className={s.small}>Your name on the certificate: <b>{fallbackName}</b>. Change it in <Link href={routes.account("profile")}>Account</Link> first if needed.</p>
        {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
      </div>
      <button className="btn primary cta" onClick={claim} disabled={busy}>{busy ? "Creating…" : "Get your certificate"}</button>
    </div>
  );
}

function CertificateBlock({ cert }: { cert: CertificateData }) {
  const [copied, setCopied] = useState(false);
  const url = verifyUrlFor(cert.code);
  return (
    <div className="stack">
      <Certificate cert={cert} />
      <div className="row">
        <Link className="btn navy" href={routes.verify(cert.code)}><ExternalLink aria-hidden="true" /> Open to print or share</Link>
        <button className="btn" onClick={async () => { if (await copyText(url)) { setCopied(true); setTimeout(() => setCopied(false), 2200); } }} aria-live="polite">
          {copied ? <><Check aria-hidden="true" /> Link copied</> : <><Copy aria-hidden="true" /> Copy verification link</>}
        </button>
      </div>
    </div>
  );
}

function LiveRow({ live }: { live: Live }) {
  const d = new Date(live.starts_at);
  const month = d.toLocaleDateString(undefined, { month: "short" });
  const day = d.getDate();
  const when = d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  return (
    <li>
      <Link href={routes.watch(live.id)} className={s.liveRow}>
        <span className={s.liveDate} aria-hidden="true"><small>{month}</small><b>{day}</b></span>
        <span className={s.liveText}>
          <span className={s.liveTitle}>{live.title}</span>
          <span className={s.liveMeta}>
            {live.status === "live" ? <span className="badge live">Live now</span>
              : live.status === "ended" ? <span className="badge">Replay</span>
                : <span>{when}</span>}
            {live.is_free && <span className="badge free">Free</span>}
          </span>
        </span>
        <ArrowRight className={s.liveGo} aria-hidden="true" />
      </Link>
    </li>
  );
}

function HeroSkeleton() {
  return (
    <>
      <section className={s.hero} aria-busy="true" aria-label="Loading course">
        <div className={`wrap ${s.heroGrid}`}>
          <div className={s.heroText}>
            <i className={s.skLine} style={{ width: 140 }} />
            <i className={s.skLine} style={{ width: "85%", height: 40 }} />
            <i className={s.skLine} style={{ width: "60%", height: 40 }} />
            <i className={s.skLine} style={{ width: "70%" }} />
          </div>
          <div className={s.buy}><div className={s.buyBody}><i className={s.skBlock} /></div></div>
        </div>
      </section>
      <div className="hazard" />
    </>
  );
}
