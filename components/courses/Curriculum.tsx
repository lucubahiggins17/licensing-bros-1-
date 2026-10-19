"use client";
// Course outline: modules → lessons with lock icons, "Free preview" tags, completed checks and durations.
import Link from "next/link";
import { CirclePlay, FileText, ListChecks, Lock, CircleCheck, ChevronDown } from "lucide-react";
import { routes } from "@/lib/nav";
import type { Lesson } from "@/lib/types";
import { minutesLabel, type LessonGroup, type ProgressMap } from "./courseData";
import s from "./Curriculum.module.css";

const KIND_ICON = { video: CirclePlay, text: FileText, quiz: ListChecks } as const;
const KIND_WORD = { video: "Video", text: "Reading", quiz: "Quiz" } as const;

type Props = {
  groups: LessonGroup[];
  progress: ProgressMap;
  /** Owns the course, course is free, or admin */
  hasAccess: boolean;
  /** Show "Free preview" tags (paid course the student doesn't own) */
  showPreviewTags: boolean;
  currentId?: string;
  variant?: "full" | "compact";
  onNavigate?: () => void;
};

export default function Curriculum({ groups, progress, hasAccess, showPreviewTags, currentId, variant = "full", onNavigate }: Props) {
  let n = 0;
  const numbered = groups.map((g) => ({ ...g, rows: g.lessons.map((l) => ({ l, num: ++n })) }));

  if (!n) return <p className="empty" style={{ margin: 0 }}>Lessons are being added. Check back soon.</p>;

  const row = (l: Lesson, num: number) => {
    const unlocked = hasAccess || l.is_preview;
    const done = !!progress[l.id]?.completed;
    const current = l.id === currentId;
    const Icon = done ? CircleCheck : unlocked ? KIND_ICON[l.kind] || CirclePlay : Lock;
    const mins = minutesLabel(l.duration_min);
    const cls = `${s.row} ${current ? s.current : ""} ${done ? s.done : ""} ${unlocked ? "" : s.locked}`;
    const inner = (
      <>
        <span className={s.ico} aria-hidden="true"><Icon /></span>
        <span className={s.text}>
          <span className={s.title}><span className={s.num}>{num}.</span> {l.title}</span>
          <span className={s.meta}>
            <span>{KIND_WORD[l.kind] || "Lesson"}</span>
            {mins && <span>{mins}</span>}
            {showPreviewTags && l.is_preview && <span className="badge free">Free preview</span>}
            {done && <span className={s.sr}>Completed</span>}
            {!unlocked && <span className={s.sr}>Locked. Buy the course to unlock.</span>}
            {current && <span className={s.sr}>Current lesson</span>}
          </span>
        </span>
      </>
    );
    return (
      <li key={l.id}>
        {unlocked ? (
          <Link href={routes.lesson(l.id)} className={cls} aria-current={current ? "page" : undefined} onClick={onNavigate}>{inner}</Link>
        ) : (
          <div className={cls}>{inner}</div>
        )}
      </li>
    );
  };

  if (variant === "compact") {
    return (
      <div className={`${s.list} ${s.compact}`}>
        {numbered.map((g) => (
          <div key={g.id} className={s.cgroup}>
            {g.title && <p className={s.cgroupTitle}>{g.title}</p>}
            <ol className={s.rows}>{g.rows.map(({ l, num }) => row(l, num))}</ol>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={s.list}>
      {numbered.map((g, gi) => {
        if (!g.title) return <ol key={g.id} className={`${s.rows} ${s.flat}`}>{g.rows.map(({ l, num }) => row(l, num))}</ol>;
        const done = g.lessons.filter((l) => progress[l.id]?.completed).length;
        const mins = g.lessons.reduce((m, l) => m + (l.duration_min || 0), 0);
        return (
          <details key={g.id} className={s.group} open>
            <summary className={s.summary}>
              <span className={s.modNum}>{g.id === "loose" ? "+" : String(gi + 1).padStart(2, "0")}</span>
              <span className={s.modText}>
                <b>{g.title}</b>
                <span className={s.modMeta}>
                  {g.lessons.length} {g.lessons.length === 1 ? "lesson" : "lessons"}
                  {mins ? ` · ${minutesLabel(mins)}` : ""}
                  {hasAccess && done ? ` · ${done}/${g.lessons.length} done` : ""}
                </span>
              </span>
              <ChevronDown className={s.chev} aria-hidden="true" />
            </summary>
            <ol className={s.rows}>{g.rows.map(({ l, num }) => row(l, num))}</ol>
          </details>
        );
      })}
    </div>
  );
}
