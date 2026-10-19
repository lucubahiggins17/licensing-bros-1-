"use client";
// /live/studio/?id= (admins): preview camera/mic/screen, go live, push calls to action, chat as host, end the class.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ExternalLink, Video, VideoOff, Mic, MicOff, MonitorUp, MonitorX, Radio, Square, Shield, Copy, Check,
  Loader2, Camera, Link2, TriangleAlert, Clapperboard, Save, LogIn
} from "lucide-react";
import { createAudioAnalyser, type LocalAudioTrack } from "livekit-client";
import AppShell from "@/components/shell/AppShell";
import { callFn } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { routes, useQueryParam } from "@/lib/nav";
import { supabase } from "@/lib/supabaseClient";
import type { LiveAccess, LivePrivate } from "@/lib/types";
import { useLiveRoom, screenShareSupported } from "@/components/live/useLiveRoom";
import { useLiveRow, useNow } from "@/components/live/useLiveData";
import { QualityChip, Stage, StageMessage } from "@/components/live/LiveBits";
import LiveChat from "@/components/live/LiveChat";
import CtaConsole from "@/components/live/CtaConsole";
import { copyText, elapsedText, fmtWhen, isHttpUrl, toPlayable } from "@/components/live/liveUtils";
import s from "./live.module.css";
import st from "./Studio.module.css";

const sinceKey = (id: string) => `lb.live.since.${id}`;
const readSince = (id: string) => { try { const v = Number(localStorage.getItem(sinceKey(id))); return v > 0 ? v : null; } catch { return null; } };
const writeSince = (id: string, t: number | null) => { try { t ? localStorage.setItem(sinceKey(id), String(t)) : localStorage.removeItem(sinceKey(id)); } catch { /* storage blocked */ } };

function hostErrorText(e: any): string {
  switch (e?.code) {
    case "not_configured": return "Live video isn't set up yet. Add LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in Supabase (Edge Functions → Secrets), then try again.";
    case "forbidden": return "Only admins and instructors can host a class.";
    case "signed_out": return "Your sign-in expired. Sign in again, then go live.";
    case "offline": return "You're offline. Check your connection and try again.";
    case "not_found": return "This class no longer exists.";
  }
  return e?.message ? `Couldn't go live: ${e.message}` : "Couldn't go live. Try again.";
}

