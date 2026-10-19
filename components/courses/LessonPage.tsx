"use client";
// /lesson/?id=  — outline (public) + protected content from the `lesson` edge function.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Award, Check, ChevronLeft, ChevronRight, CircleCheck, CirclePlay, Clock, Download, FileText, ListChecks, ListOrdered,
  Lock, LogIn, MapPin, MessageCircle, Mic, MonitorSmartphone, NotebookPen, Paperclip, Plane, RefreshCw, TriangleAlert, Undo2, WifiOff
} from "lucide-react";
import AppShell from "@/components/shell/AppShell";
import { askForTravelMode } from "@/components/shell/SessionGuard";
import TalkMode from "@/components/voice/TalkMode";
import { useAuth } from "@/lib/auth";
import { callFn } from "@/lib/api";
import { claimSession, getSessionState, useSession, type LocationInfo } from "@/lib/session";
import { routes } from "@/lib/nav";
import type { Lesson, LessonPayload } from "@/lib/types";
import {
  useParam, courseIdForLesson, fetchOutline, fetchProgress, saveProgress, completedCount, isFreeCourse, minutesLabel, priceLabel,
  hereWith, type Outline, type ProgressMap
} from "./courseData";
import { renderMarkdown, markdownToText } from "./markdown";
import Curriculum from "./Curriculum";
import Drawer from "./Drawer";
import BuyButton from "./BuyButton";
import LessonPlayer from "./LessonPlayer";
import LessonQuiz from "./LessonQuiz";
import AskBro from "./AskBro";
import s from "./Lesson.module.css";
import prose from "./Prose.module.css";

const KIND = {
  video: { label: "Video lesson", Icon: CirclePlay },
  text: { label: "Reading", Icon: FileText },
  quiz: { label: "Quiz", Icon: ListChecks }
} as const;

export default function LessonPage() {
  return (
    <AppShell>
      <Suspense fallback={<LessonSkeleton />}>
        <LessonRoute />
      </Suspense>
    </AppShell>
  );
}

function LessonRoute() {
  const id = useParam("id");
  if (!id) return <Missing />;
  return <LessonView key={id} id={id} />; // fresh state for every lesson
}

type Content =
  | { status: "loading" }
  | { status: "ok"; payload: LessonPayload }
  | { status: "error"; code: string; message: string; data?: any };

/** Wait for an in-flight device claim (started by the app on sign-in) to finish. */
async function settleSession(maxMs = 10_000) {
  const t0 = Date.now();
  while (getSessionState().status === "claiming" && Date.now() - t0 < maxMs) await new Promise((r) => setTimeout(r, 150));
}

const place = (city?: string | null, region?: string | null) => [city, region].filter(Boolean).join(", ");

