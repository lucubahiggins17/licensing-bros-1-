"use client";
// Upcoming live classes and featured courses on the home page. Each section hides itself when empty.
import Link from "next/link";
import { ArrowRight, CalendarClock, Clock, MapPin } from "lucide-react";
import { routes } from "@/lib/nav";
import { money, type Course, type Live } from "@/lib/types";
import { whenLabel } from "@/components/notifications/timeAgo";
import { TradeBadge, tradeMeta } from "./trades";
import s from "./Home.module.css";

function SectionTop({ eyebrow, title, id, href, cta }: { eyebrow: string; title: string; id: string; href: string; cta: string }) {
  return (
    <div className={s.listHead}>
      <div>
        <span className="eyebrow orange">{eyebrow}</span>
        <h2 id={id}>{title}</h2>
      </div>
      <Link href={href} className="btn outline-navy sm">{cta} <ArrowRight aria-hidden="true" /></Link>
    </div>
  );
}

export function UpcomingLives({ lives }: { lives: Live[] }) {
  if (!lives.length) return null;
  return (
    <section className={s.listSection} aria-labelledby="lives-title">
      <div className="wrap">
        <SectionTop eyebrow="On the schedule" title="Upcoming live classes" id="lives-title" href={routes.lives} cta="All live classes" />
        <ul className={s.cards}>
          {lives.slice(0, 3).map((l) => (
            <li key={l.id}>
              <Link href={routes.watch(l.id)} className={s.liveCard}>
                <span className={s.liveWhen}>
                  {l.status === "live" ? <span className="badge live">Live now</span> : <><CalendarClock aria-hidden="true" />{whenLabel(l.starts_at)}</>}
                </span>
                <span className={s.cardBody}>
                  <span className="row" style={{ gap: 6 }}>
                    <TradeBadge trade={l.trade} short />
                    {l.is_free ? <span className="badge free">Free</span> : l.course_id ? <span className="badge">Course students</span> : <span className="badge paid">Pro</span>}
                  </span>
                  <b className={s.cardTitle}>{l.title}</b>
                  {l.description && <span className={s.cardDesc}>{l.description}</span>}
                  <span className={s.cardMore}>{l.status === "live" ? "Join now" : "See details"} <ArrowRight aria-hidden="true" /></span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const statesLabel = (states: string[]) => (!states?.length ? "All states" : states.length === 1 ? states[0] : `${states.length} states`);

export function FeaturedCourses({ courses }: { courses: Course[] }) {
  if (!courses.length) return null;
  return (
    <section className={`${s.listSection} ${s.listAlt}`} aria-labelledby="courses-title">
      <div className="wrap">
        <SectionTop eyebrow="Start here" title="Featured courses" id="courses-title" href={routes.courses()} cta="All courses" />
        <ul className={s.cards}>
          {courses.slice(0, 6).map((c) => {
            const m = tradeMeta(c.trade);
            const { Icon } = m;
            return (
              <li key={c.id}>
                <Link href={routes.course(c.id)} className={s.courseCard}>
                  <span className={`${s.cover} ${c.cover_url ? "" : s.coverPlain}`} style={c.cover_url ? undefined : { background: m.soft, color: m.color }}>
                    {c.cover_url ? <img src={c.cover_url} alt="" loading="lazy" /> : <Icon aria-hidden="true" />}
                    <span className={s.price}>{c.is_free ? "Free" : money(c.price_cents)}</span>
                  </span>
                  <span className={s.cardBody}>
                    <TradeBadge trade={c.trade} short />
                    <b className={s.cardTitle}>{c.title}</b>
                    {c.subtitle && <span className={s.cardDesc}>{c.subtitle}</span>}
                    <span className={s.cardMeta}>
                      <span><MapPin aria-hidden="true" />{statesLabel(c.states)}</span>
                      {c.est_hours ? <span><Clock aria-hidden="true" />{c.est_hours} hrs</span> : null}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
