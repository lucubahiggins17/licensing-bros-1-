"use client";
// Home page (/): hero, signed-in dashboard, trade band, course finder, features, how it works,
// upcoming live classes, featured courses, Free vs Pro, FAQ and footer.
import { useEffect, useState } from "react";
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
  const { user, ready, configured } = useAuth();
  const [lives, setLives] = useState<Live[] | null>(null);
  const [courses, setCourses] = useState<Course[] | null>(null);

  useEffect(() => {
    if (!configured) { setLives([]); setCourses([]); return; }
    let alive = true;
    loadLives().then((l) => alive && setLives(l)).catch(() => alive && setLives([]));
    loadCourses().then((c) => alive && setCourses(c)).catch(() => alive && setCourses([]));
    return () => { alive = false; };
  }, [configured]);

  const signedIn = !!user;
  // In the Android app a signed-in student sees their dashboard first and a smaller hero.
  const appFirst = IS_APP_BUILD && signedIn;
  const compactHero = IS_APP_BUILD && (signedIn || !ready);

  return (
    <AppShell active="home">
      <main>
        {appFirst && <Dashboard lives={lives} app />}
        <Hero compact={compactHero} />
        {signedIn && !appFirst && <Dashboard lives={lives} />}
        <TradeBand />
        <FindCourse />
        <Features />
        <HowItWorks />
        {lives && lives.length > 0 && <UpcomingLives lives={lives} />}
        {courses && courses.length > 0 && <FeaturedCourses courses={courses} />}
        <Plans />
        <Faq />
      </main>
      <SiteFooter />
    </AppShell>
  );
}
