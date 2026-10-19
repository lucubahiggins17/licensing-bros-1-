"use client";
// Reusable LiveKit room logic for viewers (subscribe only) and hosts (camera, mic, screen share).
// Viewers: connect(url, token) → stage.screen / stage.camera tracks, remote audio is attached to hidden <audio>
// elements that start muted until enableSound() runs inside a tap (browsers block autoplay audio).
// Hosts: startPreview() → local camera/mic tracks you can show before going live; connect(url, token, {publish:true})
// publishes whatever is on; setCamera/setMic/setScreen toggle at any time.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  TrackEvent,
  ConnectionState,
  ConnectionQuality,
  DisconnectReason,
  VideoPresets,
  createLocalVideoTrack,
  createLocalAudioTrack,
  createLocalScreenTracks,
  createLocalTracks,
  type LocalAudioTrack,
  type LocalVideoTrack,
  type LocalTrack,
  type Participant,
  type RemoteTrack,
  type VideoTrack
} from "livekit-client";

export type RoomStatus = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";
export type EndReason = "left" | "duplicate" | "removed" | "ended" | "network" | null;
export type StageTracks = { screen: VideoTrack | null; camera: VideoTrack | null };

const EMPTY_STAGE: StageTracks = { screen: null, camera: null };

export const screenShareSupported = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof (navigator.mediaDevices as any).getDisplayMedia === "function" &&
  !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Friendly words for camera/mic failures */
export function mediaErrorText(e: any, what: "camera" | "microphone" | "screen"): string {
  const name = e?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    if (what === "screen") return "Screen sharing was cancelled.";
    return `Your ${what} is blocked. Allow ${what} access in the browser's address bar (or app settings), then try again.`;
  }
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return `No ${what} found. Plug one in or pick another.`;
  if (name === "NotReadableError" || name === "TrackStartError") return `Your ${what} is being used by another app. Close it and try again.`;
  if (typeof navigator !== "undefined" && !navigator.mediaDevices) return "This browser can't use a camera here. Use Chrome or Edge on a computer.";
  return `Couldn't start your ${what}. ${e?.message || ""}`.trim();
}

function connectErrorText(e: any): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "You're offline. Check your connection and try again.";
  const msg = String(e?.message || "");
  if (/token|unauthori[sz]ed|401|403/i.test(msg)) return "The class pass expired. Tap Try again.";
  return "We couldn't reach the live video. Check your connection and try again.";
}

const endReasonFrom = (r?: DisconnectReason): EndReason => {
  switch (r) {
    case DisconnectReason.CLIENT_INITIATED: return "left";
    case DisconnectReason.DUPLICATE_IDENTITY: return "duplicate";
    case DisconnectReason.PARTICIPANT_REMOVED: return "removed";
    case DisconnectReason.ROOM_DELETED: return "ended";
    default: return "network";
  }
};

type Local = { camera: LocalVideoTrack | null; mic: LocalAudioTrack | null; screen: LocalVideoTrack | null; screenAudio: LocalAudioTrack | null };

