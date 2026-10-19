"use client";
// Form fields used across the admin editors.
import { useId, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bold, Heading, ImagePlus, Italic, Link2, List, ListOrdered, Plus, Quote, Trash2, Upload, X } from "lucide-react";
import { STATES } from "@/lib/data";
import { renderMarkdown } from "./markdown";
import { uploadPublicImage } from "./storage";
import { errMsg } from "./format";
import { useAdmin } from "./ui";
import s from "./admin.module.css";

// ------------------------------------------------------------------------------------------------
export function MoveButtons({ onUp, onDown, upDisabled, downDisabled, what = "item", disabled }: {
  onUp: () => void; onDown: () => void; upDisabled?: boolean; downDisabled?: boolean; what?: string; disabled?: boolean;
}) {
  return (
    <span className={s.moveBtns}>
      <button type="button" className={s.iconBtn} onClick={onUp} disabled={disabled || upDisabled} aria-label={`Move ${what} up`} title="Move up"><ArrowUp /></button>
      <button type="button" className={s.iconBtn} onClick={onDown} disabled={disabled || downDisabled} aria-label={`Move ${what} down`} title="Move down"><ArrowDown /></button>
    </span>
  );
}

// ------------------------------------------------------------------------------------------------
export function CoverUpload({ value, onChange, folder, label = "Cover image" }: {
  value: string | null; onChange: (url: string | null) => void; folder: string; label?: string;
}) {
  const { toast } = useAdmin();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function pick(f: File) {
    setBusy(true);
    try {
      const url = await uploadPublicImage(f, folder);
      onChange(url);
      toast("Image uploaded. Save to keep it.", "info");
    } catch (e) { toast(errMsg(e), "bad"); }
    setBusy(false);
  }
  return (
    <div className={s.cover}>
      <div className={s.coverBox}>
        {value ? <img src={value} alt={`${label} preview`} /> : <span className={s.coverEmpty}><ImagePlus aria-hidden="true" />No image yet</span>}
        {busy && <span className={s.coverBusy}><span className="spin" aria-hidden="true" /> Uploading…</span>}
      </div>
      <div className={s.coverSide}>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pick(f); }} />
        <div className="row">
          <button type="button" className="btn sm" onClick={() => input.current?.click()} disabled={busy}>
            <Upload aria-hidden="true" />{busy ? "Uploading…" : value ? "Replace image" : "Upload image"}
          </button>
          {value && <button type="button" className="btn sm ghost" onClick={() => onChange(null)} disabled={busy}><X aria-hidden="true" />Remove</button>}
        </div>
        <span className="note">A wide picture (16:9), about 1280 × 720. JPG or PNG under 2 MB loads fastest.</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
