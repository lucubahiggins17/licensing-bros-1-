"use client";
import { AuthProvider } from "@/lib/auth";
import { useEffect } from "react";
import { setupNativeChrome } from "@/lib/native";

export default function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => { setupNativeChrome(); }, []);
  return <AuthProvider>{children}</AuthProvider>;
}