export function useLiveRoom() {
  const roomRef = useRef<Room | null>(null);
  const audioBoxRef = useRef<HTMLDivElement | null>(null);
  const soundOnRef = useRef(false);
  const localRef = useRef<Local>({ camera: null, mic: null, screen: null, screenAudio: null });
  const deviceRef = useRef<{ camera: string; mic: string }>({ camera: "", mic: "" });
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<RoomStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [endReason, setEndReason] = useState<EndReason>(null);
  const [remoteCount, setRemoteCount] = useState(0);
  const [stage, setStage] = useState<StageTracks>(EMPTY_STAGE);
  const [hasRemoteAudio, setHasRemoteAudio] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [videoBlocked, setVideoBlocked] = useState(false);
  const [quality, setQuality] = useState<ConnectionQuality>(ConnectionQuality.Unknown);

  // Host side
  const [local, setLocal] = useState<Local>(localRef.current);
  const [micOn, setMicOn] = useState(false);
  const [devices, setDevices] = useState<{ cameras: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }>({ cameras: [], mics: [] });
  const [deviceIds, setDeviceIds] = useState<{ camera: string; mic: string }>({ camera: "", mic: "" });
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);

  const commitLocal = useCallback((patch: Partial<Local>) => {
    localRef.current = { ...localRef.current, ...patch };
    if (mountedRef.current) setLocal(localRef.current);
  }, []);

  const audioBox = () => {
    if (!audioBoxRef.current) {
      const d = document.createElement("div");
      d.setAttribute("aria-hidden", "true");
      d.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
      document.body.appendChild(d);
      audioBoxRef.current = d;
    }
    return audioBoxRef.current;
  };
  const clearAudio = () => {
    audioBoxRef.current?.remove();
    audioBoxRef.current = null;
  };

  /** Recompute which remote tracks the stage shows. Screen share wins the big spot; camera goes picture-in-picture. */
  const sync = useCallback(() => {
    const room = roomRef.current;
    if (!room || !mountedRef.current) return;
    setRemoteCount(room.remoteParticipants.size);
    let screen: VideoTrack | null = null;
    let screenOwner = "";
    let audio = false;
    const cameras: { owner: string; track: VideoTrack }[] = [];
    for (const p of Array.from(room.remoteParticipants.values())) {
      for (const pub of Array.from(p.trackPublications.values())) {
        const t = pub.track as RemoteTrack | undefined;
        if (!t || !pub.isSubscribed) continue;
        if (t.kind === Track.Kind.Audio) { if (!pub.isMuted) audio = true; continue; }
        if (t.kind !== Track.Kind.Video || pub.isMuted) continue;
        if (pub.source === Track.Source.ScreenShare) { if (!screen) { screen = t as VideoTrack; screenOwner = p.identity; } }
        else cameras.push({ owner: p.identity, track: t as VideoTrack });
      }
    }
    const camera = (cameras.find((c) => c.owner === screenOwner) || cameras[0])?.track || null;
    setStage((prev) => (prev.screen === screen && prev.camera === camera ? prev : { screen, camera }));
    setHasRemoteAudio(audio);
  }, []);

  const stopLocalTracks = useCallback(() => {
    const l = localRef.current;
    [l.camera, l.mic, l.screen, l.screenAudio].forEach((t) => { try { t?.stop(); } catch { /* already stopped */ } });
    commitLocal({ camera: null, mic: null, screen: null, screenAudio: null });
    if (mountedRef.current) setMicOn(false);
  }, [commitLocal]);

  const teardown = useCallback(async (stopLocal: boolean) => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      room.removeAllListeners();
      try { await room.disconnect(false); } catch { /* ignore */ }
    }
    if (stopLocal) stopLocalTracks();
    clearAudio();
    if (mountedRef.current) {
      setStage(EMPTY_STAGE);
      setRemoteCount(0);
      setHasRemoteAudio(false);
      setQuality(ConnectionQuality.Unknown);
    }
  }, [stopLocalTracks]);

  /** Publishes every local track that isn't published yet (safe to call again, e.g. after a reconnect). */
  const publishLocal = async (room: Room) => {
    const l = localRef.current;
    const lp = room.localParticipant;
    const published = (t: LocalTrack) => Array.from(lp.trackPublications.values()).some((p) => p.track === t);
    const list: [LocalTrack | null, Track.Source][] = [
      [l.camera, Track.Source.Camera],
      [l.mic, Track.Source.Microphone],
      [l.screen, Track.Source.ScreenShare],
      [l.screenAudio, Track.Source.ScreenShareAudio]
    ];
    for (const [t, source] of list) {
      if (t && !published(t)) await lp.publishTrack(t, { source, ...(source === Track.Source.Camera ? { simulcast: true } : {}) });
    }
  };

  /** Join the room. Hosts pass {publish:true} to publish the tracks they turned on. */
  const connect = useCallback(async (url: string, token: string, opts: { publish?: boolean } = {}) => {
    await teardown(false);
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      stopLocalTrackOnUnpublish: false,
      disconnectOnPageLeave: true,
      videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
      publishDefaults: { simulcast: true }
    });
    roomRef.current = room;
    const isCurrent = () => roomRef.current === room && mountedRef.current;

    room
      .on(RoomEvent.ConnectionStateChanged, (s: ConnectionState) => {
        if (!isCurrent()) return;
        if (s === ConnectionState.Connected) setStatus("connected");
        else if (s === ConnectionState.Reconnecting || s === ConnectionState.SignalReconnecting) setStatus("reconnecting");
        else if (s === ConnectionState.Connecting) setStatus("connecting");
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (!isCurrent()) return;
        roomRef.current = null;
        clearAudio();
        setStage(EMPTY_STAGE);
        setRemoteCount(0);
        setHasRemoteAudio(false);
        setEndReason(endReasonFrom(reason));
        setStatus("disconnected");
      })
      .on(RoomEvent.ParticipantConnected, sync)
      .on(RoomEvent.ParticipantDisconnected, sync)
      .on(RoomEvent.TrackPublished, sync)
      .on(RoomEvent.TrackUnpublished, sync)
      .on(RoomEvent.TrackMuted, sync)
      .on(RoomEvent.TrackUnmuted, sync)
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (!isCurrent()) return;
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach() as HTMLAudioElement;
          el.muted = !soundOnRef.current;
          audioBox().appendChild(el);
        }
        sync();
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) track.detach().forEach((el) => el.remove());
        sync();
      })
      .on(RoomEvent.ConnectionQualityChanged, (q: ConnectionQuality, p: Participant) => {
        if (isCurrent() && p.identity === room.localParticipant.identity) setQuality(q);
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (!isCurrent()) return;
        if (!room.canPlaybackAudio && soundOnRef.current) { soundOnRef.current = false; setSoundOn(false); }
      })
      .on(RoomEvent.VideoPlaybackStatusChanged, () => {
        if (isCurrent()) setVideoBlocked(!room.canPlaybackVideo);
      })
      .on(RoomEvent.Reconnected, () => {
        // Anything the host switched on while the connection was down goes out now
        if (opts.publish && isCurrent()) publishLocal(room).catch(() => {});
      })
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        // The browser's own "Stop sharing" button ends the screen track
        if (pub.source === Track.Source.ScreenShare && localRef.current.screen && pub.track === localRef.current.screen) commitLocal({ screen: null });
      });

    setStatus("connecting");
    setError(null);
    setEndReason(null);
    try {
      await room.connect(url, token, { autoSubscribe: true });
      if (!isCurrent()) { room.disconnect().catch(() => {}); return null; }
      if (opts.publish) await publishLocal(room);
      setStatus("connected");
      setQuality(room.localParticipant.connectionQuality);
      setVideoBlocked(!room.canPlaybackVideo);
      sync();
      return room;
    } catch (e: any) {
      if (roomRef.current === room) {
        roomRef.current = null;
        room.removeAllListeners();
        try { await room.disconnect(false); } catch { /* ignore */ }
        if (mountedRef.current) {
          setStatus("disconnected");
          setEndReason("network");
          setError(connectErrorText(e));
        }
      }
      throw e;
    }
  }, [teardown, sync, commitLocal]);

  /** Leave the room. Hosts ending the class pass stopLocal=true to turn the camera off too. */
  const disconnect = useCallback(async (stopLocal = false) => {
    await teardown(stopLocal);
    if (mountedRef.current) { setStatus("idle"); setEndReason("left"); }
  }, [teardown]);

  // ---------------------------------------------------------------- sound
  /** Call inside a tap/click: unmutes the class audio and resumes any paused video. */
  const enableSound = useCallback(async () => {
    soundOnRef.current = true;
    setSoundOn(true);
    audioBoxRef.current?.querySelectorAll("audio").forEach((a) => { a.muted = false; a.play().catch(() => {}); });
    const room = roomRef.current;
    try { await room?.startAudio(); } catch { /* still blocked: button stays */ }
    try { if (room && !room.canPlaybackVideo) await room.startVideo(); } catch { /* ignore */ }
    document.querySelectorAll<HTMLVideoElement>("video[data-lk]").forEach((v) => { if (v.paused) v.play().catch(() => {}); });
    setVideoBlocked(false);
  }, []);

  const muteSound = useCallback(() => {
    soundOnRef.current = false;
    setSoundOn(false);
    audioBoxRef.current?.querySelectorAll("audio").forEach((a) => { a.muted = true; });
  }, []);

  // ---------------------------------------------------------------- host devices
  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const usable = (k: MediaDeviceKind) => all.filter((d) => d.kind === k && d.deviceId);
      if (mountedRef.current) setDevices({ cameras: usable("videoinput"), mics: usable("audioinput") });
    } catch { /* no device access */ }
  }, []);

  useEffect(() => {
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md?.addEventListener) return;
    md.addEventListener("devicechange", refreshDevices);
    return () => md.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  const connected = () => roomRef.current && roomRef.current.state === ConnectionState.Connected ? roomRef.current : null;

  const rememberDevice = async (kind: "camera" | "mic", t: LocalTrack) => {
    try {
      const id = await t.getDeviceId();
      if (id) { deviceRef.current = { ...deviceRef.current, [kind]: id }; if (mountedRef.current) setDeviceIds(deviceRef.current); }
    } catch { /* ignore */ }
  };

  const videoOpts = () => ({ deviceId: deviceRef.current.camera || undefined, resolution: VideoPresets.h720.resolution });
  const audioOpts = () => ({ deviceId: deviceRef.current.mic || undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true });

  const adoptCamera = async (t: LocalVideoTrack) => {
    commitLocal({ camera: t });
    rememberDevice("camera", t);
    const room = connected();
    if (room) await room.localParticipant.publishTrack(t, { source: Track.Source.Camera, simulcast: true });
  };
  const adoptMic = async (t: LocalAudioTrack) => {
    commitLocal({ mic: t });
    setMicOn(true);
    rememberDevice("mic", t);
    const room = connected();
    if (room) await room.localParticipant.publishTrack(t, { source: Track.Source.Microphone });
  };

  /** Camera on = new track (published if live). Off = unpublished and stopped, so the camera light goes out. Returns an error text or null. */
  const setCamera = useCallback(async (on: boolean): Promise<string | null> => {
    let err: string | null = null;
    const cur = localRef.current.camera;
    if (on) {
      if (cur) return null;
      setMediaBusy(true);
      try { await adoptCamera(await createLocalVideoTrack(videoOpts())); } catch (e) { err = mediaErrorText(e, "camera"); }
      setMediaBusy(false);
    } else if (cur) {
      commitLocal({ camera: null });
      const room = connected();
      try { if (room) await room.localParticipant.unpublishTrack(cur, true); } catch { /* ignore */ }
      cur.stop();
    }
    if (mountedRef.current) setMediaError(err);
    return err;
  }, [commitLocal]); // adopt*/connected only use refs

  /** Mic toggles mute (instant); the first call creates the track. Returns an error text or null. */
  const setMic = useCallback(async (on: boolean): Promise<string | null> => {
    let err: string | null = null;
    const cur = localRef.current.mic;
    if (on) {
      if (cur) { await cur.unmute(); setMicOn(true); setMediaError(null); return null; }
      setMediaBusy(true);
      try { await adoptMic(await createLocalAudioTrack(audioOpts())); } catch (e) { err = mediaErrorText(e, "microphone"); }
      setMediaBusy(false);
    } else if (cur) {
      await cur.mute();
      setMicOn(false);
    }
    if (mountedRef.current) setMediaError(err);
    return err;
  }, [commitLocal]);

  const stopScreenTracks = async (video: LocalVideoTrack, audio: LocalAudioTrack | null) => {
    if (localRef.current.screen === video) commitLocal({ screen: null, screenAudio: null });
    const room = connected();
    for (const t of [video, audio]) {
      if (!t) continue;
      try { if (room) await room.localParticipant.unpublishTrack(t, true); } catch { /* ignore */ }
      try { t.stop(); } catch { /* ignore */ }
    }
  };

  const setScreen = useCallback(async (on: boolean): Promise<string | null> => {
    let err: string | null = null;
    const cur = localRef.current.screen;
    if (on) {
      if (cur) return null;
      try {
        const tracks = await createLocalScreenTracks({ audio: true, resolution: { width: 1920, height: 1080, frameRate: 15 }, contentHint: "detail", selfBrowserSurface: "exclude", surfaceSwitching: "include" });
        const video = tracks.find((t) => t.kind === Track.Kind.Video) as LocalVideoTrack | undefined;
        const audio = (tracks.find((t) => t.kind === Track.Kind.Audio) as LocalAudioTrack | undefined) || null;
        if (video) {
          commitLocal({ screen: video, screenAudio: audio });
          // The browser's own "Stop sharing" button ends the track
          video.on(TrackEvent.Ended, () => { void stopScreenTracks(video, audio); });
          const room = connected();
          if (room) {
            await room.localParticipant.publishTrack(video, { source: Track.Source.ScreenShare });
            if (audio) await room.localParticipant.publishTrack(audio, { source: Track.Source.ScreenShareAudio });
          }
        }
      } catch (e) { err = mediaErrorText(e, "screen"); }
    } else if (cur) {
      await stopScreenTracks(cur, localRef.current.screenAudio);
    }
    if (mountedRef.current) setMediaError(err);
    return err;
  }, [commitLocal]);

  /** Asks for camera + mic in one permission prompt, then lists devices with their names. */
  const startPreview = useCallback(async () => {
    setMediaBusy(true);
    let err: string | null = null;
    const l = localRef.current;
    if (!l.camera && !l.mic) {
      try {
        const tracks = await createLocalTracks({ video: videoOpts(), audio: audioOpts() });
        for (const t of tracks) {
          if (t.kind === Track.Kind.Video) await adoptCamera(t as LocalVideoTrack);
          else await adoptMic(t as LocalAudioTrack);
        }
      } catch {
        // One of them failed (no camera, blocked mic…): try each alone so whatever works still works
        const e1 = await setCamera(true);
        const e2 = await setMic(true);
        err = e1 && e2 ? "Your camera and microphone are blocked or missing. Allow access in the browser's address bar (or app settings), then try again." : e1 || e2;
      }
    } else {
      const e1 = await setCamera(true);
      const e2 = await setMic(true);
      err = e1 || e2;
    }
    await refreshDevices();
    if (mountedRef.current) { setMediaError(err); setMediaBusy(false); }
  }, [setCamera, setMic, refreshDevices]); // adopt* only use refs

  const chooseDevice = useCallback(async (kind: "camera" | "mic", id: string) => {
    deviceRef.current = { ...deviceRef.current, [kind]: id };
    setDeviceIds(deviceRef.current);
    const t = kind === "camera" ? localRef.current.camera : localRef.current.mic;
    if (t) {
      try { await t.setDeviceId(id); } catch (e) { setMediaError(mediaErrorText(e, kind === "camera" ? "camera" : "microphone")); }
    }
  }, []);

  // Leave the room and release devices when the page goes away
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const room = roomRef.current;
      roomRef.current = null;
      if (room) { room.removeAllListeners(); room.disconnect(true).catch(() => {}); }
      const l = localRef.current;
      [l.camera, l.mic, l.screen, l.screenAudio].forEach((t) => { try { t?.stop(); } catch { /* ignore */ } });
      localRef.current = { camera: null, mic: null, screen: null, screenAudio: null };
      clearAudio();
    };
  }, []);

  return {
    // connection
    status, error, endReason, connect, disconnect,
    /** Other people in the room (viewer count = remoteCount + 1 for viewers) */
    remoteCount,
    quality,
    // viewing
    stage, hasRemoteAudio, soundOn, enableSound, muteSound, videoBlocked,
    // hosting
    local, cameraOn: !!local.camera, micOn: !!local.mic && micOn, screenOn: !!local.screen,
    setCamera, setMic, setScreen, startPreview, stopLocal: stopLocalTracks,
    devices, deviceIds, chooseDevice, refreshDevices, mediaError, mediaBusy,
    room: roomRef
  };
}

export type LiveRoom = ReturnType<typeof useLiveRoom>;
