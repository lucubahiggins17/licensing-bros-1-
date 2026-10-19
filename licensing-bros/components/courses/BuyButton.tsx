"use client";
// The one purchase button for the Courses area. Handles: still loading, signed out (sign up first and come
// back), the Android app (no checkout in the app: send them to the website) and Stripe Checkout.
import { useState } from "react";
import Link from "next/link";
import { CreditCard, Smartphone, Copy, Check, ExternalLink, ShieldCheck, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { callFn } from "@/lib/api";
import { routes, IS_APP_BUILD, SITE_URL } from "@/lib/nav";
import type { Course } from "@/lib/types";
import { priceLabel, copyText } from "./courseData";
import s from "./BuyButton.module.css";

export type BuyCourse = Pick<Course, "id" | "title" | "price_cents" | "is_free">;

export default function BuyButton({ course, label }: { course: BuyCourse; label?: string }) {
  const { ready, user, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const coursePath = routes.course(course.id);
  const text = label || `Buy for ${priceLabel(course)}`;

  if (!course.is_free && !(course.price_cents > 0)) {
    return <button className="btn cta block" disabled>Not available to buy yet</button>;
  }

  if (IS_APP_BUILD) return <WebsitePurchase course={course} />;

  if (!ready) {
    return <button className="btn primary cta block" disabled aria-busy="true"><span className="spin" aria-hidden="true" /> Loading…</button>;
  }

  if (!user) {
    return (
      <div className={s.box}>
        <Link className="btn primary cta block" href={routes.login("signup", `${coursePath}&buy=1`)}>
          <CreditCard aria-hidden="true" /> {text}
        </Link>
        <p className={s.small}>You&rsquo;ll make a free account first, then check out.</p>
        <p className={s.small}>Have an account? <Link href={routes.login(undefined, `${coursePath}&buy=1`)}>Sign in</Link></p>
      </div>
    );
  }

  async function buy() {
    setBusy(true);
    setErr("");
    try {
      const r = await callFn<{ url: string }>("stripe-checkout", {
        course_id: course.id,
        success_path: `${coursePath}&paid=1`,
        cancel_path: coursePath
      });
      if (!r?.url) throw new Error("Checkout didn't open. Try again in a moment.");
      window.location.assign(r.url); // stay "busy" while the browser leaves for Stripe
    } catch (e: any) {
      setBusy(false);
      if (e?.code === "signed_out") setErr("Your sign-in expired. Sign in again, then tap Buy.");
      else if (e?.code === "already_enrolled") { setErr("You already have this course. Unlocking it now…"); refresh().catch(() => {}); }
      else setErr(e?.message || "Checkout didn't open. Try again in a moment.");
    }
  }

  return (
    <div className={s.box}>
      <button className="btn primary cta block" onClick={buy} disabled={busy} aria-busy={busy}>
        {busy ? <><span className={s.spinWhite} aria-hidden="true" /> Opening secure checkout…</> : <><CreditCard aria-hidden="true" /> {text}</>}
      </button>
      {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
      <p className={s.small}><ShieldCheck aria-hidden="true" /> Secure checkout by Stripe. Promo codes accepted.</p>
    </div>
  );
}

/** Android app: purchases happen on the website. */
function WebsitePurchase({ course }: { course: BuyCourse }) {
  const { refresh, isEnrolled } = useAuth();
  const url = SITE_URL ? `${SITE_URL}${routes.course(course.id)}` : "";
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);

  async function copy() {
    if (await copyText(url)) { setCopied(true); setTimeout(() => setCopied(false), 2200); }
  }
  async function recheck() {
    setChecking(true);
    try { await refresh(); } finally { setChecking(false); setChecked(true); }
  }

  return (
    <div className={s.web}>
      <p className={s.webHead}><Smartphone aria-hidden="true" /> Purchase on our website</p>
      <p className={s.webText}>
        Courses can&rsquo;t be bought inside the app. Open this course on our website, buy it there with the same account,
        and it unlocks here too.
      </p>
      {url ? (
        <>
          <a className="btn primary cta block" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" /> Open the website</a>
          <div className={s.linkRow}>
            <code className={s.url}>{url}</code>
            <button className="btn sm" onClick={copy} aria-live="polite">
              {copied ? <><Check aria-hidden="true" /> Copied</> : <><Copy aria-hidden="true" /> Copy link</>}
            </button>
          </div>
        </>
      ) : (
        <p className={s.webText}>Visit the Licensing Bro&rsquo;s website in your phone&rsquo;s browser to buy this course.</p>
      )}
      <button className="btn sm ghost" onClick={recheck} disabled={checking}>
        <RefreshCw aria-hidden="true" /> {checking ? "Checking…" : "Already bought it? Check again"}
      </button>
      {checked && !checking && !isEnrolled(course.id) && (
        <p className={s.small} role="status">Not unlocked yet. Payments can take a minute to show up. Try again shortly.</p>
      )}
    </div>
  );
}
