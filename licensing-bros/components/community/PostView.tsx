"use client";
// One community question with its replies, upvote toggle, reply box, delete (own) and "Ask AI Bro".
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowBigUp, Trash2, Bot, ShieldCheck, MapPin, Send, MessageCircle, Pin, Sparkles } from "lucide-react";
import { useAuth, displayName } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { callFn, ApiError } from "@/lib/api";
import { claimSession } from "@/lib/session";
import { routes } from "@/lib/nav";
import type { CommunityPost, CommunityReply } from "@/lib/types";
import { TradeBadge } from "@/components/home/trades";
import { timeAgo } from "@/components/notifications/timeAgo";
import { usePlanLimits } from "@/components/home/Plans";
import RichText from "./RichText";
import s from "./Community.module.css";

const offlineMsg = (e: any) => /fetch|network/i.test(String(e?.message || ""));

export default function PostView({ postId, onBack }: { postId: string; onBack: (refresh?: boolean) => void }) {
  const { user, profile, account } = useAuth();
  const { paid } = usePlanLimits();
  const uid = user?.id;
  const isAdmin = !!account?.is_admin;
  const [post, setPost] = useState<CommunityPost | null | undefined>(undefined); // null = not found
  const [replies, setReplies] = useState<CommunityReply[]>([]);
  const [voted, setVoted] = useState(false);
  const [voteBusy, setVoteBusy] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [actionErr, setActionErr] = useState("");
  const [draft, setDraft] = useState("");
  const [asTeam, setAsTeam] = useState(false);
  const [posting, setPosting] = useState(false);
  const [replyErr, setReplyErr] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<ReactNode>(null);
  const [confirm, setConfirm] = useState<string | null>(null); // "post" or a reply id
  const [deleting, setDeleting] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  const loadReplies = useCallback(async () => {
    const { data, error } = await supabase().from("community_replies").select("*").eq("post_id", postId).order("created_at", { ascending: true });
    if (error) throw error;
    setReplies((data as CommunityReply[]) || []);
  }, [postId]);

  const load = useCallback(async () => {
    setLoadErr("");
    try {
      const sb = supabase();
      const [{ data: p, error }, , vote] = await Promise.all([
        sb.from("community_posts").select("*").eq("id", postId).maybeSingle(),
        loadReplies(),
        uid ? sb.from("community_votes").select("post_id").eq("post_id", postId).eq("user_id", uid).maybeSingle() : Promise.resolve({ data: null } as any)
      ]);
      if (error) throw error;
      setPost((p as CommunityPost) || null);
      setVoted(!!vote?.data);
    } catch (e: any) {
      setLoadErr(offlineMsg(e) ? "You're offline. Connect to load this question." : "Couldn't load this question.");
      setPost((x) => (x === undefined ? null : x));
    }
  }, [postId, uid, loadReplies]);

  useEffect(() => { load(); }, [load]);

  async function toggleVote() {
    if (!post || !uid || voteBusy) return;
    const was = voted;
    setVoteBusy(true); setActionErr("");
    setVoted(!was);
    setPost((p) => (p ? { ...p, upvotes: Math.max(0, p.upvotes + (was ? -1 : 1)) } : p));
    const sb = supabase();
    const { error } = was
      ? await sb.from("community_votes").delete().eq("post_id", post.id).eq("user_id", uid)
      : await sb.from("community_votes").insert({ post_id: post.id, user_id: uid });
    if (error && error.code !== "23505") {
      setVoted(was);
      setPost((p) => (p ? { ...p, upvotes: Math.max(0, p.upvotes + (was ? 1 : -1)) } : p));
      setActionErr("Couldn't save your vote. Try again.");
    }
    setVoteBusy(false);
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !uid || !post) { replyRef.current?.focus(); return; }
    setPosting(true); setReplyErr("");
    try {
      const { data, error } = await supabase().from("community_replies").insert({
        post_id: post.id, user_id: uid, display_name: displayName(profile, user), body: body.slice(0, 5000), is_staff: isAdmin && asTeam
      }).select("*").single();
      if (error) throw error;
      setReplies((r) => [...r, data as CommunityReply]);
      setPost((p) => (p ? { ...p, reply_count: p.reply_count + 1 } : p));
      setDraft("");
    } catch (e: any) {
      setReplyErr(offlineMsg(e) ? "You're offline. Your reply is still here; send it when you're connected." : "Couldn't post your reply. Try again.");
    }
    setPosting(false);
  }

  async function askAi() {
    if (!post) return;
    setAiBusy(true); setAiMsg(null);
    try {
      await callFn("generate", { kind: "community_answer", post_id: post.id, state: post.state || profile?.state, trade: post.trade });
      await loadReplies();
      setPost((p) => (p ? { ...p, reply_count: p.reply_count + 1 } : p));
    } catch (e: any) {
      const code = e instanceof ApiError ? e.code : "";
      const status = e instanceof ApiError ? e.status : 0;
      if (code === "limit_reached" || status === 429) {
        const lim = account?.limits?.ai_daily;
        setAiMsg(account?.paid
          ? <>You&rsquo;ve used today&rsquo;s {lim ? `${lim} ` : ""}AI questions. Your limit resets tomorrow; practice exams and games still work.</>
          : <>You&rsquo;ve used today&rsquo;s {lim ? `${lim} free ` : "free "}AI questions. Buy any course to get {paid.ai_daily} a day. <Link href={routes.courses()}>Browse courses</Link></>);
      } else if (code === "upgrade_required") {
        setAiMsg(<>AI answers are part of Pro. <Link href={routes.courses()}>Browse courses</Link> to unlock them.</>);
      } else if (code === "session_replaced" || code === "no_session") {
        claimSession(false);
        setAiMsg("This device needed to reconnect. Try again in a moment.");
      } else if (code === "offline") {
        setAiMsg("You're offline. AI Bro needs internet.");
      } else {
        setAiMsg(e?.message || "AI Bro couldn't answer right now. Try again.");
      }
    }
    setAiBusy(false);
  }

  async function deletePost() {
    if (!post) return;
    setDeleting(true); setActionErr("");
    const { data, error } = await supabase().from("community_posts").delete().eq("id", post.id).select("id");
    if (error || !data?.length) { setActionErr("Couldn't delete this question. Try again."); setDeleting(false); return; }
    onBack(true);
  }

  async function deleteReply(id: string) {
    setDeleting(true); setActionErr("");
    const { data, error } = await supabase().from("community_replies").delete().eq("id", id).select("id");
    if (error || !data?.length) setActionErr("Couldn't delete that reply. Try again.");
    else {
      setReplies((r) => r.filter((x) => x.id !== id));
      setPost((p) => (p ? { ...p, reply_count: Math.max(0, p.reply_count - 1) } : p));
      setConfirm(null);
    }
    setDeleting(false);
  }

  const back = (
    <button type="button" className={`btn ghost ${s.back}`} onClick={() => onBack(false)}>
      <ArrowLeft aria-hidden="true" /> All questions
    </button>
  );

  if (post === undefined) {
    return <div className="wrap"><div className={s.postWrap}>{back}<div className={s.loading}><span className="spin" role="status" aria-label="Loading question" /></div></div></div>;
  }
  if (post === null) {
    return (
      <div className="wrap">
        <div className={s.postWrap}>
          {back}
          <div className={s.empty}>
            <MessageCircle aria-hidden="true" />
            <h2>{loadErr ? "Couldn't load this question" : "This question isn't here anymore"}</h2>
            <p>{loadErr || "It may have been deleted by the person who asked it."}</p>
            {loadErr ? <button type="button" className="btn primary" onClick={load}>Try again</button> : <button type="button" className="btn primary" onClick={() => onBack(false)}>See all questions</button>}
          </div>
        </div>
      </div>
    );
  }

  const mine = post.user_id === uid;
  const canDeletePost = mine || isAdmin;
  const hasAi = replies.some((r) => r.is_ai);

  return (
    <div className="wrap">
      <div className={s.postWrap}>
        {back}

        <article className={s.post} aria-labelledby="post-title">
          <div className={s.badges}>
            {post.pinned && <span className="badge warn"><Pin size={11} aria-hidden="true" />Pinned</span>}
            <TradeBadge trade={post.trade} />
            {post.state && <span className={s.stateTag}><MapPin aria-hidden="true" />{post.state}</span>}
          </div>
          <h1 id="post-title" className={s.postH1}>{post.title}</h1>
          <p className={s.meta}>
            <span>{post.display_name}{mine && " (you)"}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={post.created_at}>{timeAgo(post.created_at)}</time>
          </p>
          {post.body && <div className={s.postBody}>{post.body}</div>}
          <div className={s.postActions}>
            <button type="button" className={`${s.voteBtn} ${voted ? s.voteOn : ""}`} aria-pressed={voted} onClick={toggleVote} disabled={voteBusy}>
              <ArrowBigUp aria-hidden="true" />
              <span>{voted ? "Upvoted" : "Upvote"}</span>
              <b>{post.upvotes}</b>
            </button>
            <span className={s.countTag}><MessageCircle aria-hidden="true" />{post.reply_count} {post.reply_count === 1 ? "reply" : "replies"}</span>
            {canDeletePost && (confirm === "post" ? (
              <span className={s.confirm} role="group" aria-label="Confirm delete">
                <span>Delete this question and its replies?</span>
                <button type="button" className="btn sm danger" onClick={deletePost} disabled={deleting}>{deleting ? "Deleting…" : "Yes, delete"}</button>
                <button type="button" className="btn sm ghost" onClick={() => setConfirm(null)} disabled={deleting}>Keep it</button>
              </span>
            ) : (
              <button type="button" className={`btn sm ghost ${s.delBtn}`} onClick={() => setConfirm("post")}><Trash2 aria-hidden="true" />Delete</button>
            ))}
          </div>
          {actionErr && <p className="err" role="alert" style={{ margin: "8px 0 0" }}>{actionErr}</p>}
        </article>

        {!hasAi && (
          <div className={s.aiBox}>
            <span className={s.aiIco}><Bot aria-hidden="true" /></span>
            <div className={s.aiText}>
              <b>Want an answer right now?</b>
              <span>AI Bro answers in plain English, checked against code and OSHA facts. Uses one of your daily AI questions.</span>
              {aiMsg && <span className={s.aiMsg} role="alert">{aiMsg}</span>}
            </div>
            <button type="button" className="btn primary cta" onClick={askAi} disabled={aiBusy}>
              {aiBusy ? <><span className={`spin ${s.btnSpin}`} aria-hidden="true" />AI Bro is writing…</> : <><Sparkles aria-hidden="true" />Ask AI Bro</>}
            </button>
          </div>
        )}

        <section className={s.repliesSec} aria-labelledby="replies-title">
          <h2 id="replies-title" className={s.repliesH}>{replies.length ? `${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : "No replies yet"}</h2>
          {replies.length > 0 && (
            <ol className={s.replies}>
              {replies.map((r) => {
                const own = r.user_id === uid && !r.is_ai;
                const canDel = own || isAdmin;
                return (
                  <li key={r.id} className={`${s.reply} ${r.is_ai ? s.replyAi : ""} ${r.is_staff ? s.replyStaff : ""}`}>
                    <div className={s.replyHead}>
                      <span className={s.avatar} aria-hidden="true">
                        {r.is_ai ? <Bot /> : r.is_staff ? <ShieldCheck /> : (r.display_name || "?").charAt(0).toUpperCase()}
                      </span>
                      <span className={s.replyWho}>
                        <span className={s.replyLine}>
                          <b>{r.is_ai ? "AI Bro" : r.display_name}{own && " (you)"}</b>
                          {r.is_staff && <span className="badge paid">Team</span>}
                          <time className={s.replyTime} dateTime={r.created_at}>{timeAgo(r.created_at)}</time>
                        </span>
                        {r.is_ai && <span className={s.aiBadge}><Bot aria-hidden="true" /><span><b>AI BRO</b> · checked against code &amp; OSHA facts</span></span>}
                      </span>
                    </div>
                    {r.is_ai ? <RichText text={r.body} className={s.replyBody} /> : <div className={`${s.replyBody} ${s.plain}`}>{r.body}</div>}
                    {r.is_ai && <p className={s.aiNote}>AI answers can be wrong. Confirm code sections in the book your state uses.</p>}
                    {canDel && (
                      <div className={s.replyActions}>
                        {confirm === r.id ? (
                          <span className={s.confirm} role="group" aria-label="Confirm delete">
                            <span>Delete this reply?</span>
                            <button type="button" className="btn sm danger" onClick={() => deleteReply(r.id)} disabled={deleting}>{deleting ? "Deleting…" : "Yes, delete"}</button>
                            <button type="button" className="btn sm ghost" onClick={() => setConfirm(null)} disabled={deleting}>Keep it</button>
                          </span>
                        ) : (
                          <button type="button" className={`btn sm ghost ${s.delBtn}`} onClick={() => setConfirm(r.id)}><Trash2 aria-hidden="true" />Delete</button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <form className={s.replyBox} onSubmit={sendReply} aria-label="Write a reply">
          <label className="field" htmlFor="reply-body">Your reply
            <textarea id="reply-body" ref={replyRef} value={draft} maxLength={5000} onChange={(e) => setDraft(e.target.value)}
              placeholder="Share what you know. Cite the code section if you can." />
          </label>
          {isAdmin && (
            <label className={s.check}>
              <input type="checkbox" checked={asTeam} onChange={(e) => setAsTeam(e.target.checked)} /> Post as the Licensing Bro&rsquo;s team (shows a TEAM badge)
            </label>
          )}
          {replyErr && <p className="err" role="alert" style={{ margin: 0 }}>{replyErr}</p>}
          <div className={s.formBtns}>
            <button type="submit" className="btn navy cta" disabled={posting || !draft.trim()}><Send aria-hidden="true" />{posting ? "Posting…" : "Post reply"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