/** Pick states. An empty list means "every state". */
export function StatePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [some, setSome] = useState(value.length > 0);
  const [filter, setFilter] = useState("");
  const picked = new Set(value);
  const shown = STATES.filter((st) => st.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = (st: string) => {
    const n = new Set(picked);
    if (n.has(st)) n.delete(st); else n.add(st);
    onChange(STATES.filter((x) => n.has(x)));
  };
  const showList = some || value.length > 0;
  return (
    <div className={s.statePicker}>
      <div className="seg" role="group" aria-label="Which states">
        <button type="button" aria-pressed={!showList} onClick={() => { onChange([]); setSome(false); }}>All states</button>
        <button type="button" aria-pressed={showList} onClick={() => setSome(true)}>Only some states</button>
      </div>
      {showList && (
        <div className={s.stateBox}>
          {value.length > 0 && (
            <div className={s.stateChips} aria-label="Picked states">
              {value.map((st) => (
                <button key={st} type="button" className={s.stateChip} onClick={() => toggle(st)} aria-label={`Remove ${st}`}>
                  {st}<X aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
          <div className="row">
            <input className="input" style={{ flex: "1 1 180px", width: "auto" }} placeholder="Find a state" value={filter}
              onChange={(e) => setFilter(e.target.value)} aria-label="Find a state" />
            <span className="note">{value.length ? `${value.length} selected` : "None picked yet (counts as all states)"}</span>
            {value.length > 0 && <button type="button" className="btn sm ghost" onClick={() => onChange([])}>Clear</button>}
          </div>
          <div className={s.stateGrid}>
            {shown.map((st) => (
              <label key={st} className={`${s.stateItem} ${picked.has(st) ? s.stateOn : ""}`}>
                <input type="checkbox" checked={picked.has(st)} onChange={() => toggle(st)} /> {st}
              </label>
            ))}
            {!shown.length && <span className="note">No state matches “{filter}”.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
/** Edit a list of short text lines (add / edit / reorder / remove). */
export function ListEditor({ items, onChange, placeholder, addLabel = "Add a line", max = 20, what = "line" }: {
  items: string[]; onChange: (v: string[]) => void; placeholder?: string; addLabel?: string; max?: number; what?: string;
}) {
  const update = (i: number, v: string) => onChange(items.map((x, k) => (k === i ? v : x)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const n = [...items];
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n);
  };
  return (
    <div className={s.listEd}>
      {items.length === 0 && <p className="note" style={{ margin: 0 }}>Nothing here yet.</p>}
      {items.map((it, i) => (
        <div key={i} className={s.listRow}>
          <span className={s.listNum} aria-hidden="true">{i + 1}</span>
          <input className="input" value={it} placeholder={placeholder} onChange={(e) => update(i, e.target.value)} aria-label={`${what} ${i + 1}`} />
          <MoveButtons what={what} onUp={() => move(i, -1)} onDown={() => move(i, 1)} upDisabled={i === 0} downDisabled={i === items.length - 1} />
          <button type="button" className={s.iconBtn} onClick={() => onChange(items.filter((_, k) => k !== i))} aria-label={`Remove ${what} ${i + 1}`} title="Remove"><Trash2 /></button>
        </div>
      ))}
      <div><button type="button" className="btn sm" onClick={() => onChange([...items, ""])} disabled={items.length >= max}><Plus aria-hidden="true" />{addLabel}</button></div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
/** Four answer choices with a "correct answer" radio. */
export function ChoiceRows({ choices, answer, onChoices, onAnswer, legend = "Answer choices — tap the circle next to the correct one" }: {
  choices: string[]; answer: number; onChoices: (c: string[]) => void; onAnswer: (a: number) => void; legend?: string;
}) {
  const name = useId();
  const four = [0, 1, 2, 3].map((k) => choices[k] ?? "");
  return (
    <fieldset className={s.choices}>
      <legend className="label">{legend}</legend>
      {four.map((c, k) => (
        <div key={k} className={`${s.choice} ${answer === k ? s.choiceRight : ""}`}>
          <label className={s.choiceRadio} title="Mark as the correct answer">
            <input type="radio" name={name} checked={answer === k} onChange={() => onAnswer(k)} aria-label={`Choice ${"ABCD"[k]} is correct`} />
            <b>{"ABCD"[k]}</b>
          </label>
          <input className="input" value={c} placeholder={`Choice ${"ABCD"[k]}`} aria-label={`Choice ${"ABCD"[k]} text`}
            onChange={(e) => { const n = [...four]; n[k] = e.target.value; onChoices(n); }} />
          {answer === k && <span className={s.correctTag}>Correct</span>}
        </div>
      ))}
    </fieldset>
  );
}

// ------------------------------------------------------------------------------------------------
/** Markdown textarea with a small formatting toolbar and a live preview. */
export function MarkdownEditor({ value, onChange, label = "Lesson notes", rows = 14 }: {
  value: string; onChange: (v: string) => void; label?: string; rows?: number;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const [tab, setTab] = useState<"write" | "preview">("write");
  const html = useMemo(() => renderMarkdown(value), [value]);

  const reselect = (a: number, b: number) => requestAnimationFrame(() => { const el = ta.current; if (el) { el.focus(); el.setSelectionRange(a, b); } });
  function wrap(before: string, after = before, placeholder = "text") {
    const el = ta.current;
    if (!el) return;
    const a = el.selectionStart, b = el.selectionEnd;
    const sel = value.slice(a, b) || placeholder;
    onChange(value.slice(0, a) + before + sel + after + value.slice(b));
    reselect(a + before.length, a + before.length + sel.length);
  }
  function prefixLines(make: (i: number) => string) {
    const el = ta.current;
    if (!el) return;
    const a = el.selectionStart, b = el.selectionEnd;
    const start = value.lastIndexOf("\n", a - 1) + 1;
    const block = value.slice(start, b) || "";
    const lines = (block || "").split("\n").map((l, i) => make(i) + l);
    const next = value.slice(0, start) + lines.join("\n") + value.slice(Math.max(b, start));
    onChange(next);
    reselect(start, start + lines.join("\n").length);
  }
  function link() {
    const el = ta.current;
    if (!el) return;
    const a = el.selectionStart, b = el.selectionEnd;
    const sel = value.slice(a, b) || "link text";
    const ins = `[${sel}](https://)`;
    onChange(value.slice(0, a) + ins + value.slice(b));
    reselect(a + sel.length + 3, a + sel.length + 11);
  }

  const tools: [string, any, () => void][] = [
    ["Bold", Bold, () => wrap("**")],
    ["Italic", Italic, () => wrap("*")],
    ["Heading", Heading, () => prefixLines(() => "## ")],
    ["Bulleted list", List, () => prefixLines(() => "- ")],
    ["Numbered list", ListOrdered, () => prefixLines((i) => `${i + 1}. `)],
    ["Quote", Quote, () => prefixLines(() => "> ")],
    ["Link", Link2, link]
  ];

  return (
    <div className={s.mdEditor}>
      <div className={s.mdBar}>
        <label className="label" htmlFor={id}>{label}</label>
        <div className={s.mdTools} role="toolbar" aria-label="Formatting">
          {tools.map(([name, Icon, fn]) => (
            <button key={name} type="button" className={s.mdTool} onClick={() => { setTab("write"); setTimeout(fn, 0); }} aria-label={name} title={name}><Icon aria-hidden="true" /></button>
          ))}
        </div>
        <div className={`seg ${s.mdTabs}`} role="group" aria-label="Show">
          <button type="button" aria-pressed={tab === "write"} onClick={() => setTab("write")}>Write</button>
          <button type="button" aria-pressed={tab === "preview"} onClick={() => setTab("preview")}>Preview</button>
        </div>
      </div>
      <div className={`${s.mdPanes} ${tab === "preview" ? s.showPreview : s.showWrite}`}>
        <textarea id={id} ref={ta} className={s.mdText} rows={rows} value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={"## Key idea\nWrite the lesson notes here.\n\n- Use dashes for a list\n- **Bold** the numbers students must remember"} />
        <div className={s.mdPreview} aria-label="Preview" aria-live="polite">
          <div className="label" style={{ marginBottom: 8 }}>Preview — what students see</div>
          {value.trim() ? <div className={s.md} dangerouslySetInnerHTML={{ __html: html }} /> : <p className="empty" style={{ margin: 0 }}>Start typing and the preview shows here.</p>}
        </div>
      </div>
      <p className="note" style={{ margin: 0 }}>Shortcuts: <code>**bold**</code>, <code>## Heading</code>, <code>- list</code>, <code>[link](https://…)</code>, <code>| tables |</code>.</p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
export function UploadProgress({ pct, name, onCancel }: { pct: number; name: string; onCancel?: () => void }) {
  return (
    <div className={s.progress} role="status" aria-live="polite">
      <div className={s.progressTop}>
        <span className={s.progressName}><Upload aria-hidden="true" /> Uploading {name}</span>
        <b>{pct}%</b>
      </div>
      <div className="bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
      <div className="row between">
        <span className="note">Keep this page open until it finishes.</span>
        {onCancel && <button type="button" className="btn sm ghost" onClick={onCancel}>Cancel upload</button>}
      </div>
    </div>
  );
}
