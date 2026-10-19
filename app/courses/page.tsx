import Page from "@/components/courses/CatalogPage";
import { Suspense } from "react";
export default function Route() { return <Suspense fallback={null}><Page /></Suspense>; }
