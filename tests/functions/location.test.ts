// Home area + Travel mode decision and distance math.
import { strict as assert } from "node:assert";
import {
  awayPassesLeft,
  canChangeHomeAfter,
  DEFAULT_RULES,
  type Geo,
  locationDecision,
  type LocationRecord,
  milesBetween,
  nextAwayPassAt,
  normalizeRules
} from "../../supabase/functions/_shared/logic.ts";

const NASHVILLE = { lat: 36.1627, lon: -86.7816 };
const ATLANTA = { lat: 33.749, lon: -84.388 };
const MURFREESBORO = { lat: 35.8456, lon: -86.3903 };
const NOW = Date.parse("2026-10-19T12:00:00Z");
const DAY = 86_400_000;

const geo = (p: { lat: number; lon: number }, city: string, region: string): Geo => ({ ...p, city, region, country: "US" });
const home = (extra: Partial<LocationRecord> = {}): LocationRecord => ({
  home_lat: NASHVILLE.lat, home_lon: NASHVILLE.lon, home_city: "Nashville", home_region: "Tennessee", home_country: "US",
  home_set_at: new Date(NOW - 40 * DAY).toISOString(),
  away_lat: null, away_lon: null, away_city: null, away_region: null, away_until: null, away_history: [],
  ...extra
});

Deno.test("milesBetween: Nashville to Atlanta is about 214 miles", () => {
  const d = milesBetween(NASHVILLE, ATLANTA);
  assert.ok(Math.abs(d - 214) < 5, `got ${d}`);
  assert.equal(milesBetween(NASHVILLE, NASHVILLE), 0);
  assert.ok(Math.abs(milesBetween(NASHVILLE, ATLANTA) - milesBetween(ATLANTA, NASHVILLE)) < 1e-9);
});

Deno.test("locationDecision: inside the home radius is home", () => {
  const r = locationDecision(home(), geo(MURFREESBORO, "Murfreesboro", "Tennessee"), DEFAULT_RULES, NOW);
  assert.equal(r.state, "home");
  assert.equal(r.ok, true);
  assert.equal(r.enforce, true);
  assert.equal(r.city, "Murfreesboro");
  assert.equal(r.home_city, "Nashville");
  assert.ok(r.distance_miles !== null && r.distance_miles < 40);
});

Deno.test("locationDecision: outside the home radius is blocked", () => {
  const r = locationDecision(home(), geo(ATLANTA, "Atlanta", "Georgia"), DEFAULT_RULES, NOW);
  assert.equal(r.state, "outside");
  assert.equal(r.ok, false);
  assert.equal(r.away_until, null);
});

Deno.test("locationDecision: a bigger radius lets the same trip through", () => {
  const r = locationDecision(home(), geo(ATLANTA, "Atlanta", "Georgia"), { ...DEFAULT_RULES, home_radius_miles: 250 }, NOW);
  assert.equal(r.state, "home");
  assert.equal(r.ok, true);
});

Deno.test("locationDecision: active Travel mode near the away spot is allowed", () => {
  const until = new Date(NOW + 5 * DAY).toISOString();
  const rec = home({ away_lat: ATLANTA.lat, away_lon: ATLANTA.lon, away_city: "Atlanta", away_region: "Georgia", away_until: until });
  const r = locationDecision(rec, geo(ATLANTA, "Atlanta", "Georgia"), DEFAULT_RULES, NOW);
  assert.equal(r.state, "away");
  assert.equal(r.ok, true);
  assert.equal(r.away_city, "Atlanta");
  assert.equal(r.away_until, until);
});

Deno.test("locationDecision: active Travel mode doesn't cover a third city", () => {
  const rec = home({ away_lat: ATLANTA.lat, away_lon: ATLANTA.lon, away_city: "Atlanta", away_until: new Date(NOW + DAY).toISOString() });
  const DENVER = { lat: 39.7392, lon: -104.9903 };
  const r = locationDecision(rec, geo(DENVER, "Denver", "Colorado"), DEFAULT_RULES, NOW);
  assert.equal(r.state, "outside");
  assert.equal(r.ok, false);
});

