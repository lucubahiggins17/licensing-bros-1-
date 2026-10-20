"use client";
// Signed-in user, profile and plan for the whole app. Wrap pages with <AuthProvider> (done in AppShell).
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { Account, Profile, SiteSettings } from "@/lib/types";
import { claimSession, releaseSession } from "@/lib/session";
import { setSiteStudioVoice } from "@/lib/voiceFlag";

type AuthCtx = {
  ready: boolean;              // first check finished
  configured: boolean;         // Supabase keys present
  user: User | null;
  profile: Profile | null;
  account: Account | null;     // is_admin, paid, enrolled[], limits
  settings: Partial<SiteSettings>;
  refresh: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  signOut: () => Promise<void>;
  isEnrolled: (courseId: string) => boolean;
};

const Ctx = createContext<AuthCtx | null>(null);

export const DEFAULT_FREE_LIMITS = { ai_daily: 5, exam_max_questions: 10, ai_exams: false, practice_sets: false };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [settings, setSettings] = useState<Partial<SiteSettings>>({});
  const claimedFor = useRef<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const { data } = await supabase().from("site_settings").select("key,value");
      if (data) {
        const next = Object.fromEntries(data.map((r: any) => [r.key, r.value])) as Partial<SiteSettings>;
        setSiteStudioVoice(!!next.voice?.studio);
        setSettings(next);
      }
    } catch { /* offline */ }
  }, []);

  const loadUser = useCallback(async (u: User | null) => {
    setUser(u);
    if (!u) { setProfile(null); setAccount(null); return; }
    try {
      const [{ data: p }, { data: a }] = await Promise.all([
        supabase().from("profiles").select("*").eq("id", u.id).maybeSingle(),
        supabase().rpc("my_account")
      ]);
      setProfile((p as Profile) || null);
      setAccount((a as Account) || null);
    } catch { /* offline: keep what we have */ }
    if (claimedFor.current !== u.id) {
      claimedFor.current = u.id;
      claimSession(false);
    }
  }, []);

  useEffect(() => {
    let sb;
    try { sb = supabase(); } catch { setConfigured(false); setReady(true); return; }
    loadSettings();
    sb.auth.getSession().then(async ({ data }) => { await loadUser(data.session?.user ?? null); setReady(true); });
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") { claimedFor.current = null; releaseSession(); loadUser(null); }
      else if (event === "SIGNED_IN" || event === "USER_UPDATED") loadUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadSettings, loadUser]);

  const refresh = useCallback(async () => {
    const { data } = await supabase().auth.getUser();
    claimedFor.current = data.user?.id ?? null; // don't re-claim on refresh
    await loadUser(data.user ?? null);
  }, [loadUser]);

  const signOut = useCallback(async () => {
    await releaseSession();
    await supabase().auth.signOut();
  }, []);

  const isEnrolled = useCallback((courseId: string) => !!account?.is_admin || !!account?.enrolled?.includes(courseId), [account]);

  return (
    <Ctx.Provider value={{ ready, configured, user, profile, account, settings, refresh, refreshSettings: loadSettings, signOut, isEnrolled }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside <AuthProvider>");
  return c;
}

export const displayName = (profile: Profile | null, user: User | null) =>
  (profile?.full_name || user?.email?.split("@")[0] || "Student").trim();
