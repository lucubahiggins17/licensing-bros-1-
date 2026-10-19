"use client";
// Admin control center: one place for the owner to run Licensing Bro's.
// Sections are synced to the URL hash: #dashboard #courses #lives #tests #users #community #notify #settings.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  LayoutDashboard, BookOpen, Radio, ClipboardList, Users, MessagesSquare, Megaphone, Settings,
  Lock, KeyRound, PlugZap, TriangleAlert, CircleCheck, CircleAlert, Info, ExternalLink
} from "lucide-react";
import AppShell from "@/components/shell/AppShell";
import { useAuth, displayName } from "@/lib/auth";
import { routes } from "@/lib/nav";
import { AdminContext, Intent, SectionKey, ToastKind } from "./ui";
import Dashboard from "./Dashboard";
import Courses from "./Courses";
import Lives from "./Lives";
import Tests from "./Tests";
import UsersSection from "./Users";
import Community from "./Community";
import Notify from "./Notify";
import SettingsSection from "./Settings";
import { RedeemAdminCode, useHasAdmin } from "./AdminCode";
import s from "./admin.module.css";

const SECTIONS: { key: SectionKey; label: string; hint: string; Icon: any }[] = [
  { key: "dashboard", label: "Dashboard", hint: "How it's going", Icon: LayoutDashboard },
  { key: "courses", label: "Courses", hint: "Lessons & videos", Icon: BookOpen },
  { key: "lives", label: "Live classes", hint: "Schedule & go live", Icon: Radio },
  { key: "tests", label: "AI builder", hint: "Tests & game decks", Icon: ClipboardList },
  { key: "users", label: "Students", hint: "Accounts & access", Icon: Users },
  { key: "community", label: "Community", hint: "Posts & replies", Icon: MessagesSquare },
  { key: "notify", label: "Announcements", hint: "Send a message", Icon: Megaphone },
  { key: "settings", label: "Settings", hint: "Rules & admin code", Icon: Settings }
];
const isSection = (h: string): h is SectionKey => SECTIONS.some((x) => x.key === h);
const hashSection = (): SectionKey => {
  const h = (typeof window === "undefined" ? "" : window.location.hash.slice(1)).split(/[?/&]/)[0];
  return isSection(h) ? h : "dashboard";
};

export default function AdminPage() {
  return (
    <AppShell active="admin" blueprint>
      <AdminGate />
    </AppShell>
  );
}

function Gate({ icon: Icon, title, accent, children, action, loading, wide }: {
  icon?: any; title: string; accent?: string; children?: React.ReactNode; action?: React.ReactNode; loading?: boolean; wide?: boolean;
}) {
  return (
    <main className={`wrap ${s.gateWrap}`}>
      <div className={`plate ${s.gate}`}>
        {loading ? <span className="spin" aria-hidden="true" /> : Icon && <span className={s.gateIco}><Icon aria-hidden="true" /></span>}
        <div className="eyebrow orange">Admin control center</div>
        <h1 className={s.gateTitle}>{title}{accent && <> <span>{accent}</span></>}</h1>
        {children && <p className={s.gateText}>{children}</p>}
        {action && <div className={wide ? s.gateWide : "row"} style={wide ? undefined : { justifyContent: "center" }}>{action}</div>}
        <span className="bolts" />
      </div>
    </main>
  );
}

function AdminGate() {
  const { ready, configured, user, profile, account, refresh } = useAuth();
  const [retrying, setRetrying] = useState(false);
  const hasAdmin = useHasAdmin();
  if (!configured) {
    return <Gate icon={PlugZap} title="Not connected" accent="yet">The site isn&rsquo;t connected to its database. Add the Supabase keys (see README), then reload this page.</Gate>;
  }
  if (!ready) return <Gate loading title="Loading" accent="admin" />;
  if (!user) {
    if (hasAdmin === false) {
      return (
        <Gate icon={KeyRound} title="Claim" accent="your site"
          action={<>
            <Link className="btn primary cta" href={routes.login("signup", "/admin/")}>Create my account</Link>
            <Link className="btn" href={routes.login(undefined, "/admin/")}>I have an account</Link>
          </>}>
          This site has no admin yet. Create your account (or sign in), and you&rsquo;ll come right back here to enter your admin code.
        </Gate>
      );
    }
    return (
      <Gate icon={Lock} title="Sign in" accent="to continue"
        action={<Link className="btn primary cta" href={routes.login(undefined, "/admin/")}>Sign in</Link>}>
        The admin control center is for the Licensing Bro&rsquo;s team. Sign in with your admin account. Got an admin code? Sign in first, then enter it here.
      </Gate>
    );
  }
  if (!account) {
    return (
      <Gate loading title="Checking" accent="your access"
        action={<button className="btn" disabled={retrying} onClick={async () => { setRetrying(true); try { await refresh(); } finally { setRetrying(false); } }}>{retrying ? "Checking…" : "Try again"}</button>}>
        This takes a second. If it doesn&rsquo;t finish, check your internet connection.
      </Gate>
    );
  }
  if (!account.is_admin) {
    return hasAdmin === false ? (
      <Gate icon={KeyRound} title="Claim" accent="your site" wide action={<RedeemAdminCode hasAdmin={false} />}>
        No one runs this site yet. Enter the admin code from your database setup to become the first admin.
      </Gate>
    ) : (
      <Gate icon={KeyRound} title="Admin" accent="code" wide
        action={<><RedeemAdminCode hasAdmin={hasAdmin} /><Link className="btn sm ghost" href="/">Back to home</Link></>}>
        This area is for the Licensing Bro&rsquo;s team. If an admin gave you a code, enter it below.
      </Gate>
    );
  }
  return <AdminConsole userId={user.id} name={displayName(profile, user)} />;
}

