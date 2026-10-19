import Page from "@/components/live/WatchPage";
import { Suspense } from "react";
export default function Route() { return <Suspense fallback={null}><Page /></Suspense>; }
