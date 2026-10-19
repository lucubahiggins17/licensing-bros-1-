"use client";
// /live/watch/?id= : the class itself. Gets a pass from the live-token function, then plays LiveKit, an embed,
// a replay or a countdown. Chat on the right (below on phones), calls to action slide in over the video.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Volume2, VolumeX, Maximize, Minimize, CalendarClock, CalendarPlus, Radio, Lock, MapPin, MonitorSmartphone,
  WifiOff, Wrench, RefreshCw, Loader2, Clapperboard, BookOpen, Settings2, TriangleAlert, Mic
} from "lucide-react";
import AppShell from "@/components/shell/AppShell";
import { askForTravelMode } from "@/components/shell/SessionGuard";
import { callFn } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { claimSession, useSession } from "@/lib/session";
import { routes, useQueryParam, IS_APP_BUILD, SITE_URL } from "@/lib/nav";
import { supabase } from "@/lib/supabaseClient";
import { TRADE_LABELS, money, type Course, type LiveAccess } from "@/lib/types";
import { useLiveRoom } from "@/components/live/useLiveRoom";
import { useLiveRow } from "@/components/live/useLiveData";
import { AccessBadge, Countdown, Stage, StageMessage, ViewerChip } from "@/components/live/LiveBits";
import LiveChat from "@/components/live/LiveChat";
import CtaOverlay from "@/components/live/CtaOverlay";
import { absoluteUrl, accessHint, downloadIcs, fmtWhen, googleCalendarUrl, toPlayable } from "@/components/live/liveUtils";
import s from "./live.module.css";
import w from "./Watch.module.css";

type Phase =
  | { k: "idle" }
  | { k: "fetching" }
  | { k: "access"; access: LiveAccess; at: number }
  | { k: "error"; code: string; message: string };

type CourseLite = Pick<Course, "id" | "title" | "subtitle" | "price_cents" | "is_free">;