export default function StudioPage() {
  const id = useQueryParam("id");
  const { ready, user, account } = useAuth();
  const isAdmin = !!(account?.is_admin || account?.is_staff); // admins and instructors host classes
  const { live, setLive, missing, error: rowError, reload } = useLiveRow(isAdmin ? id : null);
  const lk = useLiveRoom();

  const [priv, setPriv] = useState<LivePrivate | null>(null);
  const [busy, setBusy] = useState<null | "starting" | "ending">(null);
  const [err, setErr] = useState("");
  const [warn, setWarn] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [since, setSince] = useState<number | null>(null);
  const [previewWarn, setPreviewWarn] = useState(false);
  const [copied, setCopied] = useState(false);
  const [replayUrl, setReplayUrl] = useState("");
  const [replayMsg, setReplayMsg] = useState("");
  const [savingReplay, setSavingReplay] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const endBtnRef = useRef<HTMLButtonElement>(null);

  const onAir = live?.status === "live";
  const ended = live?.status === "ended";
  const isLiveKit = live?.provider !== "embed";
  const hostConnected = lk.status === "connected" || lk.status === "reconnecting";
  const now = useNow(1000, onAir);

  useEffect(() => setCanShare(screenShareSupported()), []);

  // Protected links (stream + replay)
  useEffect(() => {
    if (!id || !isAdmin) return;
    supabase().from("live_private").select("*").eq("live_id", id).maybeSingle().then(({ data }) => {
      setPriv((data as LivePrivate) || null);
      setReplayUrl((data as LivePrivate)?.replay_url || "");
    });
  }, [id, isAdmin]);

  // Elapsed time survives a page reload
  useEffect(() => {
    if (!live || live.status !== "live") { setSince(null); return; }
    setSince((prev) => prev ?? readSince(live.id) ?? Math.min(Date.now(), new Date(live.starts_at).getTime()));
  }, [live?.status, live?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Don't close the tab by accident while broadcasting
  useEffect(() => {
    if (!(onAir && hostConnected)) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [onAir, hostConnected]);

  useEffect(() => { if (confirmEnd) endBtnRef.current?.focus(); }, [confirmEnd]);

  async function goLive() {
    if (!live || !user) return;
    setErr(""); setWarn(""); setBusy("starting");
    const wasLive = live.status === "live";
    try {
      if (isLiveKit) {
        const a = await callFn<LiveAccess>("live-token", { live_id: live.id, role: "host" });
        if (a.mode !== "livekit") throw new Error("the server didn't send a video pass. Check this class's settings in Admin.");
        await lk.connect(a.url, a.token, { publish: true });
      }
      if (!wasLive || live.host_id !== user.id) {
        const { error } = await supabase().from("lives").update({ status: "live", host_id: user.id }).eq("id", live.id);
        if (error) throw new Error(`the class couldn't be marked live (${error.message}).`);
        setLive((l) => (l ? { ...l, status: "live", host_id: user.id } : l));
      }
      if (!wasLive) {
        const t = Date.now();
        setSince(t);
        writeSince(live.id, t);
        const { error: nErr } = await supabase().from("notifications").insert({
          user_id: null,
          title: `Live now: ${live.title}`,
          body: (live.description || "Tap to join the class.").slice(0, 160),
          link: routes.watch(live.id)
        });
        if (nErr) setWarn("You're live, but the “Live now” notification didn't send.");
      }
    } catch (e: any) {
      if (isLiveKit) await lk.disconnect(false);
      setErr(hostErrorText(e));
    }
    setBusy(null);
  }

  async function endClass() {
    if (!live) return;
    setErr(""); setBusy("ending");
    // Mark ended first so students flip to "class ended" instantly, then hang up
    const { error } = await supabase().from("lives").update({ status: "ended" }).eq("id", live.id);
    if (error) { setErr("Couldn't end the class. Try again."); setBusy(null); return; }
    setLive((l) => (l ? { ...l, status: "ended" } : l));
    if (isLiveKit) await lk.disconnect(true);
    writeSince(live.id, null);
    setConfirmEnd(false);
    setBusy(null);
  }

  async function saveReplay(e: React.FormEvent) {
    e.preventDefault();
    if (!live) return;
    const v = replayUrl.trim();
    if (v && !isHttpUrl(v)) { setReplayMsg("Enter a full link that starts with https://"); return; }
    setSavingReplay(true); setReplayMsg("");
    const { data, error } = await supabase().from("live_private").upsert({ live_id: live.id, replay_url: v || null }, { onConflict: "live_id" }).select().maybeSingle();
    setSavingReplay(false);
    if (error) { setReplayMsg("Couldn't save the replay link. Try again."); return; }
    setPriv((data as LivePrivate) || priv);
    setReplayMsg(v ? "Saved. Students can watch the replay now." : "Replay link removed.");
  }

  // ------------------------------------------------------------------ gates
  if (id === undefined || !ready) return <Shell><div className={st.center}><span className="spin" aria-hidden="true" /> Loading the studio…</div></Shell>;
  if (!user) {
    return (
      <Shell>
        <div className={`plate ${st.gate}`}>
          <LogIn className={st.gateIcon} aria-hidden="true" />
          <h1>Sign in to host</h1>
          <p>The live studio is for instructors.</p>
          <Link className="btn primary" href={routes.login(undefined, id ? routes.studio(id) : routes.lives)}>Sign in</Link>
          <span className="bolts" />
        </div>
      </Shell>
    );
  }
  if (!isAdmin) {
    return (
      <Shell>
        <div className={`plate ${st.gate}`}>
          <Shield className={st.gateIcon} aria-hidden="true" />
          <h1>Admins only</h1>
          <p>The live studio is for instructors. Looking for the class itself?</p>
          <Link className="btn primary" href={id ? routes.watch(id) : routes.lives}>Go to the class</Link>
          <span className="bolts" />
        </div>
      </Shell>
    );
  }
  if (!id || missing || (!live && rowError)) {
    return (
      <Shell>
        <div className={`plate ${st.gate}`}>
          <TriangleAlert className={st.gateIcon} aria-hidden="true" />
          <h1>{rowError && !missing ? "Couldn't load the class" : "Class not found"}</h1>
          <p>{rowError && !missing ? rowError : "Pick a class from Admin → Lives."}</p>
          <div className="row" style={{ justifyContent: "center" }}>
            {rowError && !missing && <button className="btn" onClick={reload}>Try again</button>}
            <Link className="btn primary" href={routes.admin("lives")}>Admin · Lives</Link>
          </div>
          <span className="bolts" />
        </div>
      </Shell>
    );
  }
  if (!live) return <Shell><div className={st.center}><span className="spin" aria-hidden="true" /> Loading the class…</div></Shell>;

  // ------------------------------------------------------------------ stage
  const embedPlayable = !isLiveKit ? toPlayable(priv?.embed_url, { autoplay: false }) : null;
  const localTracks = !!(lk.local.camera || lk.local.screen);
  const stage = isLiveKit ? (
    <Stage
      screen={lk.local.screen}
      camera={lk.local.camera}
      mirrorCamera
      className={localTracks ? "" : s.stageAuto}
      empty={
        <StageMessage icon={<Camera />} title={lk.local.mic ? "Camera is off" : "Set up your camera"}>
          {lk.local.mic ? "Students hear you but see the “getting ready” screen until you turn a camera or screen share on." : "Check how you look and sound before you go live."}
          {!lk.local.camera && (
            <div className={st.msgActions}>
              <button className="btn primary cta" onClick={() => (lk.local.mic ? lk.setCamera(true) : lk.startPreview())} disabled={lk.mediaBusy}>
                {lk.mediaBusy ? <><Loader2 className={st.spinIcon} aria-hidden="true" /> Starting…</> : <><Video aria-hidden="true" /> {lk.local.mic ? "Turn camera on" : "Turn on camera & mic"}</>}
              </button>
            </div>
          )}
        </StageMessage>
      }
    >
      <div className={s.topLeft}>
        {onAir && hostConnected ? <span className="badge live">On air</span> : <span className={s.chipDark}>Preview</span>}
        {hostConnected && <span className={s.chipDark}>{lk.remoteCount} watching</span>}
      </div>
      {lk.status === "reconnecting" && <div className={s.banner} role="status"><Loader2 size={15} className={st.spinIcon} aria-hidden="true" /> Reconnecting…</div>}
    </Stage>
  ) : (
    <div className={`${s.stage}${embedPlayable ? "" : ` ${s.stageAuto}`}`}>
      {embedPlayable?.kind === "iframe" ? (
        <iframe className={s.embed} src={embedPlayable.src} title={`${live.title} stream preview`} allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen />
      ) : embedPlayable?.kind === "video" ? (
        <video className={s.mainVideo} src={embedPlayable.src} controls playsInline muted />
      ) : (
        <StageMessage icon={<Link2 />} title="No stream link yet">
          Add the YouTube Live, Vimeo or StreamYard link for this class in Admin → Lives.
          <div className={st.msgActions}><Link className="btn primary" href={routes.admin("lives")}>Open Admin · Lives</Link></div>
        </StageMessage>
      )}
      <div className={s.topLeft}>{onAir ? <span className="badge live">On air</span> : <span className={s.chipDark}>Preview</span>}</div>
    </div>
  );

  // ------------------------------------------------------------------ page
  return (
    <Shell wide>
      <section className={st.band}>
        <div className="wrap">
          <div className={st.bandTop}>
            <Link href={routes.admin("lives")} className={st.back}><ArrowLeft size={16} aria-hidden="true" /> Admin · Lives</Link>
            {hostConnected ? (
              <button type="button" className={`btn sm ${st.bandBtn}`} onClick={() => setPreviewWarn((v) => !v)} aria-expanded={previewWarn}>
                Preview as student <ExternalLink aria-hidden="true" />
              </button>
            ) : (
              <Link className={`btn sm ${st.bandBtn}`} href={routes.watch(live.id)} target="_blank">Preview as student <ExternalLink aria-hidden="true" /></Link>
            )}
          </div>
          {previewWarn && hostConnected && (
            <div className={st.previewWarn} role="note">
              <TriangleAlert size={16} aria-hidden="true" />
              <span>One connection per account: opening the student view from <b>this</b> account while you&rsquo;re on air will bump your broadcast. Use another account or device to check what students see.</span>
              <Link className="btn sm" href={routes.watch(live.id)} target="_blank" onClick={() => setPreviewWarn(false)}>Open anyway</Link>
            </div>
          )}
          <span className={`eyebrow ${st.bandEyebrow}`}><Radio size={13} aria-hidden="true" /> Live studio · {isLiveKit ? "Built-in video" : "Stream link"}</span>
          <h1 className={st.title}>{live.title}</h1>
          <dl className={st.stats}>
            <div><dt>Status</dt><dd>{onAir ? <span className="badge live">On air</span> : ended ? <span className="badge">Ended</span> : <span className="badge warn">Not live</span>}</dd></div>
            <div><dt>Elapsed</dt><dd className={s.tabular}>{onAir && since ? elapsedText(now - since) : "—"}</dd></div>
            {isLiveKit && <div><dt>Watching</dt><dd className={s.tabular}>{hostConnected ? lk.remoteCount : "—"}</dd></div>}
            {isLiveKit && <div><dt>Connection</dt><dd>{hostConnected ? <QualityChip quality={lk.quality} dark /> : "—"}</dd></div>}
            <div><dt>Scheduled</dt><dd>{fmtWhen(live.starts_at)}</dd></div>
          </dl>
        </div>
        <div className="hazard thin" />
      </section>

      <div className={`wrap ${st.layout}`}>
        <div className={st.stageArea}>
          <div className={s.stageWrap}>{stage}</div>
        </div>

        <div className={st.controlsArea}>
          {isLiveKit && (
            <section className={st.panel} aria-label="Camera and microphone">
              <div className={st.toggles}>
                <button type="button" className={st.toggle} aria-pressed={lk.cameraOn} onClick={() => lk.setCamera(!lk.cameraOn)} disabled={lk.mediaBusy}>
                  {lk.cameraOn ? <Video aria-hidden="true" /> : <VideoOff aria-hidden="true" />}<span>{lk.cameraOn ? "Camera on" : "Camera off"}</span>
                </button>
                <button type="button" className={st.toggle} aria-pressed={lk.micOn} onClick={() => lk.setMic(!lk.micOn)} disabled={lk.mediaBusy}>
                  {lk.micOn ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}<span>{lk.micOn ? "Mic on" : "Mic off"}</span>
                  {lk.micOn && lk.local.mic && <MicMeter track={lk.local.mic} />}
                </button>
                {canShare && (
                  <button type="button" className={st.toggle} aria-pressed={lk.screenOn} onClick={() => lk.setScreen(!lk.screenOn)}>
                    {lk.screenOn ? <MonitorX aria-hidden="true" /> : <MonitorUp aria-hidden="true" />}<span>{lk.screenOn ? "Stop sharing" : "Share screen"}</span>
                  </button>
                )}
              </div>
              <div className={st.devices}>
                <label className="field">
                  <span>Camera</span>
                  <select value={lk.deviceIds.camera} onChange={(e) => lk.chooseDevice("camera", e.target.value)} disabled={!lk.devices.cameras.length}>
                    {!lk.devices.cameras.length && <option value="">Turn your camera on to pick one</option>}
                    {lk.devices.cameras.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Microphone</span>
                  <select value={lk.deviceIds.mic} onChange={(e) => lk.chooseDevice("mic", e.target.value)} disabled={!lk.devices.mics.length}>
                    {!lk.devices.mics.length && <option value="">Turn your mic on to pick one</option>}
                    {lk.devices.mics.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
                  </select>
                </label>
              </div>
              {!canShare && <p className="note" style={{ margin: 0 }}>Screen sharing works from Chrome or Edge on a computer.</p>}
              {lk.mediaError && <p className="err" role="alert" style={{ margin: 0 }}>{lk.mediaError}</p>}
            </section>
          )}

          {!isLiveKit && (
            <section className={st.panel} aria-label="Stream link">
              <span className="label">Stream link students see</span>
              {priv?.embed_url ? (
                <div className={st.linkBox}>
                  <code>{priv.embed_url}</code>
                  <button type="button" className="btn sm" onClick={async () => { if (await copyText(priv.embed_url || "")) { setCopied(true); setTimeout(() => setCopied(false), 2000); } }}>
                    {copied ? <><Check aria-hidden="true" /> Copied</> : <><Copy aria-hidden="true" /> Copy</>}
                  </button>
                  <a className="btn sm" href={priv.embed_url} target="_blank" rel="noopener noreferrer">Open <ExternalLink aria-hidden="true" /></a>
                </div>
              ) : (
                <p className="note" style={{ margin: 0 }}>No link yet. Students will see &ldquo;the stream link isn&rsquo;t ready&rdquo; until you add it in <Link href={routes.admin("lives")}>Admin → Lives</Link>.</p>
              )}
              <p className="note" style={{ margin: 0 }}>Start the stream in YouTube/Vimeo/StreamYard first, then press Go live here so students get notified.</p>
            </section>
          )}

          {/* Go live / End */}
          <section className={`${st.panel} ${st.goPanel}`} aria-label="Broadcast">
            {!onAir ? (
              <>
                <button type="button" className={`btn primary cta big ${st.goBtn}`} onClick={goLive} disabled={!!busy}>
                  {busy === "starting" ? <><Loader2 className={st.spinIcon} aria-hidden="true" /> Going live…</> : <><Radio aria-hidden="true" /> {ended ? "Go live again" : "Go live"}</>}
                </button>
                <p className="note" style={{ margin: 0 }}>
                  Everyone gets a &ldquo;Live now&rdquo; notification.
                  {isLiveKit && !lk.cameraOn && !lk.screenOn && " Your camera is off, so students will see “The host is getting ready” until you turn it on."}
                  {isLiveKit && !lk.micOn && " Your mic is off."}
                </p>
              </>
            ) : isLiveKit && !hostConnected ? (
              <>
                <button type="button" className={`btn primary cta big ${st.goBtn}`} onClick={goLive} disabled={!!busy}>
                  {busy === "starting" ? <><Loader2 className={st.spinIcon} aria-hidden="true" /> Joining…</> : <><Radio aria-hidden="true" /> Rejoin as host</>}
                </button>
                <p className="note" style={{ margin: 0 }}>The class is still on air, but you&rsquo;re not broadcasting from this page.{lk.endReason === "duplicate" ? " You opened this class in another tab or device." : ""}</p>
              </>
            ) : (
              <p className={st.liveNote}><span className="badge live">On air</span> Closing this page pauses your video; the class stays live until you end it.</p>
            )}

            {onAir && !confirmEnd && (
              <button type="button" className={`btn danger ${st.endBtn}`} onClick={() => setConfirmEnd(true)} disabled={!!busy}>
                <Square aria-hidden="true" /> End class
              </button>
            )}
            {onAir && confirmEnd && (
              <div className={st.confirm} role="alertdialog" aria-labelledby="end-q">
                <p id="end-q"><b>End the class for everyone?</b> Students&rsquo; video stops and chat closes.</p>
                <div className="row">
                  <button ref={endBtnRef} type="button" className={`btn ${st.endYes}`} onClick={endClass} disabled={busy === "ending"}>
                    {busy === "ending" ? "Ending…" : "Yes, end class"}
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirmEnd(false)} disabled={busy === "ending"}>Keep going</button>
                </div>
              </div>
            )}
            {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
            {warn && <p className="note" role="status" style={{ margin: 0, color: "var(--warn)" }}>{warn}</p>}
          </section>

          {ended && (
            <form className={st.panel} onSubmit={saveReplay} aria-label="Replay">
              <div className="row" style={{ gap: 8 }}><Clapperboard size={18} color="var(--orange)" aria-hidden="true" /><b className={st.panelTitle}>Class ended: add the replay</b></div>
              <label className="field">
                <span>Replay link</span>
                <input value={replayUrl} onChange={(e) => setReplayUrl(e.target.value)} placeholder="YouTube, Vimeo or .mp4 link" inputMode="url" />
                <span className="hint">Students who open this class later watch this recording.</span>
              </label>
              <div className="row">
                <button type="submit" className="btn navy" disabled={savingReplay || replayUrl.trim() === (priv?.replay_url || "")}><Save aria-hidden="true" /> {savingReplay ? "Saving…" : "Save replay"}</button>
                {replayMsg && <span className="note" role="status">{replayMsg}</span>}
              </div>
            </form>
          )}
        </div>

        <div className={st.chatArea}>
          <LiveChat liveId={live.id} isHost title="Class chat" className={st.chat} />
        </div>

        <div className={st.consoleArea}>
          <CtaConsole liveId={live.id} />
        </div>
      </div>
    </Shell>
  );
}

/** Small live level bar so the host can see the mic is picking them up */
function MicMeter({ track }: { track: LocalAudioTrack }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    let a: ReturnType<typeof createAudioAnalyser> | null = null;
    try { a = createAudioAnalyser(track, { cloneTrack: true }); } catch { return; }
    const t = setInterval(() => { try { setLevel(a!.calculateVolume()); } catch { /* ignore */ } }, 120);
    return () => { clearInterval(t); a?.cleanup().catch(() => {}); };
  }, [track]);
  return <span className={st.meter} aria-hidden="true"><i style={{ transform: `scaleX(${Math.min(1, level * 2.5)})` }} /></span>;
}

function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <AppShell active="live" blueprint>
      {wide ? <main className={st.main}>{children}</main> : <main className={`wrap ${st.main}`}>{children}</main>}
    </AppShell>
  );
}
