"use client";
// On-screen calculator like the one testing centers give you: basic four functions, square root, percent and memory.
// Works with the keyboard too (digits, + - * /, Enter, Backspace, Escape).
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import s from "./ExamSim.module.css";

type Op = "+" | "−" | "×" | "÷";
const apply = (a: number, b: number, op: Op) => (op === "+" ? a + b : op === "−" ? a - b : op === "×" ? a * b : b === 0 ? NaN : a / b);
const show = (n: number) => {
  if (!Number.isFinite(n)) return "Error";
  const r = Math.round(n * 1e10) / 1e10;
  const t = String(r);
  return t.length > 14 ? r.toPrecision(10).replace(/\.?0+(e|$)/, "$1") : t;
};

export function useCalc() {
  const [disp, setDisp] = useState("0");
  const [acc, setAcc] = useState<number | null>(null);
  const [op, setOp] = useState<Op | null>(null);
  const [fresh, setFresh] = useState(true);
  const [mem, setMem] = useState(0);
  const val = () => Number(disp) || 0;

  const press = useCallback((k: string) => {
    if (disp === "Error" && k !== "C") return;
    if (/^[0-9]$/.test(k)) { setDisp((d) => (fresh || d === "0" ? k : d.length < 14 ? d + k : d)); setFresh(false); return; }
    if (k === ".") { setDisp((d) => (fresh ? "0." : d.includes(".") ? d : d + ".")); setFresh(false); return; }
    if (k === "C") { setDisp("0"); setAcc(null); setOp(null); setFresh(true); return; }
    if (k === "CE") { setDisp("0"); setFresh(true); return; }
    if (k === "⌫") { setDisp((d) => (fresh || d.length <= 1 ? "0" : d.slice(0, -1))); return; }
    if (k === "±") { setDisp((d) => (d.startsWith("-") ? d.slice(1) : d === "0" ? d : "-" + d)); return; }
    if (k === "√") { setDisp(show(Math.sqrt(val()))); setFresh(true); return; }
    if (k === "%") { setDisp(show(acc !== null && op ? (acc * val()) / 100 : val() / 100)); setFresh(true); return; }
    if (k === "MC") { setMem(0); return; }
    if (k === "MR") { setDisp(show(mem)); setFresh(true); return; }
    if (k === "M+") { setMem((m) => m + val()); setFresh(true); return; }
    if (k === "M−") { setMem((m) => m - val()); setFresh(true); return; }
    if (k === "=") {
      if (acc === null || !op) return;
      setDisp(show(apply(acc, val(), op))); setAcc(null); setOp(null); setFresh(true); return;
    }
    if (["+", "−", "×", "÷"].includes(k)) {
      const cur = val();
      if (acc !== null && op && !fresh) { const r = apply(acc, cur, op); setAcc(r); setDisp(show(r)); }
      else if (acc === null) setAcc(cur);
      setOp(k as Op); setFresh(true);
    }
  }, [disp, fresh, acc, op, mem]); // eslint-disable-line react-hooks/exhaustive-deps

  return { disp, op, mem, press };
}

const KEYS = ["MC", "MR", "M+", "M−", "C", "CE", "⌫", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "±", "0", ".", "=", "√", "%"];

export default function Calculator({ onClose }: { onClose: () => void }) {
  const { disp, op, mem, press } = useCalc();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  function onKey(e: React.KeyboardEvent) {
    const map: Record<string, string> = { "*": "×", "/": "÷", "-": "−", "+": "+", Enter: "=", "=": "=", Backspace: "⌫", Escape: "C", Delete: "CE", ".": ".", "%": "%" };
    const k = /^[0-9]$/.test(e.key) ? e.key : map[e.key];
    if (k) { e.preventDefault(); e.stopPropagation(); press(k); }
  }
  return (
    <div className={s.calc} role="dialog" aria-label="Calculator" tabIndex={-1} ref={ref} onKeyDown={onKey}>
      <div className={s.calcTop}>
        <b>Calculator</b>
        <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Close calculator"><X aria-hidden="true" /></button>
      </div>
      <output className={s.calcDisp} aria-live="polite">
        <small>{mem ? "M" : ""}{op ? ` ${op}` : ""}</small>{disp}
      </output>
      <div className={s.calcKeys}>
        {KEYS.map((k) => (
          <button key={k} type="button" onClick={() => press(k)} data-kind={/^[0-9.]$/.test(k) ? "num" : k === "=" ? "eq" : ["+", "−", "×", "÷"].includes(k) ? "op" : "fn"}
            aria-label={{ "−": "minus", "×": "times", "÷": "divided by", "⌫": "backspace", "±": "plus or minus", "√": "square root", "M−": "memory minus" }[k] || k}>
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}
