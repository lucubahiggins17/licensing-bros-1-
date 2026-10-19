// Full-screen launch screen for the Android app, shown while the session loads. Plain markup so the
// static HTML paints it immediately, before any JavaScript runs.
import { asset } from "@/lib/nav";
import s from "./AppHome.module.css";

export default function Splash() {
  return (
    <div className={s.splash} role="status" aria-label="Loading Licensing Bro's">
      <img src={asset("/logo.png")} alt="" width={200} height={151} className={s.splashLogo} />
      <span className={s.splashBar} aria-hidden="true"><i /></span>
    </div>
  );
}
