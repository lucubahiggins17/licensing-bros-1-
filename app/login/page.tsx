"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import LoginForm from "@/components/LoginForm";
import { useAuth } from "@/lib/auth";
import { stripBase } from "@/lib/nav";

export default function Login() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup" | null>(null);
  const [next, setNext] = useState("/learn/");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setMode(q.get("mode") === "signup" ? "signup" : "signin");
    const n = q.get("next");
    if (n && n.startsWith("/") && !n.startsWith("//")) setNext(stripBase(n));
  }, []);
  useEffect(() => { if (ready && user && mode) router.replace(next); }, [ready, user, mode, next, router]);

  return (
    <AppShell active="none" blueprint>
      {mode && <LoginForm initialMode={mode} onSignedIn={() => router.replace(next)} />}
    </AppShell>
  );
}
