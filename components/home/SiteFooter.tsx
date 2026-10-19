"use client";
// Site footer: logo, links, support contact (site_settings.support) and the independence disclaimer.
// Other teams may import this read-only.
import Link from "next/link";
import { Mail, Phone, MessagesSquare } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { asset, routes } from "@/lib/nav";
import s from "./Footer.module.css";

export const DISCLAIMER =
  "Licensing Bro's is an independent study tool and is not affiliated with PSI, Prometric, NASCLA, the ICC, NFPA or any state licensing board. Practice questions teach tested concepts and are not actual exam items.";

export default function SiteFooter() {
  const { user, settings } = useAuth();
  const email = settings.support?.email?.trim();
  const phone = settings.support?.phone?.trim();
  return (
    <footer className={s.footer}>
      <div className="hazard thin" />
      <div className={`wrap ${s.inner}`}>
        <div className={s.brand}>
          <Link href={routes.home} className={s.logo} aria-label="Licensing Bro's home">
            <span className={s.logoBox}><img src={asset("/logo-sm.png")} alt="" width={53} height={40} /></span>
            <b>Licensing <span>Bro&rsquo;s</span></b>
          </Link>
          <p>Contractor license exam prep for general contractor, electrical, plumbing and HVAC exams in all 50 states.</p>
        </div>
        <nav className={s.col} aria-label="Study">
          <span className={s.colHead}>Study</span>
          <Link href={routes.courses()}>Courses</Link>
          <Link href={routes.learn()}>My Learning</Link>
          <Link href={routes.lives}>Live classes</Link>
          <Link href={routes.community}>Community</Link>
        </nav>
        <nav className={s.col} aria-label="Account">
          <span className={s.colHead}>Account</span>
          {user ? <Link href={routes.account()}>My account</Link> : <Link href={routes.login("signup")}>Create free account</Link>}
          {!user && <Link href={routes.login()}>Sign in</Link>}
          {user && <Link href={routes.account("purchases")}>Purchases</Link>}
          <Link href={routes.verify()}>Verify a certificate</Link>
        </nav>
        <div className={s.col}>
          <span className={s.colHead}>Support</span>
          {email && <a href={`mailto:${email}`}><Mail aria-hidden="true" />{email}</a>}
          {phone && <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}><Phone aria-hidden="true" />{phone}</a>}
          <Link href={routes.community}><MessagesSquare aria-hidden="true" />Ask the community</Link>
        </div>
      </div>
      <div className={`wrap ${s.legal}`}>
        <p className={s.disclaimer}>{DISCLAIMER}</p>
        <p className={s.copy}>&copy; <span suppressHydrationWarning>{new Date().getFullYear()}</span> Licensing Bro&rsquo;s</p>
      </div>
    </footer>
  );
}
