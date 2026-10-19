"use client";
// Purchases (payments) and Certificates tabs.
import Link from "next/link";
import { useEffect, useState } from "react";
import { CreditCard, Award, ExternalLink, Copy, Check, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { routes, SITE_URL, IS_APP_BUILD } from "@/lib/nav";
import type { Certificate } from "@/lib/types";
import s from "./Account.module.css";

type PaymentRow = { id: string; amount_cents: number; currency: string; status: "paid" | "refunded"; created_at: string; course_id: string | null; courses: { title: string } | { title: string }[] | null };

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
function fmtMoney(cents: number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: (currency || "usd").toUpperCase() }).format(cents / 100); }
  catch { return `$${(cents / 100).toFixed(2)}`; }
}
const courseTitle = (r: PaymentRow) => (Array.isArray(r.courses) ? r.courses[0]?.title : r.courses?.title) || "Course";

function Loading() {
  return <div className={s.stack}><span className={s.skel} /><span className={s.skel} /><span className={`${s.skel} ${s.skelShort}`} /></div>;
}

export function PurchasesTab() {
  const { user } = useAuth();
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    supabase().from("payments").select("id,amount_cents,currency,status,created_at,course_id,courses(title)")
      .eq("user_id", user.id).order("created_at", { ascending: false })
      .then(({ data, error }) => { if (!alive) return; if (error) { setErr(true); setRows([]); } else setRows((data as any as PaymentRow[]) || []); });
    return () => { alive = false; };
  }, [user]);

  return (
    <div className={`card ${s.card}`}>
      <div className={s.cardHead}>
        <h2><CreditCard aria-hidden="true" /> Purchases</h2>
        <p>Courses you&rsquo;ve bought, with the date and amount.</p>
      </div>
      {rows === null ? <Loading />
        : err ? <p className="err" role="alert">Couldn&rsquo;t load your purchases. Check your connection and try again.</p>
        : rows.length === 0 ? (
          <div className={s.emptyBox}>
            <p>No purchases yet. When you buy a course, it shows up here.</p>
            <Link href={routes.courses()} className="btn primary cta">Browse courses <ArrowRight aria-hidden="true" /></Link>
          </div>
        ) : (
          <ul className={s.rows}>
            {rows.map((r) => (
              <li key={r.id} className={s.rowItem}>
                <div className={s.rowMain}>
                  {r.course_id ? <Link href={routes.course(r.course_id)} className={s.rowTitle}>{courseTitle(r)}</Link> : <b className={s.rowTitle}>{courseTitle(r)}</b>}
                  <span className={s.muted}>{fmtDate(r.created_at)}</span>
                </div>
                <div className={s.rowSide}>
                  <b className={s.amount}>{fmtMoney(r.amount_cents, r.currency)}</b>
                  {r.status === "refunded" ? <span className="badge warn">Refunded</span> : <span className="badge ok">Paid</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

export function CertificatesTab() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Certificate[] | null>(null);
  const [err, setErr] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const canLink = !!SITE_URL || !IS_APP_BUILD;

  useEffect(() => {
    if (!user) return;
    let alive = true;
    supabase().from("certificates").select("*").eq("user_id", user.id).order("issued_at", { ascending: false })
      .then(({ data, error }) => { if (!alive) return; if (error) { setErr(true); setRows([]); } else setRows((data as Certificate[]) || []); });
    return () => { alive = false; };
  }, [user]);

  async function copyLink(code: string) {
    // In the Android app without a configured site address, copy just the code
    const text = canLink ? `${SITE_URL || window.location.origin}${routes.verify(code)}` : code;
    try { await navigator.clipboard.writeText(text); setCopied(code); setTimeout(() => setCopied((c) => (c === code ? null : c)), 2000); }
    catch { setCopied(null); }
  }

  return (
    <div className={`card ${s.card}`}>
      <div className={s.cardHead}>
        <h2><Award aria-hidden="true" /> Certificates</h2>
        <p>Anyone can check a certificate with its code, so you can share it with an employer.</p>
      </div>
      {rows === null ? <Loading />
        : err ? <p className="err" role="alert">Couldn&rsquo;t load your certificates. Check your connection and try again.</p>
        : rows.length === 0 ? (
          <div className={s.emptyBox}>
            <p>No certificates yet. Finish every lesson in a course, then claim your certificate on the course page.</p>
            <Link href={routes.learn()} className="btn">Go to My Learning <ArrowRight aria-hidden="true" /></Link>
          </div>
        ) : (
          <ul className={s.certs}>
            {rows.map((c) => (
              <li key={c.id} className={s.cert}>
                <span className={s.certIco}><Award aria-hidden="true" /></span>
                <div className={s.certMain}>
                  <b className={s.rowTitle}>{c.course_title}</b>
                  <span className={s.muted}>Issued to {c.student_name} on {fmtDate(c.issued_at)}</span>
                  <span className={s.code}>Code <b>{c.code}</b></span>
                </div>
                <div className={s.certBtns}>
                  <Link href={routes.verify(c.code)} className="btn sm outline-navy"><ExternalLink aria-hidden="true" />View certificate</Link>
                  <button type="button" className="btn sm" onClick={() => copyLink(c.code)}>
                    {copied === c.code ? <><Check aria-hidden="true" />Copied</> : <><Copy aria-hidden="true" />{canLink ? "Copy link" : "Copy code"}</>}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
