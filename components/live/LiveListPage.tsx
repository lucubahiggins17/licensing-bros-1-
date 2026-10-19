"use client";
// /live/ : what's on now, the upcoming schedule (in the viewer's timezone) and replays. Updates instantly via Realtime.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Radio, CalendarPlus, Clock, BookOpen, PlayCircle, CalendarClock, Settings2, Bell, RefreshCw, ChevronDown } from "lucide-react";
import AppShell from "@/components/shell/AppShell";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/auth";
import { routes, IS_APP_BUILD, SITE_URL } from "@/lib/nav";
import { TRADE_LABELS, type Course, type Live } from "@/lib/types";
import { AccessBadge, Countdown } from "@/components/live/LiveBits";
import { absoluteUrl, accessHint, channelName, dateParts, downloadIcs, fmtTime, fmtWhen, googleCalendarUrl, sortLives } from "@/components/live/liveUtils";
import st from "./LiveList.module.css";

type CourseLite = Pick<Course, "id" | "title">;
const STALE_MS = 6 * 3600_000; // scheduled classes more than 6h in the past are hidden from "Upcoming"

export default function LiveListPage() {
  const { user, account } = useAuth();
  const [lives, setLives] = useState<Live[] | null>(null);
  const [courses, setCourses] = useState<Record<string, CourseLite>>({});
  const [err, setErr] = useState("");
  const [showAllReplays, setShowAllReplays] = useState(false);
  const isAdmin = !!account?.is_admin;

  const load = useCallback(async () => {
    setErr("");
    try {
      const { data, error } = await supabase().from("lives").select("*").order("starts_at", { ascending: true }).limit(300);
      if (error) throw error;
      setLives((data as Live[]) || []);
    } catch (e: any) {
      setErr(typeof navigator !== "undefined" && navigator.onLine === false ? "You're offline. The schedule will load when you're back online." : "We couldn't load the schedule. Try again.");
      setLives((prev) => prev || []);
    }
  }, []);

  // Initial load + realtime: cards flip to LIVE the moment the host starts
  useEffect(() => {
    load();
    let ch: any = null;
    try {
      ch = supabase()
        .channel(channelName("lives-list"))
        .on("postgres_changes", { event: "*", schema: "public", table: "lives" }, (p: any) => {
          setLives((prev) => {
            const list = prev || [];
            if (p.eventType === "DELETE") return list.filter((l) => l.id !== p.old?.id);
            const row = p.new as Live;
            const i = list.findIndex((l) => l.id === row.id);
            if (i === -1) return [...list, row].sort(sortLives);
            const next = list.slice();
            next[i] = { ...next[i], ...row };
            return next.sort(sortLives);
          });
        })
        .subscribe();
    } catch { /* not configured */ }
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    const onOnline = () => load();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
      if (ch) supabase().removeChannel(ch);
    };
  }, [load]);

  // Titles of linked courses
  useEffect(() => {
    if (!lives) return;
    const missing = Array.from(new Set(lives.map((l) => l.course_id).filter((id): id is string => !!id && !courses[id])));
    if (!missing.length) return;
    supabase().from("courses").select("id,title").in("id", missing).then(({ data }) => {
      if (data?.length) setCourses((prev) => ({ ...prev, ...Object.fromEntries((data as CourseLite[]).map((c) => [c.id, c])) }));
    });
  }, [lives]); // eslint-disable-line react-hooks/exhaustive-deps

  const { liveNow, upcoming, replays } = useMemo(() => {
    const now = Date.now();
    const all = lives || [];
    return {
      liveNow: all.filter((l) => l.status === "live"),
      upcoming: all.filter((l) => l.status === "scheduled" && new Date(l.starts_at).getTime() > now - STALE_MS),
      replays: all.filter((l) => l.status === "ended").sort((a, b) => sortLives(b, a))
    };
  }, [lives]);

  // Read on the client only (the static build runs in a different timezone)
  const [tz, setTz] = useState("");
  useEffect(() => { try { setTz(Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ")); } catch { /* unknown */ } }, []);
  const hint = (l: Live) => accessHint(l, l.course_id ? courses[l.course_id] : null, account, !!user);

  function addToCalendar(l: Live) {
    const url = absoluteUrl(routes.watch(l.id), SITE_URL);
    if (IS_APP_BUILD) window.open(googleCalendarUrl(l, url), "_blank");
    else downloadIcs(l, url);
  }

  const shownReplays = showAllReplays ? replays : replays.slice(0, 6);

  return (
    <AppShell active="live" blueprint>
      <section className={st.hero}>
        <div className="wrap">
          <div className={st.heroHead}>
            <div>
              <span className={`eyebrow ${st.heroEyebrow}`}><Radio size={14} aria-hidden="true" /> Live classes</span>
              <h1 className={st.heroTitle}>Learn it live<span>Ask the pros</span></h1>
              <p className={st.heroSub}>Join instructors in real time, ask questions in the chat and get straight answers about your exam.</p>
            </div>
            {isAdmin && (
              <Link className="btn outline-navy" href={routes.admin("lives")} style={{ background: "#fff" }}>
                <Settings2 aria-hidden="true" /> Manage classes
              </Link>
            )}
          </div>

          {lives === null ? (
            <div className={st.loadingCard}><span className="spin" aria-hidden="true" /> Loading the schedule…</div>
          ) : liveNow.length > 0 ? (
            <div className={st.liveList}>
              {liveNow.map((l) => {
                const h = hint(l);
                return (
                  <article key={l.id} className={st.liveCard}>
                    <div className={st.liveMedia} style={l.cover_url ? { backgroundImage: `url("${l.cover_url}")` } : undefined}>
                      {!l.cover_url && (
                        <div className={`plate ${st.onAir}`}>
                          <Radio aria-hidden="true" />
                          <b>On air</b>
                          <span className="bolts" />
                        </div>
                      )}
                    </div>
                    <div className={st.liveInfo}>
                      <div className="row" style={{ gap: 6 }}>
                        <span className="badge live">Live now</span>
                        <AccessBadge hint={h} />
                        {l.trade !== "all" && <span className="badge">{TRADE_LABELS[l.trade]}</span>}
                      </div>
                      <h2>{l.title}</h2>
                      {l.description && <p className={st.liveDesc}>{l.description}</p>}
                      <div className="row">
                        <Link className="btn primary cta" href={routes.watch(l.id)}><PlayCircle aria-hidden="true" /> Join now</Link>
                        {isAdmin && <Link className="btn navy" href={routes.studio(l.id)}>Open studio</Link>}
                      </div>
                      <p className={st.fine}>{h.detail}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="hazard" />
      </section>

      <main className={`wrap ${st.main}`}>
        {err && (
          <div className={st.errBox} role="alert">
            <span>{err}</span>
            <button className="btn sm" onClick={load}><RefreshCw aria-hidden="true" /> Try again</button>
          </div>
        )}

        {/* Upcoming */}
        <section aria-labelledby="up-title" className={st.block}>
          <div className={st.blockHead}>
            <div>
              <span className="eyebrow orange">Schedule</span>
              <h2 id="up-title">Upcoming</h2>
            </div>
            {tz && <p className={st.tz}><Clock size={14} aria-hidden="true" /> Times in your timezone ({tz})</p>}
          </div>

          {lives === null ? null : upcoming.length === 0 ? (
            liveNow.length === 0 && (
              <div className={`plate ${st.empty}`}>
                <CalendarClock className={st.emptyIcon} aria-hidden="true" />
                <h3>No classes on the schedule yet</h3>
                <p>New live classes show up here as soon as they&rsquo;re booked. {user ? <>When one goes live you&rsquo;ll get a notification in the <Bell size={14} aria-label="bell" style={{ verticalAlign: "-2px" }} />.</> : <>Create a free account to get a heads-up when one goes live.</>}</p>
                <div className="row" style={{ justifyContent: "center" }}>
                  <Link className="btn primary" href={routes.courses()}>Browse courses</Link>
                  <Link className="btn" href={routes.learn()}>Practice now</Link>
                  {isAdmin && <Link className="btn navy" href={routes.admin("lives")}>Schedule a class</Link>}
                </div>
                <span className="bolts" />
              </div>
            )
          ) : (
            <ol className={st.schedule}>
              {upcoming.map((l) => {
                const d = dateParts(l.starts_at);
                const h = hint(l);
                const course = l.course_id ? courses[l.course_id] : null;
                return (
                  <li key={l.id} className={st.item}>
                    <div className={st.date} aria-hidden="true">
                      <span>{d.weekday}</span>
                      <b>{d.day}</b>
                      <span className={st.month}>{d.month}</span>
                    </div>
                    <div className={st.info}>
                      <div className={st.badges}>
                        <AccessBadge hint={h} />
                        {l.trade !== "all" && <span className="badge">{TRADE_LABELS[l.trade]}</span>}
                      </div>
                      <h3><Link href={routes.watch(l.id)}>{l.title}</Link></h3>
                      <p className={st.when}>
                        <Clock size={14} aria-hidden="true" />
                        <time dateTime={l.starts_at}><span className={st.srOnly}>{fmtWhen(l.starts_at)}</span><span aria-hidden="true">{fmtTime(l.starts_at)}</span></time>
                        <span className={st.dot} aria-hidden="true">·</span>
                        <Countdown to={l.starts_at} className={st.countdown} />
                      </p>
                      {course && (
                        <p className={st.course}><BookOpen size={14} aria-hidden="true" /> Course: <Link href={routes.course(course.id)}>{course.title}</Link></p>
                      )}
                      {l.description && <p className={st.desc}>{l.description}</p>}
                    </div>
                    <div className={st.actions}>
                      <button type="button" className="btn sm" onClick={() => addToCalendar(l)} aria-label={`Add ${l.title} to your calendar`}>
                        <CalendarPlus aria-hidden="true" /> Add to calendar
                      </button>
                      <Link className="btn sm navy" href={routes.watch(l.id)}>Details</Link>
                      {isAdmin && <Link className="btn sm" href={routes.studio(l.id)}>Studio</Link>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* Replays */}
        {replays.length > 0 && (
          <section aria-labelledby="rp-title" className={st.block}>
            <div className={st.blockHead}>
              <div>
                <span className="eyebrow orange">Missed one?</span>
                <h2 id="rp-title">Replays</h2>
              </div>
            </div>
            <div className={st.replays}>
              {shownReplays.map((l) => {
                const h = hint(l);
                return (
                  <Link key={l.id} href={routes.watch(l.id)} className={st.replay}>
                    <div className={st.thumb} style={l.cover_url ? { backgroundImage: `url("${l.cover_url}")` } : undefined}>
                      <PlayCircle aria-hidden="true" />
                    </div>
                    <div className={st.replayInfo}>
                      <div className={st.badges}>
                        <span className="badge">Replay</span>
                        <AccessBadge hint={h} />
                      </div>
                      <h3>{l.title}</h3>
                      <p className={st.fine}>{new Date(l.starts_at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
            {replays.length > 6 && !showAllReplays && (
              <div className="center" style={{ marginTop: 16 }}>
                <button className="btn" onClick={() => setShowAllReplays(true)}><ChevronDown aria-hidden="true" /> Show all {replays.length} replays</button>
              </div>
            )}
          </section>
        )}
      </main>
    </AppShell>
  );
}
