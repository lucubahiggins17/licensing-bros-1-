"use client";
// Account (/account/) with hash tabs: #profile #devices #purchases #certificates #plan #danger
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { User, MapPin, CreditCard, Award, Crown, TriangleAlert, Lock } from "lucide-react";
import AppShell from "@/components/shell/AppShell";
import { useAuth, displayName } from "@/lib/auth";
import { routes } from "@/lib/nav";
import ProfileTab from "./ProfileTab";
import DevicesTab from "./DevicesTab";
import { PurchasesTab, CertificatesTab } from "./RecordsTabs";
import PlanTab from "./PlanTab";
import DangerTab from "./DangerTab";
import s from "./Account.module.css";

const TABS = [
  { key: "profile", label: "Profile", Icon: User },
  { key: "devices", label: "Devices & home", Icon: MapPin },
  { key: "purchases", label: "Purchases", Icon: CreditCard },
  { key: "certificates", label: "Certificates", Icon: Award },
  { key: "plan", label: "Plan", Icon: Crown },
  { key: "danger", label: "Delete account", Icon: TriangleAlert }
] as const;
type TabKey = (typeof TABS)[number]["key"];

const isTab = (h: string): h is TabKey => TABS.some((t) => t.key === h);
const hashTab = (hash: string): TabKey => { const h = hash.replace(/^#/, ""); return isTab(h) ? h : "profile"; };

export default function AccountPage() {
  const { user, profile, account, ready, configured } = useAuth();
  const [tab, setTab] = useState<TabKey>("profile");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Follow the URL hash. Next.js <Link> hash changes on the same page don't fire "hashchange",
  // so also read the hash from clicked links (e.g. the avatar menu) and after any click.
  useEffect(() => {
    const read = () => setTab(hashTab(window.location.hash));
    read();
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (a && a.href) {
        try {
          const u = new URL(a.href, window.location.href);
          if (u.pathname === window.location.pathname && u.hash && isTab(u.hash.slice(1))) setTab(u.hash.slice(1) as TabKey);
        } catch { /* ignore */ }
      }
      setTimeout(read, 120);
    };
    window.addEventListener("hashchange", read);
    window.addEventListener("popstate", read);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("hashchange", read);
      window.removeEventListener("popstate", read);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  // Keep the selected tab visible in the scrolling tab strip on phones
  useEffect(() => {
    const el = tabRefs.current[tab];
    const strip = el?.parentElement;
    if (!el || !strip || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollTo({ left: Math.max(0, el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2), behavior: "smooth" });
  }, [tab, ready, user]);

  const go = useCallback((k: TabKey, focus = false) => {
    setTab(k);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${k}`);
    if (focus) tabRefs.current[k]?.focus();
  }, []);

  function onTabKey(e: React.KeyboardEvent, i: number) {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (e.key in keys) {
      e.preventDefault();
      go(TABS[(i + keys[e.key] + TABS.length) % TABS.length].key, true);
    } else if (e.key === "Home") { e.preventDefault(); go(TABS[0].key, true); }
    else if (e.key === "End") { e.preventDefault(); go(TABS[TABS.length - 1].key, true); }
  }

  if (!ready) {
    return <AppShell active="account"><main className={s.loading}><span className="spin" role="status" aria-label="Loading your account" /></main></AppShell>;
  }

  if (!user || !configured) {
    const next = `/account/${typeof window !== "undefined" ? window.location.hash : ""}`;
    return (
      <AppShell active="account" blueprint>
        <main className="authwrap">
          <div className="card tape authcard center">
            <span className={s.gateIco}><Lock aria-hidden="true" /></span>
            <h1 style={{ fontSize: 30, textTransform: "uppercase" }}>Your account</h1>
            <p className="lede" style={{ margin: "0 auto" }}>Sign in to manage your profile, devices, purchases and certificates.</p>
            <Link className="btn primary cta block" href={routes.login(undefined, next)}>Sign in</Link>
            <Link className="btn block" href={routes.login("signup", next)}>Create a free account</Link>
          </div>
        </main>
      </AppShell>
    );
  }

  const name = displayName(profile, user);
  const plan = account?.is_admin ? <span className="badge warn">Admin</span> : account?.paid ? <span className="badge paid">Pro access</span> : <span className="badge free">Free account</span>;

  return (
    <AppShell active="account">
      <main>
        <header className={`blueprint ${s.head}`}>
          <div className={`wrap ${s.headInner}`}>
            <span className={s.avatar} aria-hidden="true">{profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : name.charAt(0).toUpperCase()}</span>
            <div className={s.who}>
              <span className="eyebrow orange">My account</span>
              <h1 className={s.name}>{name}</h1>
              <span className={s.email}>{user.email} {plan}</span>
            </div>
          </div>
        </header>

        <div className={`wrap ${s.layout}`}>
          <div className={s.tabs} role="tablist" aria-label="Account sections">
            {TABS.map(({ key, label, Icon }, i) => (
              <button
                key={key}
                ref={(el) => { tabRefs.current[key] = el; }}
                id={`acct-tab-${key}`}
                role="tab"
                type="button"
                aria-selected={tab === key}
                aria-controls={`acct-panel-${key}`}
                tabIndex={tab === key ? 0 : -1}
                className={`${s.tab} ${key === "danger" ? s.tabDanger : ""}`}
                onClick={() => go(key)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <section className={s.panel} role="tabpanel" id={`acct-panel-${tab}`} aria-labelledby={`acct-tab-${tab}`} tabIndex={-1}>
            {tab === "profile" && <ProfileTab />}
            {tab === "devices" && <DevicesTab />}
            {tab === "purchases" && <PurchasesTab />}
            {tab === "certificates" && <CertificatesTab />}
            {tab === "plan" && <PlanTab />}
            {tab === "danger" && <DangerTab />}
          </section>
        </div>
      </main>
    </AppShell>
  );
}
