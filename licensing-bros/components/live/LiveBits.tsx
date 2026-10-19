"use client";
// Small shared pieces for the Live pages: video tiles, the stage, countdowns, badges and poll bars.
import { useEffect, useRef } from "react";
import type { VideoTrack } from "livekit-client";
import { Users, Wifi, WifiOff, Signal } from "lucide-react";
import { ConnectionQuality } from "livekit-client";
import { countdownText } from "@/components/live/liveUtils";
import { useNow } from "@/components/live/useLiveData";
import type { AccessHint } from "@/components/live/liveUtils";
import s from "./live.module.css";

/** Attaches a LiveKit video track to a <video>. */
export function TrackVideo({ track, className, mirror = false, label }: { track: VideoTrack; className?: string; mirror?: boolean; label?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = true; // audio plays through separate elements
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  return (
    <video
      ref={ref}
      className={`${className || ""}${mirror ? ` ${s.mirror}` : ""}`}
      data-lk=""
      autoPlay
      playsInline
      muted
      aria-label={label}
    />
  );
}

/** Screen share large with the camera picture-in-picture, or the camera alone. Children render on top (overlays). */
export function Stage({ screen, camera, mirrorCamera = false, children, empty, className }: {
  screen: VideoTrack | null;
  camera: VideoTrack | null;
  mirrorCamera?: boolean;
  children?: React.ReactNode;
  empty?: React.ReactNode;
  className?: string;
}) {
  const main = screen || camera;
  return (
    <div className={`${s.stage} ${className || ""}`}>
      {main ? (
        <TrackVideo key={main === screen ? "screen" : "camera"} track={main} className={s.mainVideo} mirror={!screen && mirrorCamera} label={screen ? "Shared screen" : "Host camera"} />
      ) : (
        empty
      )}
      {screen && camera && <TrackVideo track={camera} className={s.pip} mirror={mirrorCamera} label="Host camera" />}
      {children}
    </div>
  );
}

/** Ticking "Starts in 2h 05m" */
export function Countdown({ to, prefix = "Starts in", startedText = "Starting soon", className }: { to: string; prefix?: string; startedText?: string; className?: string }) {
  const now = useNow(1000);
  const t = countdownText(to, now);
  return (
    <span className={className} role="timer" aria-live="off">
      {t ? <>{prefix} <b className={s.tabular}>{t}</b></> : startedText}
    </span>
  );
}

export function AccessBadge({ hint }: { hint: AccessHint }) {
  return <span className={`badge ${hint.tone === "free" ? "free" : hint.tone === "ok" ? "ok" : "paid"}`} title={hint.detail}>{hint.label}</span>;
}

export function ViewerChip({ count }: { count: number }) {
  return (
    <span className={s.chipDark} aria-label={`${count} watching`}>
      <Users size={14} aria-hidden="true" /> <b className={s.tabular}>{count}</b> watching
    </span>
  );
}

const Q_LABEL: Record<string, string> = {
  [ConnectionQuality.Excellent]: "Excellent",
  [ConnectionQuality.Good]: "Good",
  [ConnectionQuality.Poor]: "Poor",
  [ConnectionQuality.Lost]: "Lost",
  [ConnectionQuality.Unknown]: "Checking"
};

export function QualityChip({ quality, dark = false }: { quality: ConnectionQuality; dark?: boolean }) {
  const tone = quality === ConnectionQuality.Excellent || quality === ConnectionQuality.Good ? s.qGood : quality === ConnectionQuality.Poor ? s.qPoor : quality === ConnectionQuality.Lost ? s.qBad : s.qUnknown;
  const Icon = quality === ConnectionQuality.Lost ? WifiOff : quality === ConnectionQuality.Unknown ? Signal : Wifi;
  return (
    <span className={`${dark ? s.chipDark : s.chipLight} ${tone}`} title="Connection quality">
      <Icon size={14} aria-hidden="true" /> {Q_LABEL[quality] || "Checking"}
    </span>
  );
}

/** Result bars for a poll */
export function PollBars({ options, counts, mine }: { options: string[]; counts: number[]; mine?: number | null }) {
  const total = counts.reduce((a, b) => a + b, 0);
  const top = Math.max(0, ...counts);
  return (
    <div className={s.pollBars}>
      {options.map((o, i) => {
        const n = counts[i] || 0;
        const pct = total ? Math.round((n / total) * 100) : 0;
        return (
          <div key={i} className={`${s.pollRow}${mine === i ? ` ${s.pollMine}` : ""}${n > 0 && n === top ? ` ${s.pollTop}` : ""}`}>
            <div className={s.pollLabel}>
              <span>{o}{mine === i && <em> · your vote</em>}</span>
              <b className={s.tabular}>{pct}%</b>
            </div>
            <div className={s.pollTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${o}: ${pct}%`}>
              <i style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      <p className={s.pollTotal}>{total} {total === 1 ? "vote" : "votes"}</p>
    </div>
  );
}

/** Centered message inside a stage (getting ready, offline, ended…) */
export function StageMessage({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className={s.stageMsg}>
      {icon && <div className={s.stageIcon}>{icon}</div>}
      <h2>{title}</h2>
      {children && <div className={s.stageSub}>{children}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="spin" role="status" aria-label={label} />;
}
