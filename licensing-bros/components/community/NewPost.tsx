"use client";
// "Ask a question" form.
import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { useAuth, displayName } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import type { CommunityPost, Trade } from "@/lib/types";
import { TRADE_META, TRADE_ORDER } from "@/components/home/trades";
import { US_STATES } from "@/components/home/states";
import s from "./Community.module.css";

export default function NewPost({ onCancel, onPosted }: { onCancel: () => void; onPosted: (p: CommunityPost) => void }) {
  const { user, profile } = useAuth();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [trade, setTrade] = useState<Trade>(profile?.trade || "gc");
  const [state, setState] = useState<string>(profile?.state || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (t.length < 3) { setErr("Give your question a title (at least 3 characters)."); titleRef.current?.focus(); return; }
    if (!user) return;
    setBusy(true); setErr("");
    try {
      const { data, error } = await supabase().from("community_posts").insert({
        user_id: user.id,
        display_name: displayName(profile, user),
        trade,
        state: state || null,
        title: t.slice(0, 160),
        body: body.trim().slice(0, 5000)
      }).select("*").single();
      if (error) throw error;
      onPosted(data as CommunityPost);
    } catch (e: any) {
      setErr(/fetch|network/i.test(String(e?.message)) ? "You're offline. Your question is still here; try again when you're connected." : "Couldn't post your question. Try again.");
    }
    setBusy(false);
  }

  return (
    <form className={`formcs ${s.newPost}`} onSubmit={submit} aria-labelledby="np-title">
      <div className="hazard" />
      <div className="formhead"><b id="np-title">Ask a question</b></div>
      <div className="formbody">
        <label className="field" htmlFor="np-q">
          <span><span className="stepnum">1</span>Your question <span className="req" aria-hidden="true">*</span></span>
          <input id="np-q" ref={titleRef} value={title} maxLength={160} required onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. How many receptacles can go on a 20-amp circuit?" />
          <span className="hint">{160 - title.length} characters left</span>
        </label>
        <label className="field" htmlFor="np-body">
          <span><span className="stepnum">2</span>Details</span>
          <textarea id="np-body" value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)}
            placeholder="Add anything that helps: what you've tried, the code book or the practice question you're stuck on." />
        </label>
        <div className={s.formPair}>
          <label className="field" htmlFor="np-trade">
            <span><span className="stepnum">3</span>Trade</span>
            <select id="np-trade" value={trade} onChange={(e) => setTrade(e.target.value as Trade)}>
              {TRADE_ORDER.map((t) => <option key={t} value={t}>{TRADE_META[t].label}</option>)}
            </select>
          </label>
          <label className="field" htmlFor="np-state">
            <span><span className="stepnum navy">4</span>State</span>
            <select id="np-state" value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">Any state</option>
              {US_STATES.map((st) => <option key={st} value={st}>{st}</option>)}
            </select>
          </label>
        </div>
        <p className="note" style={{ margin: 0 }}>Be kind and keep it about licensing, codes, safety or the business. Never post exam questions you saw on a real test.</p>
        {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
        <div className={s.formBtns}>
          <button type="submit" className="btn navy cta" disabled={busy}><Send aria-hidden="true" />{busy ? "Posting…" : "Post question"}</button>
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </div>
    </form>
  );
}
