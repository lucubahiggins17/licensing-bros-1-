"use client";
import { useState } from "react";
import { PanelHead } from "./ctx";

const CM: Record<string, number> = { "14": 4110, "12": 6530, "10": 10380, "8": 16510, "6": 26240, "4": 41740, "3": 52620, "2": 66360, "1": 83690, "1/0": 105600, "2/0": 133100, "3/0": 167800, "4/0": 211600 };
const f = (n: number, d = 2) => (Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d }) : "—");
const num = (s: string) => { const v = parseFloat(s); return Number.isFinite(v) ? v : null; };

function F({ id, label, value, set }: { id: string; label: string; value: string; set: (v: string) => void }) {
  return <label htmlFor={id}>{label}<input id={id} type="number" inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} /></label>;
}

function Ohm() {
  const [v, setV] = useState({ E: "", I: "", R: "", P: "" });
  const [out, setOut] = useState("E = I × R · P = E × I");
  function solve() {
    let E = num(v.E), I = num(v.I), R = num(v.R), P = num(v.P);
    if ([E, I, R, P].filter((x) => x !== null).length < 2) { setOut("Enter any two values."); return; }
    if (E !== null && I !== null) { R = E / I; P = E * I; }
    else if (E !== null && R !== null) { I = E / R; P = E * I; }
    else if (E !== null && P !== null) { I = P / E; R = E / I; }
    else if (I !== null && R !== null) { E = I * R; P = E * I; }
    else if (I !== null && P !== null) { E = P / I; R = E / I; }
    else if (R !== null && P !== null) { E = Math.sqrt(P * R); I = E / R; }
    setOut(`E = ${f(E!)} V\nI = ${f(I!)} A\nR = ${f(R!)} Ω\nP = ${f(P!)} W`);
  }
  return (
    <div className="card calc">
      <h3 style={{ fontSize: 22 }}>Ohm's law &amp; power</h3><p className="note">Fill in any two.</p>
      <div className="fields">
        <F id="oE" label="Volts" value={v.E} set={(x) => setV({ ...v, E: x })} />
        <F id="oI" label="Amps" value={v.I} set={(x) => setV({ ...v, I: x })} />
        <F id="oR" label="Ohms" value={v.R} set={(x) => setV({ ...v, R: x })} />
        <F id="oP" label="Watts" value={v.P} set={(x) => setV({ ...v, P: x })} />
      </div>
      <div className="row" style={{ marginTop: 8 }}><button className="btn sm" onClick={solve}>Solve</button><button className="btn sm" onClick={() => { setV({ E: "", I: "", R: "", P: "" }); setOut("E = I × R · P = E × I"); }}>Clear</button></div>
      <div className="out" style={{ whiteSpace: "pre-line" }}>{out}</div>
    </div>
  );
}

function VDrop() {
  const [K, setK] = useState("12.9"); const [size, setSize] = useState("12");
  const [I, setI] = useState("16"); const [L, setL] = useState("100"); const [E, setE] = useState("120");
  const cm = CM[size], d = (2 * Number(K) * (num(I) || 0) * (num(L) || 0)) / cm, pct = (100 * d) / (num(E) || 120);
  return (
    <div className="card calc">
      <h3 style={{ fontSize: 22 }}>Voltage drop (single-phase)</h3><p className="note">VD = 2 × K × I × L ÷ CM <span className="ref">NEC Ch. 9 Table 8</span></p>
      <div className="fields">
        <label htmlFor="vK">Conductor<select id="vK" value={K} onChange={(e) => setK(e.target.value)}><option value="12.9">Copper (K 12.9)</option><option value="21.2">Aluminum (K 21.2)</option></select></label>
        <label htmlFor="vS">Size<select id="vS" value={size} onChange={(e) => setSize(e.target.value)}>{Object.keys(CM).map((k) => <option key={k} value={k}>{k} AWG</option>)}</select></label>
        <F id="vI" label="Amps" value={I} set={setI} /><F id="vL" label="One-way ft" value={L} set={setL} /><F id="vE" label="Volts" value={E} set={setE} />
      </div>
      <div className="out">VD = 2 × {K} × {I || 0} × {L || 0} ÷ {cm.toLocaleString()} = <b>{f(d)} V</b> ({f(pct, 1)}%)<br />{pct <= 3 ? "Within the 3% branch-circuit recommendation" : "Over 3%: consider upsizing"} <span className="note">(informational note, 210.19)</span></div>
    </div>
  );
}

