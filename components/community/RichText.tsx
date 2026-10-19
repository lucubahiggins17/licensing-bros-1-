"use client";
// Tiny, safe formatter for AI replies: paragraphs, bullet/numbered lists, **bold**, `code`, [links](https://…) and bare URLs.
// Builds React elements only (no innerHTML).
import { Fragment, type ReactNode } from "react";

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"’])/g;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of Array.from(text.matchAll(INLINE))) {
    const tok = m[0];
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const mm = /^\[([^\]]+)\]\((.+)\)$/.exec(tok);
      out.push(<a key={k} href={mm?.[2]} target="_blank" rel="noopener noreferrer">{mm?.[1]}</a>);
    } else out.push(<a key={k} href={tok} target="_blank" rel="noopener noreferrer">{tok.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}</a>);
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,4}\s+(.*)$/;

export default function RichText({ text, className }: { text: string; className?: string }) {
  const lines = (text || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushPara = () => {
    if (!para.length) return;
    const k = `p${blocks.length}`;
    blocks.push(<p key={k}>{para.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l, `${k}-${i}`)}</Fragment>)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const k = `l${blocks.length}`;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, `${k}-${i}`)}</li>);
    blocks.push(list.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const b = BULLET.exec(line);
    const n = b ? null : NUMBER.exec(line);
    const h = HEADING.exec(line);
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (b || n) {
      flushPara();
      const ordered = !!n;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((b || n)![1]);
      continue;
    }
    flushList();
    if (h) { flushPara(); blocks.push(<p key={`h${blocks.length}`}><strong>{inline(h[1], `h${blocks.length}`)}</strong></p>); continue; }
    para.push(line);
  }
  flushPara();
  flushList();
  return <div className={className}>{blocks}</div>;
}
