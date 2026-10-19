// One device at a time + home location (Netflix-style).
// Actions: claim, heartbeat, release, status, set_home, set_away, end_away.
import {
  adminClient,
  canChangeHomeAfter,
  claimDecision,
  clampInt,
  clientIp,
  conflictOf,
  evaluateLocation,
  geolocate,
  getSessionRow,
  getSettings,
  handler,
  hasHome,
  HttpError,
  isAdmin,
  isUuid,
  json,
  loadLocationRecord,
  locationDecision,
  type LocationInfo,
  type LocationRecord,
  type LocationRules,
  markGeo,
  nextAwayPassAt,
  readBody,
  recentAwayPasses,
  recentOtp,
  requireUser,
  rowGeo,
  type SessionRow
} from "../_shared/common.ts";

const OTP_MINUTES = 15;
const OTP_MESSAGE = "For your security, enter the 6-digit code we just emailed you first.";
const UNKNOWN_MESSAGE = "We couldn't tell where you are right now. Try again in a minute.";

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

Deno.serve(handler(async (req) => {
  const { user, jwtPayload } = await requireUser(req);
  const body = await readBody(req);
  const action = String(body.action || "");
  const db = adminClient();
  const [settings, admin] = await Promise.all([getSettings(), isAdmin(user.id)]);
  const rules: LocationRules = settings.location_rules;
  const now = new Date();
  const sid = isUuid(body.session_id) ? body.session_id : (isUuid(req.headers.get("x-session-id")) ? req.headers.get("x-session-id") : null);

  /** Location for the current row without new lookups (used by status and the travel actions). */
  const locationFor = (rec: LocationRecord | null, row: SessionRow | null): LocationInfo =>
    locationDecision(rec, rowGeo(row), rules, now, { admin });

  /** After home/away changes: store the new location_ok on this account's session row. */
  const syncOk = async (info: LocationInfo) => {
    await db.from("active_sessions").update({ location_ok: info.ok }).eq("user_id", user.id);
  };

  switch (action) {
    // ---------------------------------------------------------------------------------------
    case "claim": {
      const device = String(body.device || "Unknown device").replace(/\s+/g, " ").trim().slice(0, 120) || "Unknown device";
      const existing = await getSessionRow(user.id);
      const decision = claimDecision(existing, sid, body.takeover === true, now, rules.session_timeout_seconds);
      if (decision.action === "conflict") return json({ status: "in_use", conflict: decision.conflict });

      const ip = clientIp(req);
      markGeo(user.id);
      const geo = await geolocate(ip);
      const sessionId = decision.action === "resume" ? existing!.session_id : crypto.randomUUID();
      const row: SessionRow & { user_id: string } = {
        user_id: user.id,
        session_id: sessionId,
        device,
        ip,
        city: geo?.city ?? null,
        region: geo?.region ?? null,
        country: geo?.country ?? null,
        lat: geo?.lat ?? null,
        lon: geo?.lon ?? null,
        location_ok: true,
        started_at: decision.action === "resume" && existing?.started_at ? existing.started_at : now.toISOString(),
        last_seen: now.toISOString()
      };
      // evaluateLocation sets the home automatically on the first known location
      const { error } = await db.from("active_sessions").upsert(row, { onConflict: "user_id" });
      if (error) throw new HttpError(500, "server_error", "Couldn't check in this device. Try again.");
      const location = await evaluateLocation(req, user.id, row, rules, admin);

      if (decision.action === "takeover") {
        const where = geo?.city ? ` in ${geo.city}${geo.region ? `, ${geo.region}` : ""}` : "";
        await db.from("notifications").insert({
          user_id: user.id,
          title: `Your account was opened on ${device}${where}`,
          body: `${decision.previous.device} was signed out. If this wasn't you, change your password.`,
          link: "/account/#devices"
        });
      }
      return json({ status: "ok", session_id: sessionId, location });
    }

    // ---------------------------------------------------------------------------------------
    case "heartbeat": {
      if (!sid) throw new HttpError(400, "bad_request", "Missing device session.");
      const row = await getSessionRow(user.id);
      if (row && row.session_id !== sid) return json({ status: "replaced", conflict: conflictOf(row) });
      if (!row) {
        // Nobody else holds the account (e.g. an admin reset this device): quietly check back in.
        const ip = clientIp(req);
        const fresh: SessionRow & { user_id: string } = {
          user_id: user.id, session_id: sid, device: String(body.device || "This device").slice(0, 120), ip: null,
          city: null, region: null, country: null, lat: null, lon: null, location_ok: true,
          started_at: now.toISOString(), last_seen: now.toISOString()
        };
        const { error } = await db.from("active_sessions").insert(fresh);
        if (error) {
          // Another device claimed in the meantime
          const other = await getSessionRow(user.id);
          if (other && other.session_id !== sid) return json({ status: "replaced", conflict: conflictOf(other) });
        }
        const location = await evaluateLocation(req, user.id, fresh, rules, admin, { forceGeo: !!ip });
        return json({ status: "ok", location });
      }
      await db.from("active_sessions").update({ last_seen: now.toISOString() }).eq("user_id", user.id).eq("session_id", sid);
      const location = await evaluateLocation(req, user.id, row, rules, admin);
      return json({ status: "ok", location });
    }

    // ---------------------------------------------------------------------------------------
    case "release": {
      if (sid) await db.from("active_sessions").delete().eq("user_id", user.id).eq("session_id", sid);
      return json({ status: "released" });
    }

    // ---------------------------------------------------------------------------------------
    case "status": {
      const [row, rec] = await Promise.all([getSessionRow(user.id), loadLocationRecord(user.id)]);
      const location = locationFor(rec, row && row.session_id === sid ? row : null);
      return json({
        session: row ? {
          device: row.device, city: row.city, region: row.region, started_at: row.started_at ?? null,
          last_seen: row.last_seen, current: !!sid && row.session_id === sid
        } : null,
        location,
        rules: {
          enforce: rules.enforce, home_radius_miles: rules.home_radius_miles, home_change_days: rules.home_change_days,
          away_max_days: rules.away_max_days, away_default_days: rules.away_default_days,
          away_passes_per_90_days: rules.away_passes_per_90_days, session_timeout_seconds: rules.session_timeout_seconds
        }
      });
    }

    // ---------------------------------------------------------------------------------------
    case "set_home": {
      const rec = await loadLocationRecord(user.id);
      if (hasHome(rec)) {
        if (!admin && !recentOtp(jwtPayload, OTP_MINUTES, now)) throw new HttpError(403, "otp_required", OTP_MESSAGE);
        const after = canChangeHomeAfter(rec, rules, now);
        if (after && !admin) {
          throw new HttpError(429, "home_change_too_soon", `You can move your home area again on ${fmtDate(after)}. Use Travel mode until then.`, { can_change_home_after: after });
        }
      }
      markGeo(user.id);
      const geo = await geolocate(clientIp(req));
      if (!geo) throw new HttpError(400, "location_unknown", UNKNOWN_MESSAGE);
      const { data, error } = await db.from("account_locations").upsert({
        user_id: user.id, home_lat: geo.lat, home_lon: geo.lon, home_city: geo.city, home_region: geo.region,
        home_country: geo.country, home_set_at: now.toISOString()
      }, { onConflict: "user_id" }).select("*").single();
      if (error) throw new HttpError(500, "server_error", "Couldn't save your home area. Try again.");
      await db.from("active_sessions").update({
        ip: clientIp(req), city: geo.city, region: geo.region, country: geo.country, lat: geo.lat, lon: geo.lon
      }).eq("user_id", user.id);
      const location = locationDecision(data as LocationRecord, geo, rules, now, { admin });
      await syncOk(location);
      return json({ location });
    }

    // ---------------------------------------------------------------------------------------
    case "set_away": {
      if (!admin && !recentOtp(jwtPayload, OTP_MINUTES, now)) throw new HttpError(403, "otp_required", OTP_MESSAGE);
      const raw = body.days === undefined || body.days === null ? rules.away_default_days : Number(body.days);
      if (!Number.isFinite(raw) || raw < 1 || raw > rules.away_max_days) {
        throw new HttpError(400, "bad_request", `Pick between 1 and ${rules.away_max_days} days.`);
      }
      const days = clampInt(raw, 1, rules.away_max_days, rules.away_default_days);
      const rec = await loadLocationRecord(user.id);
      const used = recentAwayPasses(rec, now);
      if (!admin && used.length >= rules.away_passes_per_90_days) {
        const next = nextAwayPassAt(rec, rules, now);
        throw new HttpError(429, "no_passes_left",
          `You've used all ${rules.away_passes_per_90_days} Travel passes for the last 90 days.${next ? ` Your next one opens up on ${fmtDate(next)}.` : ""}`,
          { next_pass_at: next, away_passes_left: 0 });
      }
      markGeo(user.id);
      const geo = await geolocate(clientIp(req));
      if (!geo) throw new HttpError(400, "location_unknown", UNKNOWN_MESSAGE);
      const until = new Date(now.getTime() + days * 86_400_000).toISOString();
      const history = [...used.map((ms) => new Date(ms).toISOString()), now.toISOString()];
      const { data, error } = await db.from("account_locations").upsert({
        user_id: user.id, away_lat: geo.lat, away_lon: geo.lon, away_city: geo.city, away_region: geo.region,
        away_until: until, away_history: history
      }, { onConflict: "user_id" }).select("*").single();
      if (error) throw new HttpError(500, "server_error", "Couldn't turn on Travel mode. Try again.");
      await db.from("active_sessions").update({
        ip: clientIp(req), city: geo.city, region: geo.region, country: geo.country, lat: geo.lat, lon: geo.lon
      }).eq("user_id", user.id);
      const location = locationDecision(data as LocationRecord, geo, rules, now, { admin });
      await syncOk(location);
      return json({ location });
    }

    // ---------------------------------------------------------------------------------------
    case "end_away": {
      const { data, error } = await db.from("account_locations").update({ away_until: null }).eq("user_id", user.id).select("*").maybeSingle();
      if (error) throw new HttpError(500, "server_error", "Couldn't turn off Travel mode. Try again.");
      const row = await getSessionRow(user.id);
      const location = locationFor((data as LocationRecord) || null, row);
      await syncOk(location);
      return json({ location });
    }

    default:
      throw new HttpError(400, "bad_request", "Unknown action.");
  }
}));
