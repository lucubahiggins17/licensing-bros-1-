"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
// Old address for the study workspace
export default function OldAppRoute() {
  const router = useRouter();
  useEffect(() => { router.replace("/learn/" + window.location.hash); }, [router]);
  return null;
}
