// Starts a Stripe Checkout for one course. The price comes from the database, never from the app.
import { adminClient, handler, HttpError, isUuid, json, readBody, requireUser } from "../_shared/common.ts";
import { buildCheckoutParams, stripeClient } from "../_shared/stripe.ts";

Deno.serve(handler(async (req) => {
  const { user } = await requireUser(req);
  const body = await readBody(req);
  if (!isUuid(body.course_id)) throw new HttpError(400, "bad_request", "Pick a course first.");
  const db = adminClient();

  const { data: course } = await db.from("courses")
    .select("id, title, subtitle, price_cents, is_free, published, cover_url").eq("id", body.course_id).maybeSingle();
  if (!course || !course.published) throw new HttpError(404, "not_found", "That course isn't available.");
  if (course.is_free || !(course.price_cents > 0)) throw new HttpError(400, "bad_request", "This course is free. Just open it to start.");

  const { data: enr } = await db.from("enrollments").select("course_id").eq("user_id", user.id).eq("course_id", course.id).maybeSingle();
  if (enr) throw new HttpError(409, "already_enrolled", "You already have this course.", { course_id: course.id });

  const stripe = stripeClient();
  if (!stripe) throw new HttpError(503, "not_configured", "Payments aren't set up yet. Try again later.");

  const site = (Deno.env.get("SITE_URL") || req.headers.get("origin") || "").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(site)) throw new HttpError(503, "not_configured", "Payments aren't set up yet (missing site address).");

  try {
    const session = await stripe.checkout.sessions.create(buildCheckoutParams(course, user, site, body.success_path, body.cancel_path));
    if (!session.url) throw new Error("no checkout url");
    return json({ url: session.url });
  } catch (e) {
    console.error("stripe checkout", (e as Error)?.message);
    throw new HttpError(502, "payment_error", "Couldn't open checkout. Try again in a minute.");
  }
}));
