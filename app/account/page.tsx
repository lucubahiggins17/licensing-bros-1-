import Page from "@/components/account/AccountPage";
import { Suspense } from "react";
export default function Route() { return <Suspense fallback={null}><Page /></Suspense>; }