function Heat() {
  const [C, setC] = useState("1200"); const [T, setT] = useState("20");
  const q = 1.08 * (num(C) || 0) * (num(T) || 0);
  return (
    <div className="card calc">
      <h3 style={{ fontSize: 22 }}>Sensible heat &amp; tonnage</h3><p className="note">Btu/h = 1.08 × CFM × ΔT · 1 ton = 12,000 Btu/h</p>
      <div className="fields"><F id="hC" label="CFM" value={C} set={setC} /><F id="hT" label="ΔT °F" value={T} set={setT} /></div>
      <div className="out">1.08 × {C || 0} × {T || 0} = <b>{f(q, 0)} Btu/h</b> = {f(q / 12000)} tons</div>
    </div>
  );
}

function Slope() {
  const [s, setS] = useState("0.25"); const [L, setL] = useState("40");
  const d = Number(s) * (num(L) || 0);
  return (
    <div className="card calc">
      <h3 style={{ fontSize: 22 }}>Drain slope fall</h3><p className="note">2½ in and smaller: ¼ in/ft · 3–6 in: ⅛ in/ft <span className="ref">IPC 2021 Table 704.1</span></p>
      <div className="fields">
        <label htmlFor="sD">Pipe size<select id="sD" value={s} onChange={(e) => setS(e.target.value)}><option value="0.25">2½ in or less (¼″/ft)</option><option value="0.125">3–6 in (⅛″/ft)</option><option value="0.0625">8 in and up (1⁄16″/ft)</option></select></label>
        <F id="sL" label="Run (ft)" value={L} set={setL} />
      </div>
      <div className="out">{L || 0} ft × {s} in/ft = <b>{f(d, 3)} in</b> of fall ({f(d / 12, 3)} ft)</div>
    </div>
  );
}

function Margin() {
  const [c, setC] = useState("80000"); const [s, setS] = useState("100000");
  const C = num(c) || 0, Sv = num(s) || 0, pr = Sv - C;
  return (
    <div className="card calc">
      <h3 style={{ fontSize: 22 }}>Markup vs. margin</h3><p className="note">A Business &amp; Law favorite. Enter cost and selling price.</p>
      <div className="fields"><F id="mC" label="Cost $" value={c} set={setC} /><F id="mS" label="Sell $" value={s} set={setS} /></div>
      <div className="out">{C && Sv ? <>Profit ${f(pr)}<br />Markup = {f(pr)} ÷ {f(C)} = <b>{f((100 * pr) / C, 1)}%</b><br />Margin = {f(pr)} ÷ {f(Sv)} = <b>{f((100 * pr) / Sv, 1)}%</b></> : "Enter cost and selling price."}</div>
    </div>
  );
}

function Concrete() {
  const [L, setL] = useState("30"); const [W, setW] = useState("20"); const [T, setT] = useState("4");
  const ft = ((num(L) || 0) * (num(W) || 0) * (num(T) || 0)) / 12;
  return (
    <div className="card calc">
      <h3 style={{ fontSize: 22 }}>Concrete</h3><p className="note">27 ft³ per yd³</p>
      <div className="fields"><F id="cL" label="Length ft" value={L} set={setL} /><F id="cW" label="Width ft" value={W} set={setW} /><F id="cT" label="Thick in" value={T} set={setT} /></div>
      <div className="out">{L || 0} × {W || 0} × {T || 0}/12 = {f(ft, 1)} ft³ ÷ 27 = <b>{f(ft / 27)} yd³</b><br />With 10% waste: {f((ft / 27) * 1.1)} yd³</div>
    </div>
  );
}

export default function Calcs() {
  return (
    <section className="panel">
      <PanelHead eyebrow="Field Calcs" title="Field" accent="calculators" lede="The formulas the exam leans on, with the work shown so you can check your own math." />
      <div className="grid2"><Ohm /><VDrop /><Heat /><Slope /><Margin /><Concrete /></div>
    </section>
  );
}
