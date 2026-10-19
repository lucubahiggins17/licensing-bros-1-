// LiveKit access token claims and grants.
import { strict as assert } from "node:assert";
import { decodeJwt, decodeProtectedHeader, jwtVerify } from "npm:jose@6.2.12";
import { LIVEKIT_TTL_SECONDS, signLiveKitToken } from "../../supabase/functions/_shared/livekit.ts";

const SECRET = "test-secret-that-is-long-enough-for-hs256";
const NOW = Date.parse("2026-10-19T12:00:00Z");
const base = { apiKey: "APIkey123", apiSecret: SECRET, identity: "user-uuid-1", name: "Jamie Rivera", room: "lb-abc123", now: NOW };

Deno.test("viewer token: subscribe + data, no publish", async () => {
  const token = await signLiveKitToken({ ...base, canPublish: false });
  assert.equal(decodeProtectedHeader(token).alg, "HS256");
  const c = decodeJwt(token) as Record<string, unknown>;
  const now = Math.floor(NOW / 1000);
  assert.equal(c.iss, "APIkey123");
  assert.equal(c.sub, "user-uuid-1");
  assert.equal(c.name, "Jamie Rivera");
  assert.ok(typeof c.nbf === "number" && c.nbf <= now && c.nbf >= now - 60);
  assert.equal(c.exp, now + LIVEKIT_TTL_SECONDS);
  assert.equal(LIVEKIT_TTL_SECONDS, 6 * 3600);
  assert.deepEqual(c.video, { room: "lb-abc123", roomJoin: true, canPublish: false, canSubscribe: true, canPublishData: true });
});

Deno.test("host token: publish + subscribe + data", async () => {
  const token = await signLiveKitToken({ ...base, canPublish: true, metadata: JSON.stringify({ role: "host" }) });
  const c = decodeJwt(token) as Record<string, unknown>;
  assert.deepEqual(c.video, { room: "lb-abc123", roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  assert.equal(c.metadata, '{"role":"host"}');
});

Deno.test("token signature verifies with the API secret only", async () => {
  const token = await signLiveKitToken({ ...base, canPublish: false, now: Date.now() });
  const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET), { issuer: "APIkey123" });
  assert.equal(payload.sub, "user-uuid-1");
  await assert.rejects(() => jwtVerify(token, new TextEncoder().encode("wrong-secret-wrong-secret-wrong!!")));
});
