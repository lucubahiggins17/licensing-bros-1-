// JWT payload decoding, fresh email-code check, client IP and geolocation parsing (fake fetch, no network).
import { strict as assert } from "node:assert";
import { clientIp, decodeJwtPayload, isPrivateIp, parseIpinfo, recentOtp } from "../../supabase/functions/_shared/logic.ts";
import { geolocate } from "../../supabase/functions/_shared/common.ts";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const sec = (ms: number) => Math.floor(ms / 1000);

function fakeJwt(payload: unknown): string {
  const b64u = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64u(JSON.stringify(payload))}.sig`;
}

Deno.test("decodeJwtPayload reads the amr claim", () => {
  const p = decodeJwtPayload(fakeJwt({ sub: "u1", email: "josé@example.com", amr: [{ method: "otp", timestamp: 123 }] }));
  assert.equal(p.sub, "u1");
  assert.equal(p.email, "josé@example.com");
  assert.deepEqual(p.amr, [{ method: "otp", timestamp: 123 }]);
  assert.deepEqual(decodeJwtPayload("garbage"), {});
  assert.deepEqual(decodeJwtPayload(""), {});
});

Deno.test("recentOtp: email code within the window passes", () => {
  const p = { amr: [{ method: "password", timestamp: sec(NOW - 3600_000) }, { method: "otp", timestamp: sec(NOW - 5 * 60_000) }] };
  assert.equal(recentOtp(p, 15, NOW), true);
});

Deno.test("recentOtp: old code, password-only and missing amr fail", () => {
  assert.equal(recentOtp({ amr: [{ method: "otp", timestamp: sec(NOW - 16 * 60_000) }] }, 15, NOW), false);
  assert.equal(recentOtp({ amr: [{ method: "password", timestamp: sec(NOW - 60_000) }] }, 15, NOW), false);
  assert.equal(recentOtp({ amr: ["otp"] }, 15, NOW), false, "no timestamp, can't prove it's fresh");
  assert.equal(recentOtp({}, 15, NOW), false);
  assert.equal(recentOtp(null, 15, NOW), false);
  assert.equal(recentOtp({ amr: [{ method: "otp", timestamp: sec(NOW + 3600_000) }] }, 15, NOW), false, "future timestamps are ignored");
});

Deno.test("clientIp: x-forwarded-for first, then cf-connecting-ip, then x-real-ip", () => {
  const req = (h: Record<string, string>) => ({ headers: new Headers(h) });
  assert.equal(clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1", "cf-connecting-ip": "198.51.100.1" })), "203.0.113.7");
  assert.equal(clientIp(req({ "cf-connecting-ip": "198.51.100.1", "x-real-ip": "198.51.100.2" })), "198.51.100.1");
  assert.equal(clientIp(req({ "x-real-ip": "2001:DB8::1" })), "2001:db8::1");
  assert.equal(clientIp(req({ "x-forwarded-for": "203.0.113.7:4431" })), "203.0.113.7");
  assert.equal(clientIp(req({ "x-forwarded-for": "not an ip", "x-real-ip": "198.51.100.3" })), "198.51.100.3");
  assert.equal(clientIp(req({})), null);
});

Deno.test("isPrivateIp: private, loopback and CGNAT ranges", () => {
  for (const ip of ["10.1.2.3", "127.0.0.1", "192.168.1.10", "172.16.0.1", "172.31.255.255", "169.254.1.1", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:192.168.0.1"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "203.0.113.7", "2600:1700::1"]) assert.equal(isPrivateIp(ip), false, ip);
});

Deno.test("parseIpinfo: coordinates and names", () => {
  assert.deepEqual(parseIpinfo({ ip: "8.8.8.8", city: "Nashville", region: "Tennessee", country: "US", loc: "36.1659,-86.7844" }),
    { city: "Nashville", region: "Tennessee", country: "US", lat: 36.1659, lon: -86.7844 });
  assert.equal(parseIpinfo({ ip: "10.0.0.1", bogon: true }), null);
  assert.equal(parseIpinfo({ city: "X" }), null);
  assert.equal(parseIpinfo({ loc: "abc,def" }), null);
});

Deno.test("geolocate: uses ipinfo through the injected fetch, skips private IPs, fails soft", async () => {
  let calls = 0;
  const ok = (async (url: string | URL | Request) => {
    calls++;
    assert.match(String(url), /^https:\/\/ipinfo\.io\/198\.51\.100\.20\/json/);
    return new Response(JSON.stringify({ city: "Atlanta", region: "Georgia", country: "US", loc: "33.749,-84.388" }), { status: 200 });
  }) as typeof fetch;
  const g = await geolocate("198.51.100.20", ok);
  assert.deepEqual(g, { city: "Atlanta", region: "Georgia", country: "US", lat: 33.749, lon: -84.388 });

  const never = (() => { throw new Error("should not be called"); }) as unknown as typeof fetch;
  assert.equal(await geolocate("192.168.1.5", never), null);
  assert.equal(await geolocate(null, never), null);

  const broken = (() => Promise.reject(new Error("timeout"))) as unknown as typeof fetch;
  assert.equal(await geolocate("198.51.100.21", broken), null);
  const notOk = (() => Promise.resolve(new Response("rate limited", { status: 429 }))) as unknown as typeof fetch;
  assert.equal(await geolocate("198.51.100.22", notOk), null);
  assert.equal(calls, 1);
});