export default function WatchPage() {
  const id = useQueryParam("id");
  const { live, loading: rowLoading, missing, error: rowError, reload } = useLiveRow(id);
  const { ready, user, account } = useAuth();
  const sess = useSession();
  const lk = useLiveRoom();
  const { connect, disconnect } = lk;

  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [course, setCourse] = useState<CourseLite | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [isFs, setIsFs] = useState(false);
  const [fsSupported, setFsSupported] = useState(false);
  const stageWrapRef = useRef<HTMLDivElement>(null);
  const reqRef = useRef(0);
  const autoFor = useRef<string | null>(null);
  const prevStatus = useRef<string | null>(null);
  const here = id ? routes.watch(id) : routes.lives;

  // ------------------------------------------------------------------ pass from the server
  const fetchToken = useCallback(async (retried = false): Promise<void> => {
    if (!id) return;
    const mine = ++reqRef.current;
    setPhase({ k: "fetching" });
    try {
      const access = await callFn<LiveAccess>("live-token", { live_id: id, role: "viewer" });
      if (mine !== reqRef.current) return;
      setPhase({ k: "access", access, at: Date.now() });
    } catch (e: any) {
      if (mine !== reqRef.current) return;
      const code: string = e?.code || "error";
      if ((code === "no_session" || code === "session_replaced") && !retried) {
        const r = await claimSession(false);
        if (mine !== reqRef.current) return;
        if (r.status === "ok") return fetchToken(true);
        if (r.status === "in_use" || r.status === "replaced") setPhase({ k: "error", code: "device", message: "Your account is open on another device." });
        else setPhase({ k: "error", code: navigator.onLine === false ? "offline" : "error", message: r.error || "Couldn't check this device. Try again." });
        return;
      }
      if (code === "outside_home") askForTravelMode((e as any)?.data?.location);
      setPhase({ k: "error", code, message: e?.message || "Something went wrong." });
    }
  }, [id]);

  const sessionSettled = !user || (sess.status !== "idle" && sess.status !== "claiming");

  // First fetch once we know who's watching and the device check has finished
  useEffect(() => {
    if (!id || !ready || !live) return;
    if (!user) { reqRef.current++; setPhase({ k: "error", code: "signed_out", message: "" }); autoFor.current = null; return; }
    if (!sessionSettled) return;
    const key = `${id}:${user.id}`;
    if (autoFor.current === key) return;
    autoFor.current = key;
    fetchToken();
  }, [id, ready, live, user, sessionSettled, fetchToken]);

  // Realtime: the class ended while watching → leave the room and ask for the replay
  useEffect(() => {
    const st = live?.status || null;
    const before = prevStatus.current;
    prevStatus.current = st;
    if (!st || !before || st === before || !user) return;
    if (st === "ended" && phase.k === "access" && phase.access.mode !== "replay") {
      disconnect();
      setTimeout(() => fetchToken(), 1500); // give the server a moment
    }
  }, [live?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Waiting and the class is now live (Realtime flip, or the stream link wasn't ready yet): fetch a pass
  const waitTries = useRef(0);
  useEffect(() => {
    if (phase.k === "access" && phase.access.mode !== "waiting") waitTries.current = 0;
    if (phase.k !== "access" || phase.access.mode !== "waiting" || live?.status !== "live") return;
    const n = waitTries.current++;
    const delay = waitingInfo(phase.access).message ? 15000 : Math.min(300 * 2 ** n, 15000);
    const t = setTimeout(() => fetchToken(), delay);
    return () => clearTimeout(t);
  }, [phase, live?.status, fetchToken]);

  // The device check came back after a takeover, or Travel mode was turned on: try again
  useEffect(() => {
    if (phase.k !== "error") return;
    if ((phase.code === "device" || phase.code === "no_session" || phase.code === "session_replaced") && sess.status === "ok") fetchToken(true);
  }, [sess.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase.k === "error" && phase.code === "outside_home" && sess.location && sess.location.state !== "outside") fetchToken();
  }, [sess.location?.state, sess.location?.away_until]); // eslint-disable-line react-hooks/exhaustive-deps

  // Connect to LiveKit when we have a pass; leave on change/unmount
  useEffect(() => {
    if (phase.k !== "access" || phase.access.mode !== "livekit") return;
    connect(phase.access.url, phase.access.token).catch(() => { /* shown via lk.error */ });
    return () => { disconnect(); };
  }, [phase, connect, disconnect]);

  // Linked course (access hint, upsell, info)
  useEffect(() => {
    if (!live?.course_id) { setCourse(null); return; }
    let cancelled = false;
    supabase().from("courses").select("id,title,subtitle,price_cents,is_free").eq("id", live.course_id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setCourse((data as CourseLite) || null); });
    return () => { cancelled = true; };
  }, [live?.course_id]);

  // Fullscreen
  useEffect(() => {
    const d: any = document;
    setFsSupported(!!(d.fullscreenEnabled || d.webkitFullscreenEnabled));
    const on = () => setIsFs(!!(d.fullscreenElement || d.webkitFullscreenElement));
    document.addEventListener("fullscreenchange", on);
    document.addEventListener("webkitfullscreenchange", on);
    return () => { document.removeEventListener("fullscreenchange", on); document.removeEventListener("webkitfullscreenchange", on); };
  }, []);
  const toggleFs = () => {
    const d: any = document;
    const el: any = stageWrapRef.current;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
    else if (el) (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  };

  const hint = useMemo(() => (live ? accessHint(live, course, account, !!user) : null), [live, course, account, user]);
  const access = phase.k === "access" ? phase.access : null;
  const granted = !!access;

  function addToCalendar() {
    if (!live) return;
    const url = absoluteUrl(routes.watch(live.id), SITE_URL);
    if (IS_APP_BUILD) window.open(googleCalendarUrl(live, url), "_blank");
    else downloadIcs(live, url);
  }

  // ------------------------------------------------------------------ page states without a class
  if (id === undefined || (id && rowLoading && !live)) {
    return <Shell><div className={w.center}><span className="spin" aria-hidden="true" /> Loading the class…</div></Shell>;
  }
  if (!id || missing || (!live && rowError)) {
    return (
      <Shell>
        <div className={`plate ${w.notFound}`}>
          {rowError && !missing ? <WifiOff className={w.nfIcon} aria-hidden="true" /> : <CalendarClock className={w.nfIcon} aria-hidden="true" />}
          <h1>{rowError && !missing ? "Couldn't load the class" : "Class not found"}</h1>
          <p>{rowError && !missing ? rowError : "This class may have been moved or cancelled."}</p>
          <div className="row" style={{ justifyContent: "center" }}>
            {rowError && !missing && <button className="btn" onClick={reload}><RefreshCw aria-hidden="true" /> Try again</button>}
            <Link className="btn primary" href={routes.lives}>See all live classes</Link>
          </div>
          <span className="bolts" />
        </div>
      </Shell>
    );
  }
  if (!live) return <Shell><div className={w.center}><span className="spin" aria-hidden="true" /> Loading the class…</div></Shell>;

  const isLive = live.status === "live";
  const ended = live.status === "ended";
  // Calls to action float over our own LiveKit video; with third-party players (their controls sit at the bottom)
  // or message screens they dock right under the video instead.
  const ctaOnVideo = access?.mode === "livekit" && !!(lk.stage.screen || lk.stage.camera);

  // ------------------------------------------------------------------ the stage
  let stage: React.ReactNode;
  if (phase.k === "idle" || phase.k === "fetching") {
    stage = <div className={`${s.stage} ${s.stageAuto}`}><StageMessage icon={<Loader2 className={w.spinIcon} />} title="Getting your seat…">Checking your access.</StageMessage></div>;
  } else if (phase.k === "error") {
    stage = <div className={`${s.stage} ${s.stageAuto}`}>{renderError(phase)}</div>;
  } else if (access?.mode === "waiting") {
    const info = waitingInfo(access);
    const startIso = access.starts_at || live.starts_at;
    stage = (
      <div className={`${s.stage} ${s.stageAuto}`}>
        {info.ended || ended ? (
          <StageMessage icon={<Clapperboard />} title="This class has ended">
            {info.message || "The replay isn't posted yet."} Check back a little later.
            <div className={w.msgActions}><button className={`btn ${w.lightBtn}`} onClick={() => fetchToken()}><RefreshCw aria-hidden="true" /> Check again</button></div>
          </StageMessage>
        ) : isLive ? (
          <StageMessage icon={<Loader2 className={w.spinIcon} />} title="The class is starting">
            {info.message || "Opening the video…"}
          </StageMessage>
        ) : (
          <StageMessage icon={<CalendarClock />} title={new Date(startIso).getTime() > Date.now() ? "Class starts soon" : "Starting any minute"}>
            <p className={w.bigCount}><Countdown to={startIso} prefix="" startedText="The host will start shortly" /></p>
            <p>{fmtWhen(startIso)}. Keep this page open: the class starts here automatically.</p>
            <button type="button" className={`btn ${w.lightBtn}`} onClick={addToCalendar}><CalendarPlus aria-hidden="true" /> Add to calendar</button>
          </StageMessage>
        )}
      </div>
    );
  } else if (access?.mode === "embed" || access?.mode === "replay") {
    const raw = access.mode === "embed" ? access.embed_url : access.replay_url;
    const p = toPlayable(raw, { autoplay: access.mode === "embed" });
    stage = (
      <div className={`${s.stage}${p ? "" : ` ${s.stageAuto}`}`}>
        {!p ? (
          <StageMessage icon={<Clapperboard />} title={access.mode === "replay" ? "Replay coming soon" : "Stream link missing"}>
            {access.mode === "replay" ? "The recording of this class isn't up yet. Check back a little later." : "The host hasn't added the stream link yet. Hang tight."}
          </StageMessage>
        ) : p.kind === "video" ? (
          <video className={s.mainVideo} src={p.src} controls playsInline autoPlay={access.mode === "embed"} preload="metadata" />
        ) : (
          <iframe
            className={s.embed}
            src={p.src}
            title={live.title}
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
        {access.mode === "embed" && isLive && <div className={s.topLeft}><span className="badge live">Live</span></div>}
      </div>
    );
  } else {
    // LiveKit
    const tracks = !!(lk.stage.screen || lk.stage.camera);
    let empty: React.ReactNode = null;
    if (lk.status === "idle" || lk.status === "connecting") {
      empty = <StageMessage icon={<Loader2 className={w.spinIcon} />} title="Joining the class…">Connecting to the live video.</StageMessage>;
    } else if (lk.status === "disconnected") {
      empty = lk.endReason === "duplicate" ? (
        <StageMessage icon={<MonitorSmartphone />} title="Opened somewhere else">This class is playing in another tab or device.
          <div className={w.msgActions}><button className="btn primary" onClick={() => fetchToken()}>Watch here</button></div>
        </StageMessage>
      ) : lk.endReason === "ended" || ended ? (
        <StageMessage icon={<Radio />} title="The class has ended">Thanks for joining! The replay shows up on the schedule when it&rsquo;s ready.</StageMessage>
      ) : (
        <StageMessage icon={<WifiOff />} title="Connection lost">{lk.error || "The live video dropped. Check your connection."}
          <div className={w.msgActions}><button className="btn primary" onClick={() => fetchToken()}><RefreshCw aria-hidden="true" /> Reconnect</button></div>
        </StageMessage>
      );
    } else if (!tracks) {
      empty = (
        <StageMessage icon={lk.hasRemoteAudio ? <Mic /> : <Radio />} title={lk.hasRemoteAudio ? "Audio only right now" : "The host is getting ready"}>
          {lk.hasRemoteAudio ? "The host's camera is off. You can still listen in." : "Hang tight. Video starts here the moment the host turns on their camera."}
          {!lk.soundOn && (
            <div className={w.msgActions}>
              <button className={`btn ${w.lightBtn}`} onClick={lk.enableSound}><Volume2 aria-hidden="true" /> Turn on sound now</button>
            </div>
          )}
        </StageMessage>
      );
    }
    const showTap = (lk.status === "connected" || lk.status === "reconnecting") && tracks && (!lk.soundOn || lk.videoBlocked);
    stage = (
      <Stage screen={lk.stage.screen} camera={lk.stage.camera} empty={empty} className={tracks ? "" : s.stageAuto}>
        {(lk.status === "connected" || lk.status === "reconnecting") && (
          <div className={s.topLeft}>
            {isLive && <span className="badge live">Live</span>}
            <ViewerChip count={lk.remoteCount + 1} />
          </div>
        )}
        {lk.status === "reconnecting" && (
          <div className={s.banner} role="status"><Loader2 size={15} className={w.spinIcon} aria-hidden="true" /> Reconnecting…</div>
        )}
        {(lk.status === "connected" || lk.status === "reconnecting") && (
          <div className={s.topRight}>
            <button type="button" className={s.iconBtn} onClick={lk.soundOn ? lk.muteSound : lk.enableSound} aria-label={lk.soundOn ? "Mute" : "Turn on sound"} aria-pressed={lk.soundOn}>
              {lk.soundOn ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
            </button>
            {fsSupported && (
              <button type="button" className={s.iconBtn} onClick={toggleFs} aria-label={isFs ? "Exit full screen" : "Full screen"}>
                {isFs ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
              </button>
            )}
          </div>
        )}
        {showTap && (
          <div className={s.tapWrap}>
            <button type="button" className={s.tapBtn} onClick={lk.enableSound}>
              <Volume2 aria-hidden="true" /> {lk.videoBlocked ? "Tap to play" : "Tap for sound"}
            </button>
          </div>
        )}
      </Stage>
    );
  }

  // ------------------------------------------------------------------ page
  return (
    <Shell>
      <div className={w.head}>
        <Link href={routes.lives} className={w.back}><ArrowLeft size={16} aria-hidden="true" /> All live classes</Link>
        <div className={w.titleRow}>
          <h1>{live.title}</h1>
          <div className={w.badges}>
            {isLive ? <span className="badge live">Live now</span> : ended ? <span className="badge">Replay</span> : <span className="badge warn"><CalendarClock size={12} aria-hidden="true" /> {fmtWhen(live.starts_at)}</span>}
            {hint && <AccessBadge hint={hint} />}
            {live.trade !== "all" && <span className="badge">{TRADE_LABELS[live.trade]}</span>}
          </div>
        </div>
      </div>

      <div className={`${w.layout}${chatOpen ? "" : ` ${w.chatCollapsed}`}`}>
        <div className={w.stageArea}>
          <div className={s.stageWrap} ref={stageWrapRef}>
            {stage}
            {granted && <CtaOverlay liveId={live.id} enabled={granted} className={ctaOnVideo ? "" : s.ctaStatic} />}
          </div>
        </div>

        <div className={w.chatArea}>
          {granted ? (
            <LiveChat
              liveId={live.id}
              canSend={!ended}
              closedText="The class has ended, so chat is closed."
              open={chatOpen}
              onToggle={() => setChatOpen((o) => !o)}
              className={w.chat}
              title={ended ? "Class chat" : "Live chat"}
            />
          ) : (
            <section className={w.chatLocked} aria-label="Live chat">
              <Lock size={20} aria-hidden="true" />
              <p>Chat opens when you can watch this class.</p>
            </section>
          )}
        </div>

        <div className={w.infoArea}>
          <section className={w.info}>
            <span className="eyebrow orange">About this class</span>
            {live.description ? <p className={w.desc}>{live.description}</p> : <p className={w.desc}>Bring your questions. The instructor answers them live in the chat.</p>}
            <div className={w.facts}>
              <span><CalendarClock size={15} aria-hidden="true" /> {fmtWhen(live.starts_at)}</span>
              {hint && <span><Lock size={15} aria-hidden="true" /> {hint.detail}</span>}
            </div>
            <div className="row">
              {live.status === "scheduled" && <button type="button" className="btn sm" onClick={addToCalendar}><CalendarPlus aria-hidden="true" /> Add to calendar</button>}
              {course && <Link className="btn sm" href={routes.course(course.id)}><BookOpen aria-hidden="true" /> {course.title}</Link>}
              {account?.is_admin && <Link className="btn sm navy" href={routes.studio(live.id)}><Settings2 aria-hidden="true" /> Open studio</Link>}
            </div>
          </section>
        </div>
      </div>
    </Shell>
  );

  // ------------------------------------------------------------------ error messages inside the stage
  function renderError(p: { code: string; message: string }) {
    const live_ = live!;
    switch (p.code) {
      case "signed_out":
        return (
          <StageMessage icon={<Lock />} title="Sign in to watch">
            {live_.is_free ? "This class is free. You just need a Licensing Bro's account." : "Sign in with the account you used to get your course."}
            <div className={w.msgActions}>
              <Link className="btn primary cta" href={routes.login(undefined, here)}>Sign in</Link>
              <Link className={`btn ${w.lightBtn}`} href={routes.login("signup", here)}>Create free account</Link>
            </div>
          </StageMessage>
        );
      case "not_enrolled":
      case "forbidden":
      case "upgrade_required":
        return live_.course_id ? (
          <StageMessage icon={<BookOpen />} title={course ? `Included with ${course.title}` : "Included with a course"}>
            Get the course to watch this class live, plus every lesson in it{course && !course.is_free ? <> for <b>{money(course.price_cents)}</b></> : null}.
            <div className={w.msgActions}>
              <Link className="btn primary cta" href={routes.course(live_.course_id)}>Get the course</Link>
              <Link className={`btn ${w.lightBtn}`} href={routes.lives}>Free classes</Link>
            </div>
          </StageMessage>
        ) : (
          <StageMessage icon={<Lock />} title="A Pro class">
            Live classes like this are included with any paid course.
            <div className={w.msgActions}>
              <Link className="btn primary cta" href={routes.courses()}>Browse courses</Link>
              <Link className={`btn ${w.lightBtn}`} href={routes.lives}>Free classes</Link>
            </div>
          </StageMessage>
        );
      case "outside_home":
        return (
          <StageMessage icon={<MapPin />} title="You're away from home">
            Paid classes play in your home area. Turn on Travel mode to watch from where you are.
            <div className={w.msgActions}>
              <button className="btn primary cta" onClick={() => askForTravelMode()}>Turn on Travel mode</button>
              <button className={`btn ${w.lightBtn}`} onClick={() => fetchToken()}><RefreshCw aria-hidden="true" /> Try again</button>
            </div>
          </StageMessage>
        );
      case "device":
        return (
          <StageMessage icon={<MonitorSmartphone />} title="Open on another device">
            One device can use your account at a time.
            <div className={w.msgActions}>
              <button className="btn primary cta" onClick={async () => { const r = await claimSession(true); if (r.status === "ok") fetchToken(true); }}>Use it here instead</button>
            </div>
          </StageMessage>
        );
      case "not_found":
        return (
          <StageMessage icon={<CalendarClock />} title="Class not available">
            {p.message || "This class may have been moved or cancelled."}
            <div className={w.msgActions}><Link className="btn primary" href={routes.lives}>See all live classes</Link></div>
          </StageMessage>
        );
      case "not_configured":
        return <StageMessage icon={<Wrench />} title="Live video isn't set up yet">We&rsquo;re finishing the setup for live classes. Check back soon.</StageMessage>;
      case "offline":
        return (
          <StageMessage icon={<WifiOff />} title="You're offline">
            Check your connection, then try again.
            <div className={w.msgActions}><button className="btn primary" onClick={() => fetchToken()}><RefreshCw aria-hidden="true" /> Try again</button></div>
          </StageMessage>
        );
      default:
        return (
          <StageMessage icon={<TriangleAlert />} title={ended ? "Replay not available" : "Couldn't open the class"}>
            {ended && /replay|not found|no recording/i.test(p.message) ? "The recording of this class isn't up yet. Check back later." : p.message || "Something went wrong."}
            <div className={w.msgActions}><button className="btn primary" onClick={() => fetchToken()}><RefreshCw aria-hidden="true" /> Try again</button></div>
          </StageMessage>
        );
    }
  }
}

/** The server adds `ended` / `message` to waiting passes (class over without a replay, stream link not ready). */
function waitingInfo(a: LiveAccess): { ended: boolean; message: string } {
  const x = a as any;
  return { ended: !!x?.ended, message: typeof x?.message === "string" ? x.message : "" };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell active="live" blueprint>
      <main className={`wrap ${w.main}`}>{children}</main>
    </AppShell>
  );
}
