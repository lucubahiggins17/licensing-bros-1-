// Access to a live class: LiveKit token, embed link, replay or "waiting" until it starts.
import { adminClient, handler, HttpError, isAdmin, isUuid, json, readBody, requirePaidAccess, requireUser } from "../_shared/common.ts";
import { livekitEnv, signLiveKitToken } from "../_shared/livekit.ts";

Deno.serve(handler(async (req) => {
  const { user } = await requireUser(req);
  const body = await readBody(req);
  if (!isUuid(body.live_id)) throw new HttpError(400, "bad_request", "Pick a live class first.");
  const role: "host" | "viewer" = body.role === "host" ? "host" : "viewer";
  const db = adminClient();

  const [{ data: live }, admin] = await Promise.all([
    db.from("lives").select("*").eq("id", body.live_id).maybeSingle(),
    isAdmin(user.id)
  ]);
  if (!live) throw new HttpError(404, "not_found", "That live class isn't available.");

  if (role === "host") {
    if (!admin) throw new HttpError(403, "forbidden", "Only the host can open the studio.");
  } else {
    const { data: allowed, error } = await db.rpc("can_view_live", { p_live: live.id, p_user: user.id });
    if (error) throw new HttpError(500, "server_error", "Couldn't check your access. Try again.");
    if (!allowed) {
      if (live.course_id) throw new HttpError(403, "not_enrolled", "This live class is for students of its course. Get the course to join.", { course_id: live.course_id });
      throw new HttpError(402, "upgrade_required", "This live class comes with any paid course.");
    }
    if (!live.is_free && !admin) await requirePaidAccess(req, user.id, false);
  }

  const isHost = role === "host";
  const { data: priv } = await db.from("live_private").select("embed_url, replay_url").eq("live_id", live.id).maybeSingle();
  const waiting = (extra: Record<string, unknown> = {}) => json({ mode: "waiting", starts_at: live.starts_at, ...extra });

  if (live.status === "ended" && !(isHost && live.provider === "livekit")) {
    if (priv?.replay_url) return json({ mode: "replay", replay_url: priv.replay_url });
    return waiting({ ended: true, message: "This class has ended. The replay isn't posted yet." });
  }

  if (live.provider === "embed") {
    if (live.status !== "live" && !isHost) return waiting();
    if (!priv?.embed_url) return waiting({ message: "The stream link isn't ready yet. Check back in a moment." });
    return json({ mode: "embed", embed_url: priv.embed_url });
  }

  // LiveKit
  if (live.status !== "live" && !isHost) return waiting();
  const env = livekitEnv();
  if (!env) throw new HttpError(503, "not_configured", "Live video isn't set up yet. Add the LiveKit keys in Supabase to go live.");
  const { data: profile } = await db.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const name = (profile?.full_name || user.email?.split("@")[0] || "Student").slice(0, 60);
  const token = await signLiveKitToken({
    apiKey: env.apiKey,
    apiSecret: env.apiSecret,
    identity: isHost ? `host-${user.id}` : user.id, // distinct identities so an admin can preview as a student while on air
    name,
    room: live.room_name,
    canPublish: isHost,
    metadata: JSON.stringify({ role })
  });
  return json({ mode: "livekit", url: env.url, token, identity: isHost ? `host-${user.id}` : user.id, role });
}));
