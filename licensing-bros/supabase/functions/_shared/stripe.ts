// Stripe Checkout + webhook handling. The event handler takes an injected store so tests can run it
// against an in-memory fake instead of the database.
import Stripe from "npm:stripe@23.0.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.100.0";
import { safePath } from "./logic.ts";

export { Stripe };

export function stripeClient(key = Deno.env.get("STRIPE_SECRET_KEY") || ""): Stripe | null {
  if (!key) return null;
  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
}

const cryptoProvider = Stripe.createSubtleCryptoProvider();

/** Verifies the Stripe-Signature header (v1 HMAC) and returns the parsed event. Throws when invalid. */
export async function verifyStripeEvent(rawBody: string, signature: string, secret: string, receivedAt?: number): Promise<Stripe.Event> {
  return await Stripe.webhooks.constructEventAsync(rawBody, signature, secret, undefined, cryptoProvider, receivedAt);
}

/** Test helper: a valid Stripe-Signature header for a payload. */
export async function testSignature(payload: string, secret: string, timestamp?: number): Promise<string> {
  return await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret, timestamp, cryptoProvider });
}

export type CheckoutCourse = { id: string; title: string; subtitle?: string | null; price_cents: number; cover_url?: string | null };

/** Checkout Session parameters. The price always comes from the database row, never from the client. */
export function buildCheckoutParams(
  course: CheckoutCourse,
  user: { id: string; email?: string | null },
  siteUrl: string,
  successPath?: unknown,
  cancelPath?: unknown
): Stripe.Checkout.SessionCreateParams {
  const base = siteUrl.replace(/\/+$/, "");
  const success = safePath(successPath, `/course/?id=${course.id}&paid=1`);
  const cancel = safePath(cancelPath, `/course/?id=${course.id}`);
  const product: Stripe.Checkout.SessionCreateParams.LineItem.PriceData.ProductData = { name: course.title.slice(0, 250) };
  if (course.subtitle && course.subtitle.trim()) product.description = course.subtitle.trim().slice(0, 500);
  if (course.cover_url && /^https:\/\//i.test(course.cover_url)) product.images = [course.cover_url];
  const meta = { user_id: user.id, course_id: course.id };
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: course.price_cents, product_data: product } }],
    metadata: meta,
    payment_intent_data: { metadata: meta },
    client_reference_id: user.id,
    allow_promotion_codes: true,
    success_url: `${base}${success}`,
    cancel_url: `${base}${cancel}`
  };
  if (user.email) params.customer_email = user.email;
  return params;
}

// ---------------------------------------------------------------------------------------------
// Webhook event handling
// ---------------------------------------------------------------------------------------------
export type PaymentRecord = {
  user_id: string;
  course_id: string;
  amount_cents: number;
  currency: string;
  stripe_session_id: string;
  stripe_payment_intent: string | null;
};

export interface StripeStore {
  courseTitle(courseId: string): Promise<string | null>;
  /** Enroll with source "stripe"; keeps an existing enrollment (e.g. an admin grant) as it is. */
  enroll(userId: string, courseId: string): Promise<void>;
  /** Insert the payment; false when this checkout session was already recorded. */
  recordPayment(p: PaymentRecord): Promise<boolean>;
  notify(userId: string, title: string, body: string, link: string): Promise<void>;
  /** Mark payments for this PaymentIntent refunded; returns the affected rows. */
  markRefunded(paymentIntent: string): Promise<{ user_id: string | null; course_id: string | null }[]>;
  /** Remove the stripe-sourced enrollment only. */
  unenroll(userId: string, courseId: string): Promise<void>;
}

export type HandleResult = { handled: boolean; note?: string };

export const HANDLED_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded", "charge.refunded"]);

const idOf = (v: unknown): string | null =>
  typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null;

// deno-lint-ignore no-explicit-any
export async function handleStripeEvent(event: { type: string; data: { object: any } }, store: StripeStore): Promise<HandleResult> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object || {};
      // "no_payment_required" = a 100%-off promotion code: still a valid purchase
      if (s.payment_status !== "paid" && s.payment_status !== "no_payment_required") return { handled: false, note: "payment not finished" };
      const userId = s.metadata?.user_id || s.client_reference_id;
      const courseId = s.metadata?.course_id;
      if (!userId || !courseId || !s.id) return { handled: false, note: "missing metadata" };
      await store.enroll(userId, courseId);
      const isNew = await store.recordPayment({
        user_id: userId,
        course_id: courseId,
        amount_cents: typeof s.amount_total === "number" ? s.amount_total : 0,
        currency: typeof s.currency === "string" ? s.currency : "usd",
        stripe_session_id: s.id,
        stripe_payment_intent: idOf(s.payment_intent)
      });
      if (isNew) {
        const title = await store.courseTitle(courseId);
        await store.notify(userId, `You're enrolled in ${title || "your new course"}`, "You now have full access. Open the course to start learning.", `/course/?id=${courseId}`);
      }
      return { handled: true, note: isNew ? "enrolled" : "duplicate" };
    }
    case "charge.refunded": {
      const c = event.data.object || {};
      const full = c.refunded === true || (typeof c.amount === "number" && typeof c.amount_refunded === "number" && c.amount_refunded >= c.amount);
      if (!full) return { handled: false, note: "partial refund" };
      const pi = idOf(c.payment_intent);
      if (!pi) return { handled: false, note: "no payment intent" };
      const rows = await store.markRefunded(pi);
      for (const r of rows) if (r.user_id && r.course_id) await store.unenroll(r.user_id, r.course_id);
      return { handled: true, note: `refunded ${rows.length}` };
    }
    default:
      return { handled: false };
  }
}

/** The real store, backed by the service-role Supabase client. */
export function supabaseStripeStore(db: SupabaseClient): StripeStore {
  const check = (error: unknown, what: string) => { if (error) throw new Error(`${what}: ${(error as { message?: string }).message || error}`); };
  return {
    async courseTitle(courseId) {
      const { data } = await db.from("courses").select("title").eq("id", courseId).maybeSingle();
      return (data as { title?: string } | null)?.title ?? null;
    },
    async enroll(userId, courseId) {
      const { error } = await db.from("enrollments")
        .upsert({ user_id: userId, course_id: courseId, source: "stripe" }, { onConflict: "user_id,course_id", ignoreDuplicates: true });
      check(error, "enroll");
    },
    async recordPayment(p) {
      const { data, error } = await db.from("payments")
        .upsert({ ...p, status: "paid" }, { onConflict: "stripe_session_id", ignoreDuplicates: true })
        .select("id");
      check(error, "payment");
      return Array.isArray(data) && data.length > 0;
    },
    async notify(userId, title, body, link) {
      const { error } = await db.from("notifications").insert({ user_id: userId, title, body, link });
      check(error, "notify");
    },
    async markRefunded(paymentIntent) {
      const { data, error } = await db.from("payments").update({ status: "refunded" })
        .eq("stripe_payment_intent", paymentIntent).select("user_id, course_id");
      check(error, "refund");
      return (data || []) as { user_id: string | null; course_id: string | null }[];
    },
    async unenroll(userId, courseId) {
      const { error } = await db.from("enrollments").delete().eq("user_id", userId).eq("course_id", courseId).eq("source", "stripe");
      check(error, "unenroll");
    }
  };
}
