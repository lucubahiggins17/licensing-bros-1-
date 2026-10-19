"use client";
// Home screen of the Android app. First launch: launch screen, then the swipeable onboarding.
// Signed in: the student's dashboard, live classes and courses, with no website marketing.
// Signed out: an app-style welcome with a sample exam question to try and account buttons.
import { useEffect, useState } from "react";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/lib/auth";
import type { Course, Live } from "@/lib/types";
import { isOnboarded, markOnboarded, resetOnboarding } from "@/lib/onboarding";
import Dashboard from "@/components/home/Dashboard";
import { UpcomingLives, FeaturedCourses } from "@/components/home/Listings";
import AppOnboarding from "./AppOnboarding";
import AppWelcome from "./AppWelcome";
import TodayPlan from "@/components/home/TodayPlan";
import Splash from "./Splash";

type Phase = "splash" | "onboard" | "home";

export default function AppHome({ lives, courses }: { lives: Live[] | null; courses: Course[] | null }) {
  const { user, ready } = useAuth();
  const [phase, setPhase] = useState<Phase>("splash");

  useEffect(() => {
    if (!ready) return;
    if (user) { markOnboarded(); setPhase("home"); return; }
    setPhase(isOnboarded() ? "home" : "onboard");
  }, [ready, user]);

  if (phase === "splash") return <Splash />;
  if (phase === "onboard" && !user) return <AppOnboarding onDone={() => setPhase("home")} />;

  return (
    <AppShell active="home">
      <main>
        {user ? (
          <>
            <Dashboard lives={lives} app />
            <TodayPlan />
          </>
        ) : (
          <AppWelcome onReplay={() => { resetOnboarding(); setPhase("onboard"); }} />
        )}
        {lives && lives.length > 0 && <UpcomingLives lives={lives} />}
        {courses && courses.length > 0 && <FeaturedCourses courses={courses} />}
      </main>
    </AppShell>
  );
}
