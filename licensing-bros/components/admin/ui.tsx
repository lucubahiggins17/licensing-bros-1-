"use client";
// Building blocks shared by every admin section: context (toasts, unsaved-changes guard, navigation),
// switches, two-step confirm buttons, a side drawer, empty/loading states and section headings.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import s from "./admin.module.css";

export type SectionKey = "dashboard" | "courses" | "lives" | "tests" | "users" | "community" | "notify" | "settings";
export type Intent = { action: "new" } | { action: "new-deck" } | { action: "edit"; id: string } | null;
export type ToastKind = "ok" | "bad" | "info";

type AdminCtx = {
  userId: string;
  toast: (msg: string, kind?: ToastKind) => void;
  /** Register/unregister unsaved changes for a part of the page. */
  setDirty: (key: string, dirty: boolean) => void;
  /** Run `go` now, or after the owner confirms they want to drop unsaved changes. */
  guardLeave: (go: () => void) => void;
  /** Switch admin section (updates the URL hash). */
  nav: (section: SectionKey, intent?: Intent) => void;
};

export const AdminContext = createContext<AdminCtx | null>(null);

export function useAdmin(): AdminCtx {
  const c = useContext(AdminContext);
  if (!c) throw new Error("useAdmin must be used inside the admin page");
  return c;
}

/** Marks this editor as having unsaved changes while `dirty` is true (cleared on unmount). */
export function useDirty(key: string, dirty: boolean) {
  const { setDirty } = useAdmin();
  useEffect(() => { setDirty(key, dirty); }, [key, dirty, setDirty]);
  useEffect(() => () => setDirty(key, false), [key, setDirty]);
}

/** Returns a ref that is true while the component is mounted. */
export function useMounted() {
  const m = useRef(true);
  useEffect(() => { m.current = true; return () => { m.current = false; }; }, []);
  return m;
}

// ------------------------------------------------------------------------------------------------
export function Toggle({ checked, onChange, label, hint, disabled, small }: {
  checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; hint?: React.ReactNode; disabled?: boolean; small?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled}
      className={`${s.toggle} ${small ? s.toggleSm : ""}`} onClick={() => onChange(!checked)}>
      <span className={s.track} aria-hidden="true"><span className={s.knob} /></span>
      <span className={s.toggleText}>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
    </button>
  );
}

// ------------------------------------------------------------------------------------------------
/** A button that asks "Are you sure?" inline before running onConfirm (no browser pop-ups). */
export function ConfirmButton({ children, onConfirm, message, confirmLabel = "Yes, delete", busyLabel = "Working…", className = "btn sm danger", disabled, title }: {
  children: React.ReactNode; onConfirm: () => Promise<any> | any; message?: React.ReactNode; confirmLabel?: string; busyLabel?: string;
  className?: string; disabled?: boolean; title?: string;
}) {
  const [stage, setStage] = useState<"idle" | "ask" | "busy">("idle");
  const mounted = useMounted();
  if (stage === "idle") {
    return <button type="button" className={className} disabled={disabled} title={title} aria-label={title} onClick={() => setStage("ask")}>{children}</button>;
  }
  return (
    <span className={s.confirm} role="group" aria-label="Confirm">
      {message && <span className={s.confirmMsg}>{message}</span>}
      <span className={s.confirmBtns}>
        <button type="button" className={`btn sm ${s.dangerSolid}`} disabled={stage === "busy"} autoFocus
          onClick={async () => {
            setStage("busy");
            try { await onConfirm(); } finally { if (mounted.current) setStage("idle"); }
          }}>
          {stage === "busy" ? busyLabel : confirmLabel}
        </button>
        <button type="button" className="btn sm" disabled={stage === "busy"} onClick={() => setStage("idle")}>Cancel</button>
      </span>
    </span>
  );
}

// ------------------------------------------------------------------------------------------------
export function Drawer({ open, onClose, title, eyebrow, children }: {
  open: boolean; onClose: () => void; title: React.ReactNode; eyebrow?: string; children: React.ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setTimeout(() => panel.current?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className={s.drawerWrap} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className={s.drawer} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "Details"} ref={panel} tabIndex={-1}>
        <div className="hazard thin" />
        <header className={s.drawerHead}>
          <div style={{ minWidth: 0 }}>
            {eyebrow && <div className="eyebrow orange">{eyebrow}</div>}
            <h2 className={s.drawerTitle}>{title}</h2>
          </div>
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Close"><X /></button>
        </header>
        <div className={s.drawerBody}>{children}</div>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
export function Empty({ icon: Icon, title, children, action }: { icon?: any; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={s.empty}>
      {Icon && <span className={s.emptyIco}><Icon aria-hidden="true" /></span>}
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ text = "Loading…" }: { text?: string }) {
  return <div className={s.loading} role="status"><span className="spin" aria-hidden="true" /> {text}</div>;
}

export function ErrorBox({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className={s.errorBox} role="alert">
      <span>{text}</span>
      {onRetry && <button type="button" className="btn sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function SectionHead({ eyebrow, title, accent, sub, actions }: {
  eyebrow: string; title: string; accent?: string; sub?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <header className={s.head}>
      <div style={{ minWidth: 0 }}>
        <div className="eyebrow orange">{eyebrow}</div>
        <h2 className={s.h2}>{title}{accent && <> <span>{accent}</span></>}</h2>
        {sub && <p className={s.sub}>{sub}</p>}
      </div>
      {actions && <div className={s.headActions}>{actions}</div>}
    </header>
  );
}

/** Form CS-1 style panel: hazard stripe, form code + title header, body. */
export function FormPanel({ code, title, children, aside, id }: { code?: string; title: string; children: React.ReactNode; aside?: React.ReactNode; id?: string }) {
  return (
    <section className="formcs" id={id}>
      <div className="hazard" />
      <div className={`formhead ${s.formhead}`}>
        <div>
          {code && <div className="label">{code}</div>}
          <b>{title}</b>
        </div>
        {aside}
      </div>
      <div className="formbody">{children}</div>
    </section>
  );
}

/** Numbered step label used inside Form panels. */
export function Step({ n, children, navy }: { n: number | string; children: React.ReactNode; navy?: boolean }) {
  return <div className={s.step}><span className={`stepnum${navy ? " navy" : ""}`}>{n}</span>{children}</div>;
}

/** Sticky bar shown while an editor has unsaved changes. */
export function SaveBar({ dirty, saving, onSave, onDiscard, label = "Save changes", disabledReason }: {
  dirty: boolean; saving: boolean; onSave: () => void; onDiscard?: () => void; label?: string; disabledReason?: string;
}) {
  if (!dirty && !saving) return null;
  return (
    <div className={s.saveBar} role="region" aria-label="Unsaved changes">
      <span className={s.saveBarText}>{disabledReason || (saving ? "Saving…" : "You have unsaved changes")}</span>
      <span className="row" style={{ gap: 8 }}>
        {onDiscard && <button type="button" className="btn sm" onClick={onDiscard} disabled={saving}>Discard</button>}
        <button type="button" className="btn sm primary" onClick={onSave} disabled={saving || !!disabledReason}>{saving ? "Saving…" : label}</button>
      </span>
    </div>
  );
}

export function StatusBadge({ status }: { status: "scheduled" | "live" | "ended" | string }) {
  if (status === "live") return <span className="badge live">Live now</span>;
  if (status === "ended") return <span className="badge">Ended</span>;
  return <span className="badge warn">Scheduled</span>;
}
