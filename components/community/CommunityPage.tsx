"use client";
// Community Q&A (/community/, ?post=<id>). Signed-in members read and post (RLS); signed-out visitors see a friendly gate.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Lock, MessageSquarePlus, MessagesSquare, Bot, ShieldCheck, ArrowBigUp } from "lucide-react";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/lib/auth";
import { routes } from "@/lib/nav";
import type { CommunityPost } from "@/lib/types";
import Feed from "./Feed";
import PostView from "./PostView";
import NewPost from "./NewPost";
import s from "./Community.module.css";

const readPostParam = () => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("post"));

export default function CommunityPage() {
  const { user, ready, configured } = useAuth();
  const [postId, setPostId] = useState<string | null | undefined>(undefined); // undefined = URL not read yet
  const [composing, setComposing] = useState(false);
  const [pushed, setPushed] = useState(false); // did we push the post view onto history ourselves?
  const [feedKey, setFeedKey] = useState(0);

  useEffect(() => {
    const read = () => { setPostId(readPostParam()); setComposing(false); };
    setPostId(readPostParam());
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const openPost = useCallback((id: string) => {
    window.history.pushState({ lbPost: id }, "", routes.post(id));
    setPushed(true);
    setPostId(id);
    setComposing(false);
    window.scrollTo({ top: 0 });
  }, []);

  const backToList = useCallback((refresh = false) => {
    if (refresh) setFeedKey((k) => k + 1);
    if (pushed && window.history.state?.lbPost) { window.history.back(); setPushed(false); return; }
    window.history.pushState({}, "", routes.community);
    setPostId(null);
    window.scrollTo({ top: 0 });
  }, [pushed]);

  const signedOutNext = typeof window === "undefined" ? routes.community : window.location.pathname + window.location.search;

  return (
    <AppShell active="community">
      <main className={s.page}>
        {!ready || postId === undefined ? (
          <div className={s.loading}><span className="spin" role="status" aria-label="Loading community" /></div>
        ) : !configured ? (
          <div className="wrap section"><p className="empty">The community isn&rsquo;t set up yet.</p></div>
        ) : !user ? (
          <Gate next={signedOutNext} />
        ) : postId ? (
          <PostView key={postId} postId={postId} onBack={backToList} />
        ) : (
          <>
            <header className={`blueprint ${s.top}`}>
              <div className={`wrap ${s.topInner}`}>
                <div>
                  <span className="eyebrow orange">Community</span>
                  <h1 className={s.h1}>Ask the <span>crew</span></h1>
                  <p className="lede">Post a question about your exam, the code or the business side. Other students, our team and AI Bro help you work it out.</p>
                </div>
                {!composing && (
                  <button type="button" className="btn primary cta" onClick={() => setComposing(true)}>
                    <MessageSquarePlus aria-hidden="true" /> Ask a question
                  </button>
                )}
              </div>
            </header>
            <div className="wrap">
              {composing && (
                <NewPost
                  onCancel={() => setComposing(false)}
                  onPosted={(p: CommunityPost) => { setComposing(false); setFeedKey((k) => k + 1); openPost(p.id); }}
                />
              )}
              <Feed key={feedKey} onOpen={openPost} onAsk={() => { setComposing(true); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
            </div>
          </>
        )}
      </main>
    </AppShell>
  );
}

function Gate({ next }: { next: string }) {
  return (
    <>
      <header className={`blueprint ${s.top}`}>
        <div className={`wrap ${s.topInner}`}>
          <div>
            <span className="eyebrow orange">Community</span>
            <h1 className={s.h1}>Ask the <span>crew</span></h1>
            <p className="lede">Real questions from people studying for the same exams. Answers from other students, our team and AI Bro.</p>
          </div>
        </div>
      </header>
      <div className={`wrap ${s.gateWrap}`}>
        <div className={s.preview} aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={s.ghostCard}>
              <span className={s.ghostVote}><ArrowBigUp /><i /></span>
              <span className={s.ghostLines}><i style={{ width: "28%" }} /><i style={{ width: `${86 - (i % 3) * 12}%` }} /><i style={{ width: `${66 - (i % 3) * 8}%` }} /></span>
            </div>
          ))}
        </div>
        <div className={`card tape ${s.gate}`}>
          <span className={s.gateIco}><Lock aria-hidden="true" /></span>
          <h2>Members only, and free</h2>
          <p>Sign in to read questions and post your own. Keeping the community to members keeps it on topic and spam-free.</p>
          <ul className={s.gateList}>
            <li><MessagesSquare aria-hidden="true" /> Ask about code, exam topics or running the business</li>
            <li><Bot aria-hidden="true" /> Get an answer from AI Bro, checked against code and OSHA facts</li>
            <li><ShieldCheck aria-hidden="true" /> Replies from the Licensing Bro&rsquo;s team are marked TEAM</li>
          </ul>
          <div className={s.gateBtns}>
            <Link href={routes.login("signup", next)} className="btn primary cta">Create free account</Link>
            <Link href={routes.login(undefined, next)} className="btn outline-navy">I already have an account</Link>
          </div>
        </div>
      </div>
    </>
  );
}
