// Stripe webhook (deployed with --no-verify-jwt; Stripe signs each request instead).
//   checkout.session.completed → enrollment + payment + notification
//   charge.refunded            → payment marked refunded + stripe enrollment removed
// Every other event gets a quick 200.
import { adminClient, fail, json } from "../_shared/common.ts";
import { HANDLED_EVENTS, handleStripeEvent, supabaseStripeStore, verifyStripeEvent } from "../_shared/stripe.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail(405, "bad_request", "Use POST.");
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) return fail(503, "not_configured", "STRIPE_WEBHOOK_SECRET is not set.");
  const signature = req.headers.get("stripe-signature");
  if (!signature) return fail(400, "bad_request", "Missing Stripe signature.");

  const raw = await req.text();
  let event;
  try {
    event = await verifyStripeEvent(raw, signature, secret);
  } catch (e) {
    console.warn("stripe signature check failed", (e as Error)?.message);
    return fail(400, "bad_signature", "Invalid signature.");
  }

  if (!HANDLED_EVENTS.has(event.type)) return json({ received: true, handled: false });

  try {
    const result = await handleStripeEvent(event, supabaseStripeStore(adminClient()));
    return json({ received: true, ...result });
  } catch (e) {
    // 500 makes Stripe retry later; every step is safe to repeat
    console.error("stripe webhook", event.type, (e as Error)?.message);
    return fail(500, "server_error", "Webhook handling failed.");
  }
});
