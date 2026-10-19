"use client";
// Catalog course card + branded cover art used when a course has no cover image.
import Link from "next/link";
import { ArrowRight, BadgeCheck, BookOpen, Clock, Eye, MapPin } from "lucide-react";
import { routes } from "@/lib/nav";
import type { TradeOrAll } from "@/lib/types";
import { TRADE_META, hoursLabel, isFreeCourse, priceLabel, statesLabel, type CatalogCourse } from "./courseData";
import s from "./CourseCard.module.css";

export function CoverArt({ trade, className = "" }: { trade: TradeOrAll; className?: string }) {
  const meta = TRADE_META[trade] || TRADE_META.all;
  const Icon = meta.Icon;
  return (
    <div className={`${s.art} ${className}`} aria-hidden="true">
      <Icon className={s.artGhost} />
      <span className={s.artIcon}><Icon /></span>
      <span className={s.artLabel}>{meta.label}</span>
      <span className={s.artTape} />
    </div>
  );
}

export function CourseCover({ url, trade, className = "" }: { url: string | null; trade: TradeOrAll; className?: string }) {
  return url
    ? <img className={`${s.coverImg} ${className}`} src={url} alt="" loading="lazy" decoding="async" />
    : <CoverArt trade={trade} className={className} />;
}

export default function CourseCard({ course, owned, isAdmin }: { course: CatalogCourse; owned: boolean; isAdmin?: boolean }) {
  const meta = TRADE_META[course.trade] || TRADE_META.all;
  const TradeIcon = meta.Icon;
  const hours = hoursLabel(course.est_hours);
  const free = isFreeCourse(course);
  return (
    <Link href={routes.course(course.id)} className={s.card}>
      <div className={s.cover}>
        <CourseCover url={course.cover_url} trade={course.trade} />
        <span className={s.tradeBadge}><TradeIcon aria-hidden="true" /> {meta.short}</span>
        {owned && <span className={s.owned}><BadgeCheck aria-hidden="true" /> Owned</span>}
        {isAdmin && !course.published && <span className={`badge warn ${s.draft}`}>Draft (admins only)</span>}
      </div>
      <div className={s.body}>
        <h3 className={s.title}>{course.title}</h3>
        {course.subtitle && <p className={s.sub}>{course.subtitle}</p>}
        <ul className={s.meta}>
          {hours && <li><Clock aria-hidden="true" /> {hours}</li>}
          <li><BookOpen aria-hidden="true" /> {course.lessonCount} {course.lessonCount === 1 ? "lesson" : "lessons"}</li>
          <li title={course.states?.length ? course.states.join(", ") : undefined}><MapPin aria-hidden="true" /> {statesLabel(course.states)}</li>
        </ul>
        <div className={s.tags}>
          {course.level && <span className="badge">{course.level}</span>}
          {!free && !owned && course.previewCount > 0 && <span className="badge ai"><Eye aria-hidden="true" /> Preview lessons</span>}
        </div>
        <div className={s.foot}>
          <span className={`${s.price} ${free ? s.free : ""}`}>{priceLabel(course)}</span>
          <span className={s.go}>{owned ? "Continue" : free ? "Start free" : "View course"} <ArrowRight aria-hidden="true" /></span>
        </div>
      </div>
    </Link>
  );
}

export function CourseCardSkeleton() {
  return (
    <div className={s.skel} aria-hidden="true">
      <div className={s.skelCover} />
      <div className={s.skelBody}>
        <i style={{ width: "80%" }} />
        <i style={{ width: "55%" }} />
        <i style={{ width: "35%", height: 22, marginTop: 10 }} />
      </div>
    </div>
  );
}
