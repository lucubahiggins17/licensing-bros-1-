"use client";
// Navy trade band + "Find your course" (sign plate, trade tiles and the Form CS-1 course selection form).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { routes } from "@/lib/nav";
import type { Trade } from "@/lib/types";
import { US_STATES } from "./states";
import { TRADE_META, TRADE_ORDER } from "./trades";
import s from "./Home.module.css";

export function TradeBand() {
  return (
    <section className={s.band} aria-label="Browse courses by trade">
      <div className="hazard" />
      <div className={`wrap ${s.bandInner}`}>
        {TRADE_ORDER.map((t) => {
          const { Icon, short } = TRADE_META[t];
          return (
            <Link key={t} href={routes.courses({ trade: t })} className={s.bandBtn}>
              <span className={s.bandIco}><Icon aria-hidden="true" /></span>
              <span className={s.bandLabel}>{short}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default function FindCourse() {
  const router = useRouter();
  const { profile } = useAuth();
  const [state, setState] = useState("");
  const [trade, setTrade] = useState<Trade | "">("");
  const [err, setErr] = useState<{ state?: boolean; trade?: boolean }>({});
  const touched = useRef(false);

  // Pre-fill from the student's profile until they pick something themselves
  useEffect(() => {
    if (!profile || touched.current) return;
    setState(profile.state || "");
    setTrade(profile.trade || "");
  }, [profile]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = { state: !state, trade: !trade };
    setErr(next);
    if (next.state || next.trade) {
      document.getElementById(next.state ? "cs1-state" : "cs1-trade")?.focus();
      return;
    }
    router.push(routes.courses({ state, trade }));
  }

  return (
    <section className={`blueprint ${s.find}`} aria-labelledby="find-title">
      <div className={`wrap ${s.findGrid}`}>
        <div className={s.findLeft}>
          <div className={`plate orange ${s.findPlate}`}>
            <span className="bolts" />
            <h2 id="find-title"><span aria-hidden="true">&#9888;&#xFE0E;</span> Find your course <span aria-hidden="true">&#9888;&#xFE0E;</span></h2>
            <span className={s.findPlateSub}>State &amp; trade specific training</span>
          </div>
          <p className={s.findText}>
            Every state tests a little differently. Pick your state and trade to see courses built for your exam and the code books your state uses.
          </p>
          <div className={s.tiles}>
            {TRADE_ORDER.map((t) => {
              const m = TRADE_META[t];
              const { Icon } = m;
              return (
                <Link key={t} href={routes.courses({ trade: t, ...(state ? { state } : {}) })} className={s.tile}>
                  <span className={s.tileChip} style={{ background: m.soft, color: m.color }}><Icon aria-hidden="true" /></span>
                  <span className={s.tileText}>
                    <b>{m.label}</b>
                    <small>{m.blurb}</small>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        <form className={`formcs ${s.form}`} onSubmit={submit} noValidate aria-labelledby="cs1-title">
          <div className="hazard" />
          <div className="formhead">
            <div className={s.formHeadRow}>
              <span className={s.docIco}><FileText aria-hidden="true" /></span>
              <div>
                <span className="label">Form CS-1</span>
                <b id="cs1-title" className={s.formTitle}>Course selection form</b>
              </div>
            </div>
            <p className={s.formNote}>Complete all required fields below <span className="req" aria-hidden="true">*</span></p>
          </div>
          <div className="formbody">
            <label className="field" htmlFor="cs1-state">
              <span><span className="stepnum">1</span>Your state <span className="req" aria-hidden="true">*</span></span>
              <select id="cs1-state" value={state} required aria-required="true" aria-invalid={err.state || undefined} aria-describedby={err.state ? "cs1-state-err" : undefined}
                onChange={(e) => { touched.current = true; setState(e.target.value); setErr((x) => ({ ...x, state: false })); }}>
                <option value="">Select your state</option>
                {US_STATES.map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
              {err.state && <span id="cs1-state-err" className={s.fieldErr}>Pick the state where you&rsquo;re getting licensed.</span>}
            </label>
            <label className="field" htmlFor="cs1-trade">
              <span><span className="stepnum">2</span>Trade specialization <span className="req" aria-hidden="true">*</span></span>
              <select id="cs1-trade" value={trade} required aria-required="true" aria-invalid={err.trade || undefined} aria-describedby={err.trade ? "cs1-trade-err" : undefined}
                onChange={(e) => { touched.current = true; setTrade(e.target.value as Trade | ""); setErr((x) => ({ ...x, trade: false })); }}>
                <option value="">Select your trade</option>
                {TRADE_ORDER.map((t) => <option key={t} value={t}>{TRADE_META[t].label}</option>)}
              </select>
              {err.trade && <span id="cs1-trade-err" className={s.fieldErr}>Pick your trade.</span>}
            </label>
            <button type="submit" className={`btn navy cta block ${s.submit}`}>Submit course request <ChevronRight aria-hidden="true" /></button>
          </div>
        </form>
      </div>
    </section>
  );
}
