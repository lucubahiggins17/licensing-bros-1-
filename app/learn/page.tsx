"use client";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import Workspace from "@/components/Workspace";
import { useAuth } from "@/lib/auth";
import { routes } from "@/lib/nav";

export default function LearnRoute() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const signedOut = useCallback(() => router.replace(routes.login(undefined, "/learn/")), [router]);
  return (
    <AppShell active="learn">
      {!ready ? <main className="authwrap"><span className="spin" aria-label="Loading" /></main>
        : user ? <Workspace onSignedOut={signedOut} />
        : <SignInPrompt />}
    </AppShell>
  );
}

function SignInPrompt() {
  return (
    <main className="authwrap">
      <div className="card tape authcard center">
        <h1 style={{ fontSize: 30, textTransform: "uppercase" }}>Your study HQ</h1>
        <p className="lede" style={{ margin: "0 auto" }}>Create a free account to use the AI tutor, practice exams, games and flashcards, and to track your readiness score.</p>
        <a className="btn primary cta block" href={routes.login("signup", "/learn/")}>Create free account</a>
        <a className="btn block" href={routes.login(undefined, "/learn/")}>I already have an account</a>
      </div>
    </main>
  );
}