Deno.test("locationDecision: expired Travel mode is blocked again", () => {
  const rec = home({ away_lat: ATLANTA.lat, away_lon: ATLANTA.lon, away_city: "Atlanta", away_until: new Date(NOW - 60_000).toISOString() });
  const r = locationDecision(rec, geo(ATLANTA, "Atlanta", "Georgia"), DEFAULT_RULES, NOW);
  assert.equal(r.state, "outside");
  assert.equal(r.ok, false);
  assert.equal(r.away_until, null, "expired travel mode isn't reported as active");
  assert.equal(r.away_city, null);
});

Deno.test("locationDecision: no home yet is unset and allowed", () => {
  const r1 = locationDecision(null, geo(ATLANTA, "Atlanta", "Georgia"), DEFAULT_RULES, NOW);
  assert.equal(r1.state, "unset");
  assert.equal(r1.ok, true);
  const r2 = locationDecision(home({ home_lat: null, home_lon: null }), geo(ATLANTA, "Atlanta", "Georgia"), DEFAULT_RULES, NOW);
  assert.equal(r2.state, "unset");
});

Deno.test("locationDecision: unknown location fails open", () => {
  for (const g of [null, undefined, { city: "Somewhere", region: null, country: null } as Partial<Geo>]) {
    const r = locationDecision(home(), g, DEFAULT_RULES, NOW);
    assert.equal(r.state, "unknown");
    assert.equal(r.ok, true);
    assert.equal(r.enforce, true);
  }
});

Deno.test("locationDecision: enforce off always passes", () => {
  const r = locationDecision(home(), geo(ATLANTA, "Atlanta", "Georgia"), { ...DEFAULT_RULES, enforce: false }, NOW);
  assert.equal(r.state, "outside");
  assert.equal(r.ok, true);
  assert.equal(r.enforce, false);
});

Deno.test("locationDecision: admins always pass", () => {
  const r = locationDecision(home(), geo(ATLANTA, "Atlanta", "Georgia"), DEFAULT_RULES, NOW, { admin: true });
  assert.equal(r.ok, true);
  assert.equal(r.enforce, false);
});

Deno.test("travel passes: counts only the last 90 days", () => {
  const rec = { away_history: [new Date(NOW - 100 * DAY).toISOString(), new Date(NOW - 10 * DAY).toISOString()] };
  assert.equal(awayPassesLeft(rec, DEFAULT_RULES, NOW), 2);
  assert.equal(nextAwayPassAt(rec, DEFAULT_RULES, NOW), null);
  const full = { away_history: [80, 50, 10].map((d) => new Date(NOW - d * DAY).toISOString()) };
  assert.equal(awayPassesLeft(full, DEFAULT_RULES, NOW), 0);
  assert.equal(nextAwayPassAt(full, DEFAULT_RULES, NOW), new Date(NOW + 10 * DAY).toISOString());
  assert.equal(awayPassesLeft(null, DEFAULT_RULES, NOW), 3);
  const r = locationDecision(home(full), geo(NASHVILLE, "Nashville", "Tennessee"), DEFAULT_RULES, NOW);
  assert.equal(r.away_passes_left, 0);
});

Deno.test("home change: waits home_change_days after a manual change", () => {
  assert.equal(canChangeHomeAfter({ home_set_at: new Date(NOW - 40 * DAY).toISOString() }, DEFAULT_RULES, NOW), null);
  assert.equal(canChangeHomeAfter({ home_set_at: new Date(NOW - 10 * DAY).toISOString() }, DEFAULT_RULES, NOW), new Date(NOW + 20 * DAY).toISOString());
  assert.equal(canChangeHomeAfter({ home_set_at: null }, DEFAULT_RULES, NOW), null, "an automatic home can be corrected right away");
});

Deno.test("normalizeRules: fills gaps with defaults and coerces numbers", () => {
  const r = normalizeRules({ enforce: false, home_radius_miles: "50", session_timeout_seconds: null });
  assert.equal(r.enforce, false);
  assert.equal(r.home_radius_miles, 50);
  assert.equal(r.session_timeout_seconds, DEFAULT_RULES.session_timeout_seconds);
  assert.deepEqual(normalizeRules(null), DEFAULT_RULES);
});
