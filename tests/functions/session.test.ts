// One-device-at-a-time decisions.
import { strict as assert } from "node:assert";
import { claimDecision, isSessionActive, sessionCheck, type SessionRow } from "../../supabase/functions/_shared/logic.ts";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const TIMEOUT = 120;
const row = (secondsAgo: number, session_id = "11111111-1111-4111-8111-111111111111"): SessionRow => ({
  session_id, device: "Chrome on Windows", city: "Nashville", region: "Tennessee", last_seen: new Date(NOW - secondsAgo * 1000).toISOString()
});
const OTHER = "22222222-2222-4222-8222-222222222222";

Deno.test("claimDecision: no existing session creates one", () => {
  assert.deepEqual(claimDecision(null, null, false, NOW, TIMEOUT), { action: "create" });
  assert.deepEqual(claimDecision(undefined, OTHER, true, NOW, TIMEOUT), { action: "create" });
});

Deno.test("claimDecision: same session id resumes (no conflict)", () => {
  const r = row(10);
  assert.deepEqual(claimDecision(r, r.session_id, false, NOW, TIMEOUT), { action: "resume" });
  assert.deepEqual(claimDecision(row(9999), r.session_id, false, NOW, TIMEOUT), { action: "resume" }, "even after a long pause");
});

Deno.test("claimDecision: another active device is a conflict", () => {
  const d = claimDecision(row(30), OTHER, false, NOW, TIMEOUT);
  assert.equal(d.action, "conflict");
  if (d.action === "conflict") {
    assert.equal(d.conflict.device, "Chrome on Windows");
    assert.equal(d.conflict.city, "Nashville");
    assert.equal(d.conflict.region, "Tennessee");
    assert.equal(d.conflict.last_seen, row(30).last_seen);
  }
  assert.equal(claimDecision(row(30), null, false, NOW, TIMEOUT).action, "conflict", "a device with no id yet");
});

Deno.test("claimDecision: takeover replaces an active device", () => {
  const d = claimDecision(row(30), OTHER, true, NOW, TIMEOUT);
  assert.equal(d.action, "takeover");
  if (d.action === "takeover") assert.equal(d.previous.device, "Chrome on Windows");
});

Deno.test("claimDecision: a stale session is replaced quietly", () => {
  assert.equal(claimDecision(row(121), OTHER, false, NOW, TIMEOUT).action, "replace_stale");
  assert.equal(claimDecision(row(120), OTHER, false, NOW, TIMEOUT).action, "conflict", "exactly at the timeout still counts as active");
  assert.equal(claimDecision(row(121), OTHER, true, NOW, TIMEOUT).action, "replace_stale");
});

Deno.test("isSessionActive handles bad timestamps", () => {
  assert.equal(isSessionActive({ last_seen: "nope" }, NOW, TIMEOUT), false);
  assert.equal(isSessionActive(null, NOW, TIMEOUT), false);
});

Deno.test("sessionCheck: current, replaced and missing sessions", () => {
  const r = row(5);
  assert.deepEqual(sessionCheck(r, r.session_id), { ok: true, row: r });
  assert.deepEqual(sessionCheck(r, OTHER), { ok: false, code: "session_replaced" });
  assert.deepEqual(sessionCheck(r, null), { ok: false, code: "no_session" });
  assert.deepEqual(sessionCheck(r, "  "), { ok: false, code: "no_session" });
  assert.deepEqual(sessionCheck(null, OTHER), { ok: false, code: "no_session" });
});
