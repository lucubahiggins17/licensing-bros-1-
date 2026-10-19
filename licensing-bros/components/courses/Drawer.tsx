"use client";
// Slide-in panel (curriculum on phones, Ask Bro). Modal: traps focus, Esc / backdrop closes, restores focus.
import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import s from "./Drawer.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  side?: "left" | "right";
  footer?: React.ReactNode;
  children: React.ReactNode;
};

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function Drawer({ open, onClose, title, side = "right", footer, children }: Props) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => {
      const p = panel.current;
      if (!p) return;
      (p.querySelector<HTMLElement>("[data-autofocus]") || p).focus();
    }, 40);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      if (before && document.contains(before)) before.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className={s.backdrop} onMouseDown={() => closeRef.current()}>
      <div
        ref={panel}
        className={`${s.panel} ${side === "left" ? s.left : s.right}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={s.head}>
          <h2 id={id}>{title}</h2>
          <button className={s.close} onClick={() => closeRef.current()} aria-label="Close"><X aria-hidden="true" /></button>
        </div>
        <div className="hazard thin" />
        <div className={s.body}>{children}</div>
        {footer && <div className={s.foot}>{footer}</div>}
      </div>
    </div>
  );
}
