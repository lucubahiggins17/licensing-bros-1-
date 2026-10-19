"use client";
// Motion toolkit: confetti bursts, scroll reveal, count-up numbers. Everything is skipped for people who
// ask their device for reduced motion, and nothing is hidden unless JavaScript is running to reveal it.
import { useEffect, useRef, useState } from "react";

export const reducedMotion = () => {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return true; }
};

const COLORS = ["#f26a1b", "#f5b400", "#1b1f3b", "#ffffff", "#2f5bd3", "#14804a"];

/** A burst of confetti from an element (or the middle of the screen). Cleans itself up. */
export function burst(from?: Element | null, { count = 28, spread = 1 }: { count?: number; spread?: number } = {}) {
  if (typeof document === "undefined" || reducedMotion()) return;
  const r = from?.getBoundingClientRect();
  const x = r ? r.left + r.width / 2 : window.innerWidth / 2;
  const y = r ? r.top + r.height / 2 : window.innerHeight / 3;
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:3000;overflow:hidden";
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    const angle = Math.random() * Math.PI * 2;
    const dist = (60 + Math.random() * 120) * spread;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 60 * spread;
    const size = 6 + Math.random() * 6;
    p.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${size * 1.6}px;border-radius:2px;background:${COLORS[i % COLORS.length]};box-shadow:0 0 0 1px rgba(0,0,0,.06)`;
    layer.appendChild(p);
    p.animate(
      [
        { transform: "translate(-50%,-50%) rotate(0deg)", opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${Math.random() * 540 - 270}deg)`, opacity: 1, offset: 0.7 },
        { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + 90}px)) rotate(${Math.random() * 720}deg)`, opacity: 0 }
      ],
      { duration: 900 + Math.random() * 500, easing: "cubic-bezier(.2,.8,.3,1)", fill: "forwards" }
    );
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1600);
}

/** Bigger celebration across the top of the screen (exam passed, goal reached, badge earned). */
export function celebrate() {
  if (typeof window === "undefined" || reducedMotion()) return;
  const w = window.innerWidth;
  [0.2, 0.5, 0.8].forEach((f, i) => setTimeout(() => {
    const dot = document.createElement("span");
    dot.style.cssText = `position:fixed;left:${w * f}px;top:${window.innerHeight * 0.3}px;width:1px;height:1px`;
    document.body.appendChild(dot);
    burst(dot, { count: 30, spread: 1.4 });
    dot.remove();
  }, i * 140));
}

/**
 * Fades sections in as they scroll into view. Add data-reveal to any element (optionally
 * data-reveal="left" | "right" | "zoom"); children with data-reveal-child stagger in order.
 * Installed once by the app shell; it also picks up elements that appear later (after data loads).
 */
export function useScrollReveal() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || typeof MutationObserver === "undefined" || reducedMotion()) return;
    const root = document.documentElement;
    const show = (el: HTMLElement) => {
      el.dataset.in = "1";
      el.querySelectorAll<HTMLElement>("[data-reveal-child]").forEach((c, i) => { c.style.transitionDelay = `${Math.min(i, 8) * 70}ms`; });
    };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { show(e.target as HTMLElement); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const watch = (el: HTMLElement) => {
      if (el.dataset.in || el.dataset.revealWatched) return;
      el.dataset.revealWatched = "1";
      io.observe(el);
      // Safety net: never leave something hidden (odd layouts, print preview, very tall sections)
      const t = setTimeout(() => { timers.delete(t); if (!el.dataset.in) { show(el); io.unobserve(el); } }, 2600);
      timers.add(t);
    };
    const scan = (node: ParentNode) => {
      if (node instanceof HTMLElement && node.hasAttribute("data-reveal")) watch(node);
      node.querySelectorAll?.<HTMLElement>("[data-reveal]").forEach(watch);
    };
    root.classList.add("motion");
    scan(document);
    const mo = new MutationObserver((list) => {
      for (const m of list) m.addedNodes.forEach((n) => { if (n.nodeType === 1) scan(n as HTMLElement); });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { mo.disconnect(); io.disconnect(); timers.forEach(clearTimeout); root.classList.remove("motion"); };
  }, []);
}

/** A number that counts up from zero the first time it scrolls into view. Keeps any prefix/suffix ("2,700+"). */
export function CountUp({ value, duration = 1100 }: { value: string; duration?: number }) {
  const m = /^(\D*)([\d,.]+)(.*)$/.exec(value);
  const target = m ? Number(m[2].replace(/,/g, "")) : NaN;
  const decimals = m && m[2].includes(".") ? m[2].split(".")[1].length : 0;
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState<string>(value);

  useEffect(() => {
    if (!m || !Number.isFinite(target) || reducedMotion() || typeof IntersectionObserver === "undefined") { setShown(value); return; }
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const fmt = (n: number) => m[1] + n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + m[3];
    setShown(fmt(0));
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / duration);
        const eased = 1 - Math.pow(1 - k, 3);
        setShown(fmt(k >= 1 ? target : Math.round(target * eased * 10 ** decimals) / 10 ** decimals));
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <span ref={ref}><span aria-hidden="true">{shown}</span><span className="sr-only">{value}</span></span>;
}

/** Subtle 3D tilt that follows the pointer (desktop only). */
export function useTilt<T extends HTMLElement>(max = 6) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion() || !window.matchMedia("(hover: hover)").matches) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(900px) rotateY(${px * max}deg) rotateX(${-py * max}deg)`;
    };
    const leave = () => { el.style.transform = ""; };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); };
  }, [max]);
  return ref;
}
