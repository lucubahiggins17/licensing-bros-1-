// Trade names, icons and colors shared by the home page, community and account screens.
import { Zap, Droplets, Wind, Hammer, Layers, type LucideIcon } from "lucide-react";
import type { Trade, TradeOrAll } from "@/lib/types";

export type TradeMeta = { label: string; short: string; Icon: LucideIcon; color: string; soft: string; blurb: string };

export const TRADE_META: Record<TradeOrAll, TradeMeta> = {
  elec: { label: "Electrical", short: "Electrical", Icon: Zap, color: "#b77900", soft: "#fff3cc", blurb: "NEC, load calculations, grounding and bonding" },
  plumb: { label: "Plumbing", short: "Plumbing", Icon: Droplets, color: "#2f5bd3", soft: "#e8eefc", blurb: "Plumbing code, drainage and venting, water supply" },
  hvac: { label: "HVAC / Mechanical", short: "HVAC", Icon: Wind, color: "#0f7f7a", soft: "#ddf3f1", blurb: "Mechanical and fuel gas codes, sizing, refrigerant rules" },
  gc: { label: "General Contractor", short: "General", Icon: Hammer, color: "#e05a0c", soft: "#fff1e8", blurb: "Building codes, job-site safety, business and law" },
  all: { label: "All trades", short: "All trades", Icon: Layers, color: "#1b1f3b", soft: "#e9ebf3", blurb: "Topics every contractor needs" }
};

/** Display order used across the site */
export const TRADE_ORDER: Trade[] = ["elec", "plumb", "hvac", "gc"];

export const tradeMeta = (t: string | null | undefined): TradeMeta => TRADE_META[(t as TradeOrAll) || "all"] || TRADE_META.all;

/** Small colored trade badge */
export function TradeBadge({ trade, short = false }: { trade: string | null | undefined; short?: boolean }) {
  const m = tradeMeta(trade);
  const { Icon } = m;
  return (
    <span className="badge" style={{ background: m.soft, borderColor: "transparent", color: m.color }}>
      <Icon size={12} aria-hidden="true" />
      {short ? m.short : m.label}
    </span>
  );
}
