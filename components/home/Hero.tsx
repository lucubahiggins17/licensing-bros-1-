"use client";
// Home hero: bolted edition badge, two-line headline, sub copy, CTAs and stat cards on blueprint paper.
import Link from "next/link";
import { ArrowRight, Play, TrendingUp, MapPin, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { routes } from "@/lib/nav";
import type { SiteSettings } from "@/lib/types";
import s from "./Hero.module.css";
import { CountUp } from "@/components/motion";

export const DEFAULT_HERO: SiteSettings["hero"] = {
  badge_top: "2026 Edition",
  badge_main: "Industry-leading contractor education",
  headline_1: "Master your",
  headline_2: "Contractor license",
  sub: "The blueprint to your exam preparation for electrical, plumbing, HVAC, and general contractor certifications"
};

export const DEFAULT_STATS: SiteSettings["home_stats"] = [
  { value: "50", label: "States + DC covered" },
  { value: "4", label: "Trades: GC, electrical, plumbing, HVAC" },
  { value: "2,700+", label: "Verified code, OSHA, business & state facts" }
];

const STAT_ICONS = [TrendingUp, MapPin, Users];

/** "2026 Edition" -> big "2026", small "Edition" */
function splitFirst(text: string, fallbackSmall = "") {
  const t = (text || "").trim();
  const i = t.indexOf(" ");
  return i < 0 ? { first: t, rest: fallbackSmall } : { first: t.slice(0, i), rest: t.slice(i + 1) };
}

export function WarningSign({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 28" aria-hidden="true" focusable="false">
      <path d="M16 2 30.6 26.2H1.4Z" fill="var(--hazard)" stroke="var(--navy)" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M16 10.2v7.4" stroke="var(--navy)" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="16" cy="21.8" r="1.9" fill="var(--navy)" />
    </svg>
  );
}

// Decorative barcode: fixed bar widths so it renders identically on the server and the client
const BARS = [3, 1, 1, 2, 3, 1, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1, 1, 2, 1, 1, 3, 2, 1, 2, 1, 3, 1, 1, 2, 1, 3, 1];
const BAR_RECTS = (() => {
  // even entries are bars, odd entries are the gaps between them
  const out: { x: number; w: number }[] = [];
  let x = 0;
  BARS.forEach((w, i) => { if (i % 2 === 0) out.push({ x, w }); x += w; });
  return { rects: out, width: x };
})();

export function Barcode({ caption = "LB-CS1 · REV 2026", className }: { caption?: string; className?: string }) {
  return (
    <div className={`${s.barcode} ${className || ""}`} aria-hidden="true">
      <svg viewBox={`0 0 ${BAR_RECTS.width} 20`} preserveAspectRatio="none" focusable="false">
        {BAR_RECTS.rects.map((r, i) => <rect key={i} x={r.x} y="0" width={r.w} height="20" fill="currentColor" />)}
      </svg>
      <span>{caption}</span>
    </div>
  );
}

export default function Hero({ compact = false }: { compact?: boolean }) {
  const { user, settings } = useAuth();
  const hero = { ...DEFAULT_HERO, ...(settings.hero || {}) };
  const stats = Array.isArray(settings.home_stats) && settings.home_stats.length ? settings.home_stats.slice(0, 3) : DEFAULT_STATS;
  const seal = splitFirst(hero.badge_top);
  const badge = splitFirst(hero.badge_main, "");
  const badgeSmall = badge.rest ? badge.first : "Licensing Bro’s";
  const badgeBig = badge.rest || badge.first;
  const startHref = user ? routes.learn() : routes.login("signup");

  return (
    <section className={`blueprint ${s.hero} ${compact ? s.compact : ""}`} aria-labelledby="hero-title">
      <div className={s.hatch} aria-hidden="true" />
      <div className={s.inner}>
        {!compact && (
          <div className={`plate ${s.plate}`}>
            <span className="bolts" />
            <div className={s.seal}>
              <b>{seal.first}</b>
              {seal.rest && <small>{seal.rest}</small>}
            </div>
            <span className={s.vdiv} aria-hidden="true" />
            <div className={s.badgeText}>
              <span className={s.badgeSmall}>{badgeSmall}</span>
              <strong className={s.badgeMain}>{badgeBig}</strong>
            </div>
            <WarningSign className={s.warn} />
          </div>
        )}

        <div className={s.headBlock}>
          <span className={s.bracket} aria-hidden="true" />
          <h1 id="hero-title" className={s.h1}>
            <span className={s.l1}><span>{hero.headline_1}</span></span>
            <span className={s.l2}>{hero.headline_2}</span>
          </h1>
        </div>

        <div className={s.subRow}>
          <p className={s.sub}>{hero.sub}</p>
          {!compact && <Barcode />}
        </div>

        <div className={s.ctas}>
          <Link href={startHref} className="btn cta primary">
            Start learning today <ArrowRight aria-hidden="true" />
          </Link>
          <Link href={routes.lives} className={`btn cta outline-navy ${s.demo}`}>
            <Play aria-hidden="true" /> Live demo
          </Link>
        </div>

        {!compact && (
          <ul className={s.stats} aria-label="At a glance">
            {stats.map((st, i) => {
              const Icon = STAT_ICONS[i % STAT_ICONS.length];
              const navy = i % 2 === 1;
              return (
                <li key={i} className={`statcard ${navy ? `navy ${s.statNavy}` : ""}`}>
                  <span className="ico"><Icon aria-hidden="true" /></span>
                  <span className={s.statText}>
                    <b><CountUp value={st.value} /></b>
                    <span className={s.statLabel}>{st.label}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="hazard" />
    </section>
  );
}
