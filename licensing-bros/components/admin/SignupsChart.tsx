"use client";
// New accounts per day for the last 30 days: inline SVG bars drawn to scale, with labeled axes,
// a hover/keyboard tooltip and a screen-reader table. Sized to its container so text never shrinks on phones.
import { useEffect, useMemo, useRef, useState } from "react";
import s from "./admin.module.css";

type Pt = { key: string; label: string; long: string; n: number };
const H = 240;
const M = { l: 46, r: 12, t: 18, b: 48 };

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export default function SignupsChart({ data }: { data: { day: string; n: number }[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  const [hi, setHi] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setW(Math.max(280, Math.round(el.clientWidth)));
    measure();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 30 calendar days (UTC, the same days the database groups by), oldest first, missing days = 0
  const pts = useMemo<Pt[]>(() => {
    const map = new Map<string, number>();
    for (const d of data || []) {
      const k = String(d.day).slice(0, 10);
      map.set(k, (map.get(k) || 0) + (Number(d.n) || 0));
    }
    const now = new Date();
    const out: Pt[] = [];
    for (let k = 29; k >= 0; k--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - k));
      const key = d.toISOString().slice(0, 10);
      out.push({
        key,
        n: map.get(key) || 0,
        label: d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
        long: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
      });
    }
    return out;
  }, [data]);

  const max = Math.max(0, ...pts.map((p) => p.n));
  const step = max <= 4 ? 1 : niceStep(max / 4);
  const top = max <= 4 ? 4 : Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const total = pts.reduce((a, p) => a + p.n, 0);

  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const slot = pw / pts.length;
  const bw = Math.max(3, Math.min(16, slot * 0.64));
  const base = M.t + ph;
  const y = (v: number) => base - (v / top) * ph;
  const fmtTick = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}K` : String(v));

  const barPath = (i: number, v: number) => {
    const x = M.l + i * slot + (slot - bw) / 2;
    const yt = y(v);
    const h = base - yt;
    const r = Math.min(4, bw / 2, h);
    return `M${x},${base}V${yt + r}Q${x},${yt} ${x + r},${yt}H${x + bw - r}Q${x + bw},${yt} ${x + bw},${yt + r}V${base}Z`;
  };

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const i = Math.floor((x - M.l) / slot);
    setHi(i >= 0 && i < pts.length ? i : null);
  }
  function onKey(e: React.KeyboardEvent) {
    const last = pts.length - 1;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1;
      setHi((h) => Math.max(0, Math.min(last, (h ?? (d > 0 ? -1 : last + 1)) + d)));
    } else if (e.key === "Home") { e.preventDefault(); setHi(0); }
    else if (e.key === "End") { e.preventDefault(); setHi(last); }
    else if (e.key === "Escape") setHi(null);
  }

  // x labels every 7 days, ending today
  const labelAt = new Set([29, 22, 15, 8, 1]);
  const tip = hi !== null ? pts[hi] : null;
  const tipLeft = hi !== null ? Math.max(56, Math.min(W - 56, M.l + (hi + 0.5) * slot)) : 0;
  const tipTop = tip ? Math.max(M.t, y(tip.n)) : 0;

  return (
    <div className={s.chart} ref={wrap}>
      <p className={s.chartSum}><b>{total.toLocaleString()}</b> new {total === 1 ? "account" : "accounts"} in the last 30 days</p>
      <div className={s.chartStage}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className={s.chartSvg} role="img" tabIndex={0}
          aria-label={`Bar chart of new accounts per day for the last 30 days, ${total} in total. Use the left and right arrow keys to read each day.`}
          onPointerMove={onMove} onPointerLeave={() => setHi(null)} onKeyDown={onKey} onBlur={() => setHi(null)}>
          {/* gridlines + y ticks */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className={t === 0 ? s.axisLine : s.gridLine} />
              <text x={M.l - 8} y={y(t) + 4} textAnchor="end" className={s.tickText}>{fmtTick(t)}</text>
            </g>
          ))}
          {/* hovered column wash */}
          {hi !== null && <rect x={M.l + hi * slot} y={M.t} width={slot} height={ph} className={s.colWash} />}
          {/* bars */}
          {pts.map((p, i) => p.n > 0 && <path key={p.key} d={barPath(i, p.n)} className={hi === i ? s.barHi : s.bar} />)}
          {/* x labels */}
          {pts.map((p, i) => labelAt.has(i) && (
            <g key={p.key}>
              <line x1={M.l + (i + 0.5) * slot} x2={M.l + (i + 0.5) * slot} y1={base} y2={base + 4} className={s.axisLine} />
              <text x={M.l + (i + 0.5) * slot} y={base + 18} textAnchor="middle" className={s.tickText}>{p.label}</text>
            </g>
          ))}
          {/* axis titles */}
          <text x={14} y={M.t + ph / 2} transform={`rotate(-90 14 ${M.t + ph / 2})`} textAnchor="middle" className={s.axisTitle}>Signups</text>
          <text x={M.l + pw / 2} y={H - 8} textAnchor="middle" className={s.axisTitle}>Day (last 30 days)</text>
        </svg>
        {tip && (
          <div className={s.chartTip} style={{ left: tipLeft, top: tipTop }} aria-hidden="true">
            <b>{tip.n} {tip.n === 1 ? "signup" : "signups"}</b>
            <span>{tip.long}</span>
          </div>
        )}
      </div>
      <div className={s.srOnly} aria-live="polite">{tip ? `${tip.long}: ${tip.n} ${tip.n === 1 ? "signup" : "signups"}` : ""}</div>
      <div className={s.srOnly}>
        <table>
          <caption>New accounts per day, last 30 days</caption>
          <thead><tr><th scope="col">Day</th><th scope="col">Signups</th></tr></thead>
          <tbody>{pts.map((p) => <tr key={p.key}><td>{p.long}</td><td>{p.n}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
