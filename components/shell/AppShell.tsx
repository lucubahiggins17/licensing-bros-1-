"use client";
// Site-wide navigation in the Licensing Bro's style: white top bar on desktop, bottom tabs on phones.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { House, BookOpen, GraduationCap, MessagesSquare, Radio, ChevronDown, User, MapPin, LogOut, Shield, Award, CreditCard } from "lucide-react";
import { useAuth, displayName } from "@/lib/auth";
import { asset, routes } from "@/lib/nav";
import NotificationBell from "@/components/notifications/NotificationBell";
import SessionGuard from "@/components/shell/SessionGuard";

export type NavKey = "home" | "courses" | "learn" | "community" | "live" | "account" | "admin" | "none";

const LINKS: { key: NavKey; href: string; label: string; short: string; Icon: any }[] = [
  { key: "home", href: "/", label: "Home", short: "Home", Icon: House },
  { key: "courses", href: "/courses/", label: "Courses", short: "Courses", Icon: BookOpen },
  { key: "learn", href: "/learn/", label: "My Learning", short: "Learn", Icon: GraduationCap },
  { key: "community", href: "/community/", label: "Community", short: "Community", Icon: MessagesSquare },
  { key: "live", href: "/live/", label: "Live", short: "Live", Icon: Radio }
];

function activeKey(path: string): NavKey {
  if (path === "/" || path === "") return "home";
  if (path.startsWith("/course")) return "courses";
  if (path.startsWith("/lesson") || path.startsWith("/learn")) return "learn";
  if (path.startsWith("/community")) return "community";
  if (path.startsWith("/live")) return "live";
  if (path.startsWith("/account")) return "account";
  if (path.startsWith("/admin")) return "admin";
  return "none";
}

export default function AppShell({ children, active, bare = false, blueprint = false }: { children: React.ReactNode; active?: NavKey; bare?: boolean; blueprint?: boolean }) {
  const path = usePathname() || "/";
  const current = active ?? activeKey(path);
  const { user, profile, account, signOut, ready } = useAuth();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const name = displayName(profile, user);

  return (
    <>
      <header className="nav">
        <div className="wrap">
          <Link href="/" className="logo" aria-label="Licensing Bro's home">
            <img src={asset("/logo-sm.png")} alt="" width={53} height={40} />
            <b>Licensing <span>Bro&rsquo;s</span></b>
          </Link>
          <nav className="links" aria-label="Main">
            {LINKS.map(({ key, href, label, Icon }) => (
              <Link key={key} href={href} aria-current={current === key ? "page" : undefined}><Icon aria-hidden="true" />{label}</Link>
            ))}
          </nav>
          <div className="right">
            {user ? (
              <>
                <NotificationBell />
                {account?.is_admin ? <Link href="/admin/" className="admin-pill">ADMIN</Link> : account?.is_staff && <Link href="/admin/" className="admin-pill">INSTRUCTOR</Link>}
                <div className="usermenu" ref={menuRef}>
                  <button onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu">
                    <span className="avatar">{profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : name.charAt(0).toUpperCase()}</span>
                    <span className="uname">{name}</span>
                    <ChevronDown size={15} aria-hidden="true" />
                  </button>
                  {menu && (
                    <div className="menu" role="menu" onClick={() => setMenu(false)}>
                      <div style={{ padding: "8px 10px 10px", borderBottom: "1px solid var(--line)", marginBottom: 4 }}>
                        <div style={{ fontWeight: 800 }}>{name}</div>
                        <div className="note" style={{ fontSize: 12.5 }}>{user.email}</div>
                        <div style={{ marginTop: 6 }}>{account?.paid ? <span className="badge paid">Pro access</span> : <span className="badge free">Free account</span>}</div>
                      </div>
                      <Link href={routes.account()} role="menuitem"><User size={16} />Account</Link>
                      <Link href={routes.account("devices")} role="menuitem"><MapPin size={16} />Devices &amp; home location</Link>
                      <Link href={routes.account("purchases")} role="menuitem"><CreditCard size={16} />Purchases</Link>
                      <Link href={routes.account("certificates")} role="menuitem"><Award size={16} />Certificates</Link>
                      {account?.is_admin ? <Link href="/admin/" role="menuitem"><Shield size={16} />Admin control center</Link>
                        : account?.is_staff && <Link href="/admin/" role="menuitem"><Shield size={16} />Instructor tools</Link>}
                      <button role="menuitem" onClick={() => signOut()}><LogOut size={16} />Sign out</button>
                    </div>
                  )}
                </div>
              </>
            ) : ready ? (
              <>
                <Link href={routes.login()} className="btn sm ghost">Sign in</Link>
                <Link href={routes.login("signup")} className="btn sm primary">Start free</Link>
              </>
            ) : null}
          </div>
        </div>
      </header>
      <div className={`page${blueprint ? " blueprint" : ""}`}>{children}</div>
      {!bare && (
        <nav className="bottomtabs" aria-label="Main">
          {LINKS.map(({ key, href, short, Icon }) => (
            <Link key={key} href={href} aria-current={current === key ? "page" : undefined}><Icon aria-hidden="true" />{short}</Link>
          ))}
        </nav>
      )}
      <SessionGuard />
    </>
  );
}
