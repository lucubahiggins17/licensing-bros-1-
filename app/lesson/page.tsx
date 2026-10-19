import Page from "@/components/courses/LessonPage";
import { Suspense } from "react";
export default function Route() { return <Suspense fallback={null}><Page /></Suspense>; }
