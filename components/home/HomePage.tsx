"use client";
// Home page (/): hero, signed-in dashboard and today's plan, trade band, course finder, features, how it works,
// upcoming live classes, featured courses, Free vs Pro, FAQ and footer.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/lib/auth";
import { IS_APP_BUILD } from "@/lib/nav";
import { supabase } from "@/lib/supabaseClient";
import type { Course, Live } from "@/lib/types";
import Hero from "./Hero";
import Dashboard from "./Dashboard";
import FindCourse, { TradeBand } from "./FindCourse";
import Features, { HowItWorks } from "./Features";
import { UpcomingLives, FeaturedCourses } from "./Listings";
import Plans from "./Plans";
import Faq from "./Faq";
import SiteFooter from "./SiteFooter";
import TodayPlan from "./TodayPlan";
import Splash from "@/components/app/Splash";

// The Android app has its own home screen (launch screen, onboarding, app-style welcome); the website never loads it.
const AppHome = IS_APP_BUILD ? dynamic(() => import("@/components/app/AppHome"), { ssr: false, loading: () => <Splash /> }) : null;

/** Live classes that are on now or coming up (stale "scheduled" rows from long ago are skipped). */
async function loadLives(): Promise<Live[]> {
  const since = new Date(Date.now() - 3 * 3600e3).toISOString();
  const { data, error } = await supabase().from("lives")
    .select("id,title,description,trade,is_free,course_id,starts_at,status,provider,room_name,cover_url,host_id,created_at")
    .neq("status", "ended")
    .or(`status.eq.live,starts_at.gte.${since}`)
    .order("starts_at", { ascending: true })
    .limit(6);
  if (error) throw error;
  const rows = (data as Live[]) || [];
  return [...rows.filter((l) => l.status === "live"), ...rows.filter((l) => l.status !== "live")];
}

async function loadCourses(): Promise<Course[]> {
  const { data, error } = await supabase().from("courses").select("*")
    .eq("published", true)
    .order("sort", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(6);
  if (error) throw error;
  return (data as Course[]) || [];
}

export default function HomePage() {
  const { user, configured } = useAuth();
  const [lives, setLives] = useState<Live[] | null>(null);
  const [courses, setCourses] = useState<Course[] | null>(null);

  useEffect(() => {
    if (!configured) { setLives([]); setCourses([]); return; }
    let alive = true;
    loadLives().then((l) => alive && setLives(l)).catch(() => alive && setLives([]));
    loadCourses().then((c) => alive && setCourses(c)).catch(() => alive && setCourses([]));
    return () => { alive = false; };
  }, [configured]);

  if (AppHome) return <AppHome lives={lives} courses={courses} />;

  const signedIn = !!user;
  return (
    <AppShell active="home">
      <main>
        <Hero />
        {signedIn && <Dashboard lives={lives} />}
        {signedIn && <TodayPlan />}
        <div data-reveal><TradeBand /></div>
        <div data-reveal><FindCourse /></div>
        <div data-reveal><Features /></div>
        <div data-reveal><HowItWorks /></div>
        {lives && lives.length > 0 && <div data-reveal><UpcomingLives lives={lives} /></div>}
        {courses && courses.length > 0 && <div data-reveal><FeaturedCourses courses={courses} /></div>}
        <div data-reveal><Plans /></div>
        <div data-reveal><Faq /></div>
      </main>
      <SiteFooter />
    </AppShell>
  );
}
