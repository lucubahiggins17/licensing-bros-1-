// Stripe: webhook signature round trip, event handling against a fake store, checkout parameters.
import { strict as assert } from "node:assert";
import {
  buildCheckoutParams,
  handleStripeEvent,
  type PaymentRecord,
  type StripeStore,
  testSignature,
  verifyStripeEvent
} from "../../supabase/functions/_shared/stripe.ts";

const SECRET = "whsec_test_secret";

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const completed = (overrides: Record<string, unknown> = {}) => ({
  id: "evt_1",
  object: "event",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_1", object: "checkout.session", payment_status: "paid", amount_total: 14900, currency: "usd",
      payment_intent: "pi_1", client_reference_id: "user-1", metadata: { user_id: "user-1", course_id: "course-1" }, ...overrides
    }
  }
});

class FakeStore implements StripeStore {
  enrollments = new Map<string, string>(); // "user|course" → source
  payments: (PaymentRecord & { status: string })[] = [];
  notes: { userId: string; title: string; body: string; link: string }[] = [];
  async courseTitle(id: string) { return id === "course-1" ? "Tennessee GC Exam Prep" : null; }
  async enroll(u: string, c: string) { if (!this.enrollments.has(`${u}|${c}`)) this.enrollments.set(`${u}|${c}`, "stripe"); }
  async recordPayment(p: PaymentRecord) {
    if (this.payments.some((x) => x.stripe_session_id === p.stripe_session_id)) return false;
    this.payments.push({ ...p, status: "paid" });
    return true;
  }
  async notify(userId: string, title: string, body: string, link: string) { this.notes.push({ userId, title, body, link }); }
  async markRefunded(pi: string) {
    const rows = this.payments.filter((p) => p.stripe_payment_intent === pi);
    rows.forEach((p) => (p.status = "refunded"));
    return rows.map((p) => ({ user_id: p.user_id, course_id: p.course_id }));
  }
  async unenroll(u: string, c: string) { if (this.enrollments.get(`${u}|${c}`) === "stripe") this.enrollments.delete(`${u}|${c}`); }
}

Deno.test("webhook signature: Stripe's test header verifies, tampering fails", async () => {
  const payload = JSON.stringify(completed());
  const header = await testSignature(payload, SECRET);
  const event = await verifyStripeEvent(payload, header, SECRET);
  assert.equal(event.type, "checkout.session.completed");
  await assert.rejects(() => verifyStripeEvent(payload.replace("14900", "100"), header, SECRET));
  await assert.rejects(() => verifyStripeEvent(payload, header, "whsec_wrong"));
});

Deno.test("webhook signature: a hand-computed v1 HMAC verifies; old timestamps are rejected", async () => {
  const payload = JSON.stringify(completed());
  const t = Math.floor(Date.now() / 1000);
  const header = `t=${t},v1=${await hmacHex(SECRET, `${t}.${payload}`)}`;
  assert.equal((await verifyStripeEvent(payload, header, SECRET)).id, "evt_1");
  const old = t - 3600;
  const stale = `t=${old},v1=${await hmacHex(SECRET, `${old}.${payload}`)}`;
  await assert.rejects(() => verifyStripeEvent(payload, stale, SECRET), "outside the 5-minute tolerance");
});

Deno.test("checkout.session.completed: enrolls, records payment, notifies once", async () => {
  const store = new FakeStore();
  const r = await handleStripeEvent(completed(), store);
  assert.deepEqual(r, { handled: true, note: "enrolled" });
  assert.equal(store.enrollments.get("user-1|course-1"), "stripe");
  assert.equal(store.payments.length, 1);
  assert.deepEqual(store.payments[0], {
    user_id: "user-1", course_id: "course-1", amount_cents: 14900, currency: "usd",
    stripe_session_id: "cs_test_1", stripe_payment_intent: "pi_1", status: "paid"
  });
  assert.equal(store.notes.length, 1);
  assert.equal(store.notes[0].title, "You're enrolled in Tennessee GC Exam Prep");
  assert.equal(store.notes[0].link, "/course/?id=course-1");

  // Stripe retries the same event: no duplicate payment or notification
  const again = await handleStripeEvent(completed(), store);
  assert.deepEqual(again, { handled: true, note: "duplicate" });
  assert.equal(store.payments.length, 1);
  assert.equal(store.notes.length, 1);
});

Deno.test("checkout.session.completed: unpaid sessions and missing metadata are skipped", async () => {
  const store = new FakeStore();
  assert.equal((await handleStripeEvent(completed({ payment_status: "unpaid" }), store)).handled, false);
  assert.equal((await handleStripeEvent(completed({ metadata: {}, client_reference_id: null }), store)).handled, false);
  assert.equal(store.enrollments.size, 0);
  assert.equal(store.payments.length, 0);
});