type Toast = { id: number; msg: string; kind: ToastKind };

function AdminConsole({ userId, name }: { userId: string; name: string }) {
  const [section, setSection] = useState<SectionKey>("dashboard");
  const [navKey, setNavKey] = useState(0);
  const [intent, setIntent] = useState<Intent>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [leave, setLeave] = useState<null | (() => void)>(null);
  const dirty = useRef(new Set<string>());
  const sectionRef = useRef(section);
  sectionRef.current = section;

  const toast = useCallback((msg: string, kind: ToastKind = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "bad" ? 7000 : 3800);
  }, []);
  const setDirty = useCallback((key: string, d: boolean) => { if (d) dirty.current.add(key); else dirty.current.delete(key); }, []);
  const guardLeave = useCallback((go: () => void) => {
    if (dirty.current.size === 0) { go(); return; }
    setLeave(() => go);
  }, []);

  const show = useCallback((sec: SectionKey, it: Intent = null) => {
    setIntent(it);
    setSection(sec);
    setNavKey((k) => k + 1);
    if (window.location.hash.slice(1) !== sec) history.pushState(null, "", `#${sec}`);
    window.scrollTo({ top: 0 });
  }, []);
  const nav = useCallback((sec: SectionKey, it: Intent = null) => guardLeave(() => show(sec, it)), [guardLeave, show]);

  // URL hash → section (first load, back/forward buttons, typed hashes)
  useEffect(() => {
    setSection(hashSection());
    const onHash = () => {
      const target = hashSection();
      if (target === sectionRef.current) return;
      if (dirty.current.size) {
        history.replaceState(null, "", `#${sectionRef.current}`);
        setLeave(() => () => show(target));
        return;
      }
      setIntent(null);
      setSection(target);
      setNavKey((k) => k + 1);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [show]);

  // Unsaved changes: warn when closing the tab or following a link to another page
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty.current.size) { e.preventDefault(); e.returnValue = ""; } };
    const onClick = (e: MouseEvent) => {
      if (!dirty.current.size || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href") || "";
      if (!href || href.startsWith("#")) return;
      e.preventDefault();
      e.stopPropagation();
      setLeave(() => () => window.location.assign(a.href));
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", onClick, true); };
  }, []);

  // On phones the section list scrolls sideways: keep the current section visible
  const sideList = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = sideList.current;
    const el = list?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (list && el && list.scrollWidth > list.clientWidth) list.scrollLeft = Math.max(0, el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2);
  }, [section]);

  const ctx = useMemo(() => ({ userId, toast, setDirty, guardLeave, nav }), [userId, toast, setDirty, guardLeave, nav]);

  let body: React.ReactNode;
  switch (section) {
    case "courses": body = <Courses key={navKey} intent={intent} />; break;
    case "lives": body = <Lives key={navKey} intent={intent} />; break;
    case "tests": body = <Tests key={navKey} intent={intent} />; break;
    case "users": body = <UsersSection key={navKey} />; break;
    case "community": body = <Community key={navKey} />; break;
    case "notify": body = <Notify key={navKey} />; break;
    case "settings": body = <SettingsSection key={navKey} />; break;
    default: body = <Dashboard key={navKey} />;
  }

  return (
    <AdminContext.Provider value={ctx}>
      <div className={s.band}>
        <div className={`wrap ${s.bandInner}`}>
          <div style={{ minWidth: 0 }}>
            <div className={s.bandEyebrow}>Licensing Bro&rsquo;s · Owner tools</div>
            <h1 className={s.bandTitle}>Admin <span>control center</span></h1>
          </div>
          <div className={s.bandMeta}>
            <span>Signed in as <b>{name}</b></span>
            <Link href="/" className={s.bandLink}><ExternalLink aria-hidden="true" />View the site</Link>
          </div>
        </div>
      </div>
      <div className="hazard" />

      <div className={`wrap ${s.layout}`}>
        <nav className={s.side} aria-label="Admin sections">
          <div className={s.sideHead}><span className="label">Sections</span></div>
          <ul className={s.sideList} ref={sideList}>
            {SECTIONS.map(({ key, label, hint, Icon }) => (
              <li key={key}>
                <a href={`#${key}`} className={s.sideItem} aria-current={section === key ? "page" : undefined}
                  onClick={(e) => { e.preventDefault(); nav(key); }}>
                  <Icon aria-hidden="true" />
                  <span className={s.sideText}><b>{label}</b><small>{hint}</small></span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main className={s.main} id="admin-main">{body}</main>
      </div>

      <div className={s.toasts} aria-live="polite" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`${s.toastItem} ${t.kind === "bad" ? s.toastBad : t.kind === "info" ? s.toastInfo : ""}`}>
            {t.kind === "bad" ? <CircleAlert aria-hidden="true" /> : t.kind === "info" ? <Info aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>

      {leave && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="leave-title">
          <div className="dialog">
            <div className="hazard thin" />
            <div className="dbody">
              <TriangleAlert size={32} color="var(--orange)" aria-hidden="true" />
              <h2 id="leave-title">Unsaved changes</h2>
              <p style={{ margin: 0 }}>You changed something and haven&rsquo;t saved it yet. If you leave now, those changes are lost.</p>
              <div className="row" style={{ marginTop: 6 }}>
                <button type="button" className="btn primary" autoFocus onClick={() => setLeave(null)}>Keep editing</button>
                <button type="button" className="btn danger" onClick={() => { const go = leave; dirty.current.clear(); setLeave(null); go(); }}>Leave without saving</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminContext.Provider>
  );
}