function LessonView({ id }: { id: string }) {
  const router = useRouter();
  const { ready, user, isEnrolled } = useAuth();
  const sess = useSession();

  // ---------------- Outline (public)
  const [outline, setOutline] = useState<Outline | null | undefined>(undefined);
  const [outlineFailed, setOutlineFailed] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const cid = await courseIdForLesson(id);
        const o = cid ? await fetchOutline(cid) : null;
        if (live) setOutline(o);
      } catch {
        if (live) { setOutlineFailed(true); setOutline(null); }
      }
    })();
    return () => { live = false; };
  }, [id]);
  const course = outline?.course || null;

  // ---------------- Progress
  // Depend on the user id, not the user object: Supabase re-emits SIGNED_IN on tab focus with a new object.
  const uid = user?.id || null;
  const [progress, setProgress] = useState<ProgressMap>({});
  useEffect(() => {
    if (!uid || !course) return;
    let live = true;
    fetchProgress(uid, course.id).then((p) => { if (live) setProgress(p); }).catch(() => {});
    return () => { live = false; };
  }, [uid, course]);

  // ---------------- Protected content
  const [content, setContent] = useState<Content>({ status: "loading" });
  const retried = useRef(false);
  const load = useCallback(async (isRetry = false) => {
    if (!isRetry) retried.current = false;
    setContent((c) => (c.status === "ok" ? c : { status: "loading" }));
    try {
      const payload = await callFn<LessonPayload>("lesson", { lesson_id: id });
      setContent({ status: "ok", payload });
    } catch (e: any) {
      const code: string = e?.code || "error";
      if ((code === "no_session" || code === "session_replaced") && !retried.current) {
        retried.current = true;
        if (getSessionState().status === "claiming") await settleSession();
        else await claimSession(false);
        if (getSessionState().status === "ok") return load(true);
      }
      if (code === "outside_home") askForTravelMode((e as any)?.data?.location);
      setContent({ status: "error", code, message: e?.message || "Something went wrong.", data: e?.data });
    }
  }, [id]);

  useEffect(() => {
    if (!ready) return;
    if (!uid) { setContent({ status: "error", code: "signed_out", message: "" }); return; }
    load();
  }, [ready, uid, load]);

  const errCode = content.status === "error" ? content.code : null;
  // After "Use it here instead" (or a fresh claim), try again
  useEffect(() => {
    if ((errCode === "no_session" || errCode === "session_replaced") && sess.status === "ok") load();
  }, [sess.status, sess.sessionId]); // eslint-disable-line react-hooks/exhaustive-deps
  // After Travel mode turns on (or home moves here), try again
  const loc = sess.location;
  useEffect(() => {
    if (errCode === "outside_home" && loc && (loc.state === "away" || loc.state === "home")) load();
  }, [loc?.state, loc?.away_until, loc?.home_city]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------- Derived
  const payload = content.status === "ok" ? content.payload : null;
  const lesson: Lesson | null = outline?.lessons.find((l) => l.id === id) || payload?.lesson || null;
  const flat = outline?.flat || [];
  const idx = flat.findIndex((l) => l.id === id);
  const prev = idx > 0 ? flat[idx - 1] : null;
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : null;
  const courseId = course?.id || payload?.course.id || null;
  const courseTitle = course?.title || payload?.course.title || "Course";
  const free = course ? isFreeCourse(course) : !!payload?.course.is_free;
  const open = free || (!!courseId && isEnrolled(courseId));
  const canTrack = !!user && !!lesson && open;
  const completed = !!progress[id]?.completed;
  const total = flat.length;
  const doneCount = completedCount(flat, progress);
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const courseDone = canTrack && total > 0 && doneCount === total;

  // ---------------- Actions
  const [saveErr, setSaveErr] = useState("");
  const [upNext, setUpNext] = useState(false);
  const [ended, setEnded] = useState(false);
  const [lessonsOpen, setLessonsOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [talkOpen, setTalkOpen] = useState(false);

  async function setComplete(value: boolean, advanceNow = false) {
    if (!user || !lesson) return;
    setSaveErr("");
    const before = progress[id];
    const after = { lesson_id: id, position_sec: before?.position_sec || 0, notes: before?.notes || "", completed: value };
    setProgress((p) => ({ ...p, [id]: after }));
    try {
      await saveProgress(user.id, lesson, { completed: value });
      const willFinish = value && completedCount(flat, { ...progress, [id]: after }) === total;
      if (value && next && !willFinish) {
        if (advanceNow) router.push(routes.lesson(next.id));
        else setUpNext(true);
      }
      if (!value) setUpNext(false);
    } catch {
      setProgress((p) => { const c = { ...p }; if (before) c[id] = before; else delete c[id]; return c; });
      setSaveErr("Couldn't save that. Check your connection and try again.");
    }
  }

  const savePosition = useCallback((sec: number) => {
    if (!uid || !lesson) return;
    saveProgress(uid, lesson, { position_sec: sec }).catch(() => { /* next save will try again */ });
  }, [uid, lesson]);
  const saveNotes = useCallback(async (text: string) => {
    if (!uid || !lesson) return;
    await saveProgress(uid, lesson, { notes: text });
  }, [uid, lesson]);

  const aiContext = useMemo(() => {
    if (!lesson) return "";
    const parts = [`Lesson: ${lesson.title}`];
    if (courseTitle) parts.push(`Course: ${courseTitle}`);
    if (lesson.summary) parts.push(`Summary: ${lesson.summary}`);
    const body = markdownToText(payload?.content.body_md).slice(0, 3000);
    if (body) parts.push(`Lesson text:\n${body}`);
    return parts.join("\n");
  }, [lesson, courseTitle, payload]);
  const bodyHtml = useMemo(() => renderMarkdown(payload?.content.body_md), [payload]);

  // ---------------- Render
  if (outline === null && !outlineFailed) return <Missing />;
  if (!lesson) {
    // Outline and content both failed (usually offline)
    if (outlineFailed && content.status === "error") {
      return (
        <div className={`wrap ${s.missing}`}>
          <Gate icon={content.code === "offline" ? WifiOff : TriangleAlert} eyebrow="Lesson" title={content.code === "offline" ? "You're offline" : "This lesson didn't load"} alert>
            <p>{content.code === "offline" ? "Lessons need an internet connection. Connect and try again." : "Something went wrong loading this lesson. Try again in a moment."}</p>
            <div className="row"><button className="btn primary" onClick={() => window.location.reload()}><RefreshCw aria-hidden="true" /> Try again</button></div>
          </Gate>
        </div>
      );
    }
    return <LessonSkeleton />;
  }

  const kind = KIND[lesson.kind] || KIND.video;
  const KindIcon = kind.Icon;
  const mins = minutesLabel(lesson.duration_min);
  const nextLocked = !!next && !open && !next.is_preview;

  const sidebar = (inDrawer: boolean) => outline && (
    <div className={s.sideInner}>
      <Link className={s.sideCourse} href={routes.course(outline.course.id)}>{outline.course.title}</Link>
      {canTrack && total > 0 && (
        <div className={s.sideProgress}>
          <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Course progress"><i style={{ width: `${pct}%` }} /></div>
          <span>{doneCount} of {total} done</span>
        </div>
      )}
      <Curriculum variant="compact" groups={outline.groups} progress={progress} hasAccess={open} showPreviewTags={!open} currentId={id}
        onNavigate={inDrawer ? () => setLessonsOpen(false) : undefined} />
    </div>
  );

  const pager = (prev || next) && (
    <nav className={s.pager} aria-label="Lesson navigation">
      {prev ? (
        <Link className={s.pageBtn} href={routes.lesson(prev.id)}>
          <ChevronLeft aria-hidden="true" /><span><small>Previous</small><b>{prev.title}</b></span>
        </Link>
      ) : <span />}
      {next ? (
        <Link className={`${s.pageBtn} ${s.pageNext}`} href={routes.lesson(next.id)}>
          <span><small>Next{nextLocked ? " (locked)" : ""}</small><b>{next.title}</b></span>{nextLocked ? <Lock aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        </Link>
      ) : <span />}
    </nav>
  );

  const toolbar = (outline || payload) && (
    <div className={s.toolbar}>
      {outline && (
        <button className={`btn ${s.lessonsBtn}`} onClick={() => setLessonsOpen(true)}>
          <ListOrdered aria-hidden="true" /> Lessons{canTrack && total ? ` ${doneCount}/${total}` : ""}
        </button>
      )}
      {payload && <button className="btn primary" onClick={() => setAskOpen(true)}><MessageCircle aria-hidden="true" /> Ask Bro</button>}
      {payload && <button className="btn navy" onClick={() => setTalkOpen(true)}><Mic aria-hidden="true" /> Talk it through</button>}
    </div>
  );

  return (
    <>
      <section className={s.band}>
        <div className={`wrap ${s.bandInner}`}>
          <nav className={s.crumbs} aria-label="Breadcrumb">
            {courseId && <Link href={routes.course(courseId)}><ChevronLeft aria-hidden="true" /> {courseTitle}</Link>}
            {idx >= 0 && <span className={s.crumbCount}>Lesson {idx + 1} of {total}</span>}
          </nav>
          <h1 className={s.title}>{lesson.title}</h1>
          <div className={s.badges}>
            <span className={s.kindPill}><KindIcon aria-hidden="true" /> {kind.label}</span>
            {mins && <span className={s.metaPill}><Clock aria-hidden="true" /> {mins}</span>}
            {lesson.is_preview && !free && !open && <span className="badge free">Free preview</span>}
            {completed && <span className="badge ok"><CircleCheck size={12} aria-hidden="true" /> Completed</span>}
          </div>
        </div>
      </section>
      <div className="hazard thin" />

      <div className={`wrap ${s.layout}`}>
        <div className={s.main}>
          {content.status === "loading" && (
            <>
              <div className={`${s.player} ${s.playerSkel}`} aria-busy="true" aria-label="Loading lesson"><span className="spin" /></div>
              {toolbar}
            </>
          )}

          {content.status === "error" && (
            <>
              <ErrorGate
                content={content}
                lesson={lesson}
                courseRow={course}
                courseId={courseId}
                courseTitle={courseTitle}
                free={free}
                previews={flat.filter((l) => l.is_preview && l.id !== id).slice(0, 3)}
                location={(content.data?.location as LocationInfo | undefined) || sess.location}
                onRetry={() => load()}
              />
              {toolbar}
              {lesson.summary && <p className={s.summary}>{lesson.summary}</p>}
              {pager && <div className={`card ${s.pagerCard}`}>{pager}</div>}
            </>
          )}

          {payload && (
            <>
              {payload.content.video && (
                <LessonPlayer
                  video={payload.content.video}
                  title={lesson.title}
                  startAt={progress[id]?.position_sec || 0}
                  onPosition={canTrack ? savePosition : undefined}
                  onEnded={() => setEnded(true)}
                  onReload={() => load()}
                />
              )}
              {ended && (
                <div className={s.endPrompt} role="status">
                  <b>{canTrack && !completed ? "Video finished. Nice work!" : "Video finished."}</b>
                  <div className="row">
                    {canTrack && !completed && (
                      <button className="btn primary" onClick={() => { setEnded(false); setComplete(true, true); }}>
                        <Check aria-hidden="true" /> Mark complete{next ? " & go to next" : ""}
                      </button>
                    )}
                    {(completed || !canTrack) && next && <Link className="btn primary" href={routes.lesson(next.id)}>Next lesson <ChevronRight aria-hidden="true" /></Link>}
                    <button className="btn ghost" onClick={() => setEnded(false)}>Stay here</button>
                  </div>
                </div>
              )}
              {toolbar}
              {lesson.summary && <p className={s.summary}>{lesson.summary}</p>}

              {lesson.kind === "quiz" && <LessonQuiz quiz={payload.content.quiz} />}
              {bodyHtml && <article className={`card ${prose.prose} ${s.bodyCard}`} dangerouslySetInnerHTML={{ __html: bodyHtml }} />}
              {lesson.kind !== "quiz" && <LessonQuiz quiz={payload.content.quiz} />}

              {!payload.content.video && !bodyHtml && !payload.content.quiz?.length && !payload.content.attachments?.length && (
                <div className="card"><p className="empty" style={{ margin: 0 }}>This lesson&rsquo;s content is on the way. Check back soon.</p></div>
              )}

              {payload.content.attachments?.length > 0 && <Attachments items={payload.content.attachments} />}
              {canTrack && <LessonNotes initial={progress[id]?.notes || ""} save={saveNotes} />}

              <section className={`card hard ${s.complete}`} aria-label="Finish this lesson">
                {canTrack ? (
                  courseDone ? (
                    <div className={s.markRow}>
                      <Award className={s.markIco} aria-hidden="true" />
                      <div className={s.markText}><b>You finished the whole course!</b><p>Your certificate of completion is ready on the course page.</p></div>
                      {courseId && <Link className="btn primary cta" href={routes.course(courseId)}>Get your certificate</Link>}
                    </div>
                  ) : completed ? (
                    <div className={s.markRow}>
                      <CircleCheck className={`${s.markIco} ok-text`} aria-hidden="true" />
                      <div className={s.markText}><b>Lesson complete</b><p>{doneCount} of {total} lessons done in this course.</p></div>
                      <button className="btn sm ghost" onClick={() => setComplete(false)}><Undo2 aria-hidden="true" /> Mark as not done</button>
                    </div>
                  ) : (
                    <div className={s.markRow}>
                      <div className={s.markText}><b>Done with this lesson?</b><p>Mark it complete to track your progress{next ? " and move on" : ""}.</p></div>
                      <button className="btn primary cta big" onClick={() => setComplete(true)}><Check aria-hidden="true" /> Mark complete</button>
                    </div>
                  )
                ) : (
                  <div className={s.markRow}>
                    <div className={s.markText}><b>This is a free preview</b><p>Get the full course to unlock every lesson and track your progress.</p></div>
                    {courseId && <Link className="btn primary" href={routes.course(courseId)}>See the course</Link>}
                  </div>
                )}
                {saveErr && <p className="err" role="alert" style={{ margin: 0 }}>{saveErr}</p>}
                {upNext && next && <UpNext next={next} onCancel={() => setUpNext(false)} />}
                {pager}
              </section>
            </>
          )}
        </div>

        {outline && <aside className={s.side} aria-label="Course lessons">{sidebar(false)}</aside>}
      </div>

      {outline && (
        <Drawer open={lessonsOpen} onClose={() => setLessonsOpen(false)} side="left" title={<><ListOrdered aria-hidden="true" /> Lessons</>}>
          {sidebar(true)}
        </Drawer>
      )}
      {payload && (
        <>
          <AskBro
            open={askOpen}
            onClose={() => setAskOpen(false)}
            context={aiContext}
            lessonTitle={lesson.title}
            course={courseId ? { id: courseId, is_free: free } : null}
            fallbackTrade={course && course.trade !== "all" ? course.trade : "gc"}
          />
          <TalkMode open={talkOpen} onClose={() => setTalkOpen(false)} context={aiContext} title={`Lesson${idx >= 0 ? ` ${idx + 1}` : ""}: ${lesson.title}`} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------------------
function Gate({ icon: Icon, eyebrow, title, children, alert }: { icon: any; eyebrow: string; title: string; children: React.ReactNode; alert?: boolean }) {
  return (
    <div className={s.gate} role={alert ? "alert" : undefined}>
      <div className={s.gateTop}><Icon aria-hidden="true" /><span>{eyebrow}</span></div>
      <div className="hazard thin" />
      <div className={s.gateBody}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function ErrorGate({ content, lesson, courseRow, courseId, courseTitle, free, previews, location, onRetry }: {
  content: Extract<Content, { status: "error" }>;
  lesson: Lesson;
  courseRow: Outline["course"] | null;
  courseId: string | null;
  courseTitle: string;
  free: boolean;
  previews: Lesson[];
  location: LocationInfo | null | undefined;
  onRetry: () => void;
}) {
  const [switching, setSwitching] = useState(false);
  const back = hereWith();

  switch (content.code) {
    case "signed_out": {
      const freeToWatch = free || lesson.is_preview;
      return (
        <Gate icon={LogIn} eyebrow="Sign in" title={freeToWatch ? "This lesson is free with an account" : "Sign in to watch this lesson"}>
          <p>{freeToWatch ? "Make a free Licensing Bro's account to watch it. No card needed." : "Sign in to the account you used to get this course."}</p>
          <div className="row">
            <Link className="btn primary cta" href={routes.login("signup", back)}>Create free account</Link>
            <Link className="btn" href={routes.login(undefined, back)}>Sign in</Link>
          </div>
        </Gate>
      );
    }
    case "not_enrolled":
      return (
        <Gate icon={Lock} eyebrow="Locked lesson" title="Unlock this lesson">
          <p>This lesson is part of <b>{courseTitle}</b>. Get the course to open every lesson, quiz and download.</p>
          {courseRow ? (
            <div className={s.upsell}>
              <span className={s.upsellPrice}>{priceLabel(courseRow)}</span>
              <div className={s.upsellBuy}><BuyButton course={courseRow} /></div>
            </div>
          ) : null}
          <div className="row">
            {courseId && <Link className="btn" href={routes.course(courseId)}>See what&rsquo;s in the course</Link>}
          </div>
          {previews.length > 0 && (
            <div className={s.previewList}>
              <p className="label">Free previews in this course</p>
              {previews.map((p) => <Link key={p.id} href={routes.lesson(p.id)}><CirclePlay aria-hidden="true" /> {p.title}</Link>)}
            </div>
          )}
        </Gate>
      );
    case "outside_home": {
      const here = place(location?.city, location?.region);
      const home = place(location?.home_city, location?.home_region);
      return (
        <Gate icon={MapPin} eyebrow="Travel mode" title="You're away from home">
          <p>
            Paid lessons play in your home area{home ? <> (<b>{home}</b>)</> : ""}{here ? <>, and right now you&rsquo;re in <b>{here}</b></> : ""}.
            Traveling for work? Turn on Travel mode to keep studying. It takes a minute and uses a code from your email.
          </p>
          <div className="row">
            <button className="btn primary cta" onClick={() => askForTravelMode()}><Plane aria-hidden="true" /> Turn on Travel mode</button>
            <button className="btn" onClick={onRetry}><RefreshCw aria-hidden="true" /> Try again</button>
          </div>
          <p className={s.gateNote}>Free lessons and the study tools in <Link href={routes.learn()}>My Learning</Link> work anywhere.</p>
        </Gate>
      );
    }
    case "no_session":
    case "session_replaced":
      return (
        <Gate icon={MonitorSmartphone} eyebrow="One device at a time" title="Use this device to keep watching">
          <p>Paid lessons play on one device at a time. {content.code === "session_replaced" ? "Your account was opened somewhere else." : "We need to confirm this device first."}</p>
          <div className="row">
            <button className="btn primary cta" disabled={switching} onClick={async () => { setSwitching(true); await claimSession(true); setSwitching(false); }}>
              {switching ? "Switching…" : "Use this device"}
            </button>
            <Link className="btn" href={routes.account("devices")}>Manage devices</Link>
          </div>
        </Gate>
      );
    case "not_found":
    case "bad_request":
      return (
        <Gate icon={TriangleAlert} eyebrow="Not available" title="This lesson isn't available" alert>
          <p>It may have been moved or taken down.</p>
          <div className="row">
            {courseId ? <Link className="btn primary" href={routes.course(courseId)}>Back to the course</Link> : <Link className="btn primary" href={routes.courses()}>Browse courses</Link>}
          </div>
        </Gate>
      );
    case "offline":
      return (
        <Gate icon={WifiOff} eyebrow="Offline" title="You're offline" alert>
          <p>Lessons need an internet connection. Connect and try again.</p>
          <div className="row"><button className="btn primary" onClick={onRetry}><RefreshCw aria-hidden="true" /> Try again</button></div>
        </Gate>
      );
    default:
      return (
        <Gate icon={TriangleAlert} eyebrow="Hmm" title="This lesson didn't load" alert>
          <p>{content.message || "Something went wrong. Try again in a moment."}</p>
          <div className="row"><button className="btn primary" onClick={onRetry}><RefreshCw aria-hidden="true" /> Try again</button></div>
        </Gate>
      );
  }
}

function UpNext({ next, onCancel }: { next: Lesson; onCancel: () => void }) {
  const router = useRouter();
  const [left, setLeft] = useState(6);
  useEffect(() => {
    if (left <= 0) { router.push(routes.lesson(next.id)); return; }
    const t = window.setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left, next.id, router]);
  return (
    <div className={s.upNext} role="status">
      <div className={s.upNextText}>
        <span className="eyebrow orange">Up next</span>
        <b>{next.title}</b>
        <span className={s.countdown} aria-hidden="true">Starting in {Math.max(left, 0)}…</span>
      </div>
      <div className="row">
        <Link className="btn primary" href={routes.lesson(next.id)}>Go now <ChevronRight aria-hidden="true" /></Link>
        <button className="btn ghost" onClick={onCancel}>Stay here</button>
      </div>
    </div>
  );
}

function Attachments({ items }: { items: { name: string; url: string }[] }) {
  const safe = items.filter((a) => a && /^https?:\/\//i.test(a.url || ""));
  if (!safe.length) return null;
  return (
    <section className="card" aria-labelledby="dl-title">
      <h2 id="dl-title" className={s.h3}><Paperclip aria-hidden="true" /> Downloads</h2>
      <ul className={s.files}>
        {safe.map((a, i) => (
          <li key={i}>
            <a href={a.url} target="_blank" rel="noopener noreferrer">
              <FileText aria-hidden="true" />
              <span>{a.name || "Download"}</span>
              <Download className={s.fileGo} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LessonNotes({ initial, save }: { initial: string; save: (text: string) => Promise<void> }) {
  const [text, setText] = useState(initial);
  const [status, setStatus] = useState<"idle" | "typing" | "saving" | "saved" | "error">("idle");
  const latest = useRef(initial);
  const saved = useRef(initial);
  const touched = useRef(false);
  const timer = useRef<number | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  // Saved notes usually arrive just after the lesson opens; never overwrite what the student has typed
  useEffect(() => {
    if (touched.current) return;
    setText(initial);
    latest.current = initial;
    saved.current = initial;
  }, [initial]);

  const flush = useCallback(async () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    const t = latest.current;
    if (t === saved.current) { setStatus((st) => (st === "typing" ? "saved" : st)); return; }
    setStatus("saving");
    try {
      await saveRef.current(t);
      saved.current = t;
      setStatus(latest.current === t ? "saved" : "typing");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush(); // save on leaving the lesson
    };
  }, [flush]);

  function change(v: string) {
    touched.current = true;
    setText(v);
    latest.current = v;
    setStatus("typing");
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 1200);
  }

  return (
    <section className={`card ${s.notes}`} aria-labelledby="notes-title">
      <div className={s.notesHead}>
        <h2 id="notes-title" className={s.h3}><NotebookPen aria-hidden="true" /> My notes</h2>
        <span className={s.noteStatus} role="status">
          {status === "saving" ? "Saving…" : status === "saved" ? <><Check aria-hidden="true" /> Saved</> : status === "error" ? "Couldn't save" : status === "typing" ? "Editing…" : "Saved automatically"}
        </span>
      </div>
      <label htmlFor="lesson-notes" className={s.sr}>Notes for this lesson</label>
      <textarea
        id="lesson-notes"
        className="input"
        value={text}
        maxLength={20000}
        placeholder="Jot down code sections, formulas or anything to review before the exam."
        onChange={(e) => change(e.target.value)}
        onBlur={flush}
        rows={5}
      />
      {status === "error" && <button className="btn sm" onClick={flush}><RefreshCw aria-hidden="true" /> Try saving again</button>}
    </section>
  );
}

function LessonSkeleton() {
  return (
    <>
      <section className={s.band} aria-busy="true" aria-label="Loading lesson">
        <div className={`wrap ${s.bandInner}`}>
          <i className={s.skLine} style={{ width: 180 }} />
          <i className={s.skLine} style={{ width: "70%", height: 30 }} />
        </div>
      </section>
      <div className="hazard thin" />
      <div className={`wrap ${s.layout}`}>
        <div className={s.main}><div className={`${s.player} ${s.playerSkel}`}><span className="spin" /></div></div>
      </div>
    </>
  );
}

function Missing() {
  return (
    <div className={`wrap ${s.missing}`}>
      <div className="plate stack" style={{ alignItems: "flex-start" }}>
        <p className="eyebrow orange" style={{ margin: 0 }}>Not found</p>
        <h1 className={s.missingTitle}>Lesson not found</h1>
        <p className="lede" style={{ margin: 0 }}>This lesson may have moved, or the link is missing a piece.</p>
        <Link className="btn primary cta" href={routes.courses()}>Browse courses</Link>
        <span className="bolts" />
      </div>
    </div>
  );
}