Deno.test("checkout.session.completed: a 100% promo code still enrolls", async () => {
  const store = new FakeStore();
  const r = await handleStripeEvent(completed({ payment_status: "no_payment_required", amount_total: 0, payment_intent: null }), store);
  assert.equal(r.handled, true);
  assert.equal(store.enrollments.get("user-1|course-1"), "stripe");
  assert.equal(store.payments[0].amount_cents, 0);
  assert.equal(store.payments[0].stripe_payment_intent, null);
});

Deno.test("an admin grant isn't overwritten or removed by Stripe", async () => {
  const store = new FakeStore();
  store.enrollments.set("user-1|course-1", "admin");
  await handleStripeEvent(completed(), store);
  assert.equal(store.enrollments.get("user-1|course-1"), "admin");
  await handleStripeEvent({ type: "charge.refunded", data: { object: { payment_intent: "pi_1", refunded: true, amount: 14900, amount_refunded: 14900 } } }, store);
  assert.equal(store.enrollments.get("user-1|course-1"), "admin");
});

Deno.test("charge.refunded: marks the payment refunded and removes the stripe enrollment", async () => {
  const store = new FakeStore();
  await handleStripeEvent(completed(), store);
  const partial = await handleStripeEvent({ type: "charge.refunded", data: { object: { payment_intent: "pi_1", refunded: false, amount: 14900, amount_refunded: 5000 } } }, store);
  assert.equal(partial.handled, false, "partial refunds keep access");
  assert.equal(store.payments[0].status, "paid");

  const r = await handleStripeEvent({ type: "charge.refunded", data: { object: { payment_intent: { id: "pi_1" }, refunded: true, amount: 14900, amount_refunded: 14900 } } }, store);
  assert.deepEqual(r, { handled: true, note: "refunded 1" });
  assert.equal(store.payments[0].status, "refunded");
  assert.equal(store.enrollments.has("user-1|course-1"), false);
});

Deno.test("other events are acknowledged without changes", async () => {
  const store = new FakeStore();
  assert.deepEqual(await handleStripeEvent({ type: "customer.created", data: { object: {} } }, store), { handled: false });
});

Deno.test("full round trip: signed payload → verify → handle", async () => {
  const store = new FakeStore();
  const payload = JSON.stringify(completed());
  const event = await verifyStripeEvent(payload, await testSignature(payload, SECRET), SECRET);
  await handleStripeEvent(event, store);
  assert.equal(store.enrollments.get("user-1|course-1"), "stripe");
});

Deno.test("checkout params: price from the database, safe redirect paths", () => {
  const course = { id: "course-1", title: "Tennessee GC Exam Prep", subtitle: "Pass the first time", price_cents: 14900, cover_url: "https://cdn.example.com/c.png" };
  const p = buildCheckoutParams(course, { id: "user-1", email: "sam@example.com" }, "https://licensingbros.com/", undefined, undefined);
  assert.equal(p.mode, "payment");
  assert.equal(p.allow_promotion_codes, true);
  assert.equal(p.client_reference_id, "user-1");
  assert.equal(p.customer_email, "sam@example.com");
  assert.deepEqual(p.metadata, { user_id: "user-1", course_id: "course-1" });
  assert.equal(p.line_items?.[0].price_data?.unit_amount, 14900);
  assert.equal(p.line_items?.[0].price_data?.currency, "usd");
  assert.equal(p.line_items?.[0].price_data?.product_data?.name, "Tennessee GC Exam Prep");
  assert.equal(p.success_url, "https://licensingbros.com/course/?id=course-1&paid=1");
  assert.equal(p.cancel_url, "https://licensingbros.com/course/?id=course-1");

  const custom = buildCheckoutParams(course, { id: "user-1" }, "https://licensingbros.com", "/live/watch/?id=9&paid=1", "//evil.example.com");
  assert.equal(custom.success_url, "https://licensingbros.com/live/watch/?id=9&paid=1");
  assert.equal(custom.cancel_url, "https://licensingbros.com/course/?id=course-1", "protocol-relative paths are refused");
  assert.equal(custom.customer_email, undefined);
  const bad = buildCheckoutParams(course, { id: "user-1" }, "https://licensingbros.com", "https://evil.example.com", "javascript:alert(1)");
  assert.equal(bad.success_url, "https://licensingbros.com/course/?id=course-1&paid=1");
});
