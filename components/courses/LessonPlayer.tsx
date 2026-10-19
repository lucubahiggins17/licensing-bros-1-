"use client";
// Lesson video: YouTube / Vimeo embeds, or an HTML5 <video> with resume, position saving and speed control.
import { useCallback, useEffect, useRef, useState } from "react";
import { Gauge, RotateCcw, RefreshCw, TriangleAlert } from "lucide-react";
import { clock } from "./courseData";
import s from "./Lesson.module.css";

export type LessonVideo = { type: "youtube" | "vimeo" | "file"; url: string };

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const RATE_KEY = "lb.playbackRate";

/** Builds a safe embed URL (the lesson function usually sends one already; this also accepts watch/share links). */
export function embedSrc(v: LessonVideo): string | null {
  let u: URL;
  try { u = new URL(v.url); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (v.type === "youtube") {
    let id: string | null = null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (host === "youtu.be") id = parts[0] || null;
    else if (parts[0] === "watch") id = u.searchParams.get("v");
    else if (["embed", "shorts", "live", "v"].includes(parts[0])) id = parts[1] || null;
    if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
    const out = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
    const start = u.searchParams.get("start") || u.searchParams.get("t");
    if (start && /^\d+$/.test(start)) out.searchParams.set("start", start);
    out.searchParams.set("rel", "0");
    out.searchParams.set("modestbranding", "1");
    out.searchParams.set("playsinline", "1");
    return out.toString();
  }
  if (v.type === "vimeo") {
    if (host === "player.vimeo.com") return u.toString();
    const m = /^\/(?:video\/)?(\d+)(?:\/([\da-f]+))?/i.exec(u.pathname);
    if (!m) return null;
    const out = new URL(`https://player.vimeo.com/video/${m[1]}`);
    const h = m[2] || u.searchParams.get("h");
    if (h) out.searchParams.set("h", h);
    out.searchParams.set("dnt", "1");
    return out.toString();
  }
  return null;
}

type Props = {
  video: LessonVideo;
  title: string;
  /** Where to resume a file video (seconds) */
  startAt?: number;
  /** Called with the current position every 10 s while playing and on pause; 0 when it ends */
  onPosition?: (sec: number) => void;
  onEnded?: () => void;
  /** Ask the page to fetch a fresh signed video link (they expire after 2 hours) */
  onReload?: () => void;
};

export default function LessonPlayer({ video, title, startAt = 0, onPosition, onEnded, onReload }: Props) {
  if (video.type === "file") return <FilePlayer src={video.url} title={title} startAt={startAt} onPosition={onPosition} onEnded={onEnded} onReload={onReload} />;
  const src = embedSrc(video);
  if (!src) {
    return (
      <div className={s.playerMsg} role="alert">
        <TriangleAlert aria-hidden="true" /> This video link can&rsquo;t be played here. Let support know so we can fix it.
      </div>
    );
  }
  return (
    <div className={s.player}>
      <iframe
        src={src}
        title={`Video: ${title}`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}

function readRate(): number {
  try {
    const r = Number(localStorage.getItem(RATE_KEY));
    return SPEEDS.includes(r) ? r : 1;
  } catch {
    return 1;
  }
}

function FilePlayer({ src, title, startAt, onPosition, onEnded, onReload }: { src: string; title: string; startAt: number } & Omit<Props, "video" | "title" | "startAt">) {
  const ref = useRef<HTMLVideoElement>(null);
  const [rate, setRate] = useState(1);
  const [resumedAt, setResumedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const resumeAt = useRef(startAt);      // latest known position (survives a fresh signed URL)
  const lastSaved = useRef(startAt);
  const resumedOnce = useRef(false);
  const posRef = useRef(onPosition);
  posRef.current = onPosition;
  const endRef = useRef(onEnded);
  endRef.current = onEnded;

  useEffect(() => { setRate(readRate()); }, []);
  useEffect(() => {
    // A saved position can arrive after the player mounted (progress loads separately)
    if (!resumedOnce.current && startAt > resumeAt.current) {
      resumeAt.current = startAt;
      const v = ref.current;
      if (v && v.readyState >= 1 && v.currentTime < 1) seekToResume(v);
    }
  }, [startAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = rate;
    try { localStorage.setItem(RATE_KEY, String(rate)); } catch { /* storage blocked */ }
  }, [rate]);

  const save = useCallback(() => {
    const v = ref.current;
    if (!v || !posRef.current || !isFinite(v.currentTime)) return;
    const t = Math.floor(v.currentTime);
    resumeAt.current = t;
    if (Math.abs(t - lastSaved.current) < 2) return;
    lastSaved.current = t;
    posRef.current(t);
  }, []);

  function seekToResume(v: HTMLVideoElement) {
    const at = resumeAt.current;
    const dur = isFinite(v.duration) ? v.duration : 0;
    if (at > 5 && (!dur || at < dur - 10)) {
      v.currentTime = at;
      if (!resumedOnce.current) setResumedAt(at);
    }
    resumedOnce.current = true;
  }

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let iv: number | null = null;
    const stop = () => { if (iv !== null) { window.clearInterval(iv); iv = null; } };
    const onPlay = () => { setFailed(false); if (iv === null) iv = window.setInterval(save, 10_000); };
    const onPause = () => { stop(); save(); };
    const onEnd = () => {
      stop();
      resumeAt.current = 0;
      lastSaved.current = 0;
      posRef.current?.(0); // start from the top next time
      endRef.current?.();
    };
    const onHide = () => { if (document.visibilityState === "hidden") save(); };
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnd);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    return () => {
      stop();
      save();
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnd);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", save);
    };
  }, [save]);

  return (
    <div>
      <div className={s.player}>
        <video
          ref={ref}
          src={src}
          title={title}
          aria-label={`Video: ${title}`}
          controls
          playsInline
          preload="metadata"
          controlsList="nodownload"
          onContextMenu={(e) => e.preventDefault()}
          onLoadedMetadata={(e) => { e.currentTarget.playbackRate = rate; seekToResume(e.currentTarget); }}
          onError={() => setFailed(true)}
        />
        {failed && (
          <div className={s.playerOverlay} role="alert">
            <TriangleAlert aria-hidden="true" />
            <p>The video stopped loading. Video links refresh every couple of hours, so grab a fresh one.</p>
            {onReload && <button className="btn primary" onClick={() => { setFailed(false); onReload(); }}><RefreshCw aria-hidden="true" /> Reload video</button>}
          </div>
        )}
      </div>
      <div className={s.vbar}>
        <label className={s.speed}>
          <Gauge aria-hidden="true" />
          <span>Speed</span>
          <select value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Playback speed">
            {SPEEDS.map((r) => <option key={r} value={r}>{r === 1 ? "Normal" : `${r}x`}</option>)}
          </select>
        </label>
        {resumedAt !== null && (
          <span className={s.resumed} role="status">
            Picked up where you left off ({clock(resumedAt)}).
            <button className="btn sm ghost" onClick={() => { const v = ref.current; if (v) { v.currentTime = 0; v.play().catch(() => {}); } setResumedAt(null); }}>
              <RotateCcw aria-hidden="true" /> Start over
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
