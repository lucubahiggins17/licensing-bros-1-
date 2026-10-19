"use client";
// Danger zone: permanently delete the account after typing DELETE.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { callFn } from "@/lib/api";
import { routes } from "@/lib/nav";
import s from "./Account.module.css";

const WORD = "DELETE";
const LOCAL_PROGRESS = "licensingbros.progress";

export default function DangerTab() {
  const router = useRouter();
  const { signOut, account } = useAuth();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ready = typed.trim().toUpperCase() === WORD;

  async function del(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setErr("");
    try {
      await callFn("generate", { kind: "delete_account" });
      try { localStorage.removeItem(LOCAL_PROGRESS); } catch { /* storage blocked */ }
      try { await signOut(); } catch { /* the account is already gone */ }
      router.replace(routes.home);
    } catch (e: any) {
      setErr(e?.code === "offline" ? "You're offline. Connect to the internet and try again." : e?.message || "Couldn't delete your account. Try again.");
      setBusy(false);
    }
  }

  return (
    <form className={`card ${s.card} ${s.danger}`} onSubmit={del} aria-labelledby="del-title">
      <div className={s.cardHead}>
        <h2 id="del-title"><TriangleAlert aria-hidden="true" /> Delete account</h2>
        <p>This permanently deletes your account. It can&rsquo;t be undone.</p>
      </div>
      <ul className={s.dangerList}>
        <li>Your profile, study progress, readiness score and certificates are erased.</li>
        <li>You lose access to your courses{account?.enrolled?.length ? ` (${account.enrolled.length} on this account)` : ""}, including any you bought. Purchases can&rsquo;t be moved to a new account.</li>
        <li>Questions and replies you posted in the community stay up under the name you used. Delete them first if you want them gone.</li>
        <li>Payment records are kept for accounting, without your account attached.</li>
      </ul>
      <label className="field" htmlFor="del-confirm">Type {WORD} to confirm
        <input id="del-confirm" value={typed} onChange={(e) => { setTyped(e.target.value); setErr(""); }} autoComplete="off" autoCapitalize="characters" spellCheck={false} className={s.confirmInput} />
      </label>
      {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
      <div className={s.actionsRow}>
        <button type="submit" className={`btn cta ${s.deleteBtn}`} disabled={!ready || busy}>
          <Trash2 aria-hidden="true" />{busy ? "Deleting…" : "Delete my account forever"}
        </button>
      </div>
    </form>
  );
}
