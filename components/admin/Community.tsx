"use client";
// Community: pin posts, remove spam, and answer questions as the Licensing Bro's Team.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bot, ChevronDown, ChevronUp, ExternalLink, MessagesSquare, Pin, PinOff, Send, ShieldCheck, Sparkles, ThumbsUp, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { callFn } from "@/lib/api";
import { routes } from "@/lib/nav";
import { TRADE_LABELS, type CommunityPost, type CommunityReply } from "@/lib/types";
import { errMsg, q, relTime } from "./format";
import { useAdmin, useDirty, useMounted, ConfirmButton, Empty, ErrorBox, Loading, SectionHead } from "./ui";
import s from "./admin.module.css";

export const STAFF_NAME = "Licensing Bro's Team";
type Filter = "all" | "unanswered" | "pinned";

export default function Community() {
  const { toast } = useAdmin();
  const [posts, setPosts] = useState<CommunityPost[] | null>(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(30);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      let query = supabase().from("community_posts").select("*");
      if (filter === "unanswered") query = query.eq("reply_count", 0);
      if (filter === "pinned") query = query.eq("pinned", true);
      const data = await q(query.order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(limit));
      setPosts((data as CommunityPost[]) || []);
    } catch (e) { setErr(errMsg(e, "Couldn't load community posts.")); }
    setLoading(false);
  }, [filter, limit]);
  useEffect(() => { load(); }, [load]);

  const patchPost = (id: string, p: Partial<CommunityPost>) => setPosts((ps) => ps?.map((x) => (x.id === id ? { ...x, ...p } : x)) ?? ps);
  const bumpReplies = (id: string, d: number) => setPosts((ps) => ps?.map((x) => (x.id === id ? { ...x, reply_count: Math.max(0, x.reply_count + d) } : x)) ?? ps);

  async function pin(p: CommunityPost) {
    const pinned = !p.pinned;
    patchPost(p.id, { pinned });
    try { await q(supabase().from("community_posts").update({ pinned }).eq("id", p.id)); toast(pinned ? "Pinned to the top of the community." : "Unpinned."); }
    catch (e) { patchPost(p.id, { pinned: !pinned }); toast(errMsg(e), "bad"); }
  }
  async function removePost(p: CommunityPost) {
    try { await q(supabase().from("community_posts").delete().eq("id", p.id)); setPosts((ps) => ps?.filter((x) => x.id !== p.id) ?? ps); toast("Post deleted."); }
    catch (e) { toast(errMsg(e), "bad"); }
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <SectionHead eyebrow="Community" title="Community" accent="posts"
        sub={<>Answer questions as <b>{STAFF_NAME}</b>, pin the best threads and remove anything that doesn&rsquo;t belong.</>} />

      <div className="row between">
        <div className="seg" role="group" aria-label="Show">
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>Newest</button>
          <button type="button" aria-pressed={filter === "unanswered"} onClick={() => setFilter("unanswered")}>No replies yet</button>
          <button type="button" aria-pressed={filter === "pinned"} onClick={() => setFilter("pinned")}>Pinned</button>
        </div>
        <Link className="btn sm ghost" href={routes.community}><ExternalLink aria-hidden="true" />Open community</Link>
      </div>

      {err ? <ErrorBox text={err} onRetry={load} /> : !posts ? <Loading text="Loading posts…" /> : !posts.length ? (
        <div className="card">
          <Empty icon={MessagesSquare} title={filter === "unanswered" ? "Every post has a reply. Nice work." : filter === "pinned" ? "Nothing pinned yet." : "No posts yet."}>
            {filter === "all" ? "When students ask questions in the community, they show up here." : null}
          </Empty>
        </div>
      ) : (
        <ul className={s.cardList}>
          {posts.map((p) => (
            <li key={p.id} className={`card ${s.post} ${p.pinned ? s.postPinned : ""}`}>
              <div className={s.postHead}>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    {p.pinned && <span className="badge ai"><Pin aria-hidden="true" size={11} />Pinned</span>}
                    {p.reply_count === 0 && <span className="badge warn">No replies</span>}
                  </div>
                  <b className={s.postTitle}>{p.title}</b>
                  <span className="note">{p.display_name} · {TRADE_LABELS[p.trade] || p.trade}{p.state ? ` · ${p.state}` : ""} · {relTime(p.created_at)}</span>
                </div>
                <span className={s.postCounts}>
                  <span title="Replies"><MessagesSquare aria-hidden="true" />{p.reply_count}</span>
                  <span title="Upvotes"><ThumbsUp aria-hidden="true" />{p.upvotes}</span>
                </span>
              </div>
              {p.body && <p className={`${s.postBody} ${open === p.id ? "" : s.clamp}`}>{p.body}</p>}
              <div className={s.postActions}>
                <button type="button" className="btn sm primary" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                  {open === p.id ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}{open === p.id ? "Close" : p.reply_count ? `Replies (${p.reply_count}) & reply` : "Reply"}
                </button>
                <button type="button" className="btn sm" onClick={() => pin(p)}>{p.pinned ? <><PinOff aria-hidden="true" />Unpin</> : <><Pin aria-hidden="true" />Pin</>}</button>
                <Link className="btn sm ghost" href={routes.post(p.id)}><ExternalLink aria-hidden="true" />View</Link>
                <ConfirmButton onConfirm={() => removePost(p)} message="Delete this post and all its replies?" confirmLabel="Yes, delete" busyLabel="Deleting…">
                  <Trash2 aria-hidden="true" />Delete
                </ConfirmButton>
              </div>
              {open === p.id && <Thread post={p} onCount={(d) => bumpReplies(p.id, d)} />}
            </li>
          ))}
        </ul>
      )}
      {posts && posts.length >= limit && (
        <div className="center"><button type="button" className="btn" disabled={loading} onClick={() => setLimit((l) => l + 30)}>{loading ? "Loading…" : "Show more posts"}</button></div>
      )}
    </div>
  );
}

function Thread({ post, onCount }: { post: CommunityPost; onCount: (delta: number) => void }) {
  const { toast, userId } = useAdmin();
  const mounted = useMounted();
  const [replies, setReplies] = useState<CommunityReply[] | null>(null);
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [ai, setAi] = useState(false);
  useDirty(`reply-${post.id}`, !!text.trim());

  const load = useCallback(async () => {
    setErr("");
    try { const data = await q(supabase().from("community_replies").select("*").eq("post_id", post.id).order("created_at", { ascending: true })); if (mounted.current) setReplies((data as CommunityReply[]) || []); }
    catch (e) { if (mounted.current) setErr(errMsg(e, "Couldn't load replies.")); }
  }, [post.id, mounted]);
  useEffect(() => { load(); }, [load]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      const row = (await q(supabase().from("community_replies").insert({ post_id: post.id, user_id: userId, display_name: STAFF_NAME, body, is_staff: true, is_ai: false }).select().single())) as CommunityReply;
      setReplies((r) => [...(r || []), row]);
      setText("");
      onCount(1);
      toast("Reply posted as the Licensing Bro's Team.");
    } catch (e) { toast(errMsg(e), "bad"); }
    setSending(false);
  }
  async function aiAnswer() {
    setAi(true);
    try {
      const res = await callFn<{ reply: CommunityReply }>("generate", { kind: "community_answer", post_id: post.id });
      if (res?.reply?.id) { setReplies((r) => [...(r || []), res.reply]); onCount(1); }
      else await load();
      toast("The AI posted an answer. Read it over; delete it if anything's off.");
    } catch (e) { toast(errMsg(e, "The AI couldn't answer right now."), "bad"); }
    if (mounted.current) setAi(false);
  }
  async function removeReply(r: CommunityReply) {
    try { await q(supabase().from("community_replies").delete().eq("id", r.id)); setReplies((x) => x?.filter((y) => y.id !== r.id) ?? x); onCount(-1); toast("Reply deleted."); }
    catch (e) { toast(errMsg(e), "bad"); }
  }

  return (
    <div className={s.thread}>
      {err ? <ErrorBox text={err} onRetry={load} /> : !replies ? <Loading text="Loading replies…" /> : !replies.length ? (
        <p className="note" style={{ margin: 0 }}>No replies yet. Be the first to help.</p>
      ) : (
        <ul className={s.replies}>
          {replies.map((r) => (
            <li key={r.id} className={`${s.reply} ${r.is_staff ? s.replyStaff : r.is_ai ? s.replyAi : ""}`}>
              <div className={s.replyHead}>
                <b>{r.display_name}</b>
                {r.is_staff && <span className="badge paid"><ShieldCheck aria-hidden="true" size={11} />Staff</span>}
                {r.is_ai && <span className="badge ai"><Bot aria-hidden="true" size={11} />AI</span>}
                <span className="note">{relTime(r.created_at)}</span>
                <span className={s.replyDel}>
                  <ConfirmButton className={s.iconBtn} title="Delete reply" onConfirm={() => removeReply(r)} message="Delete this reply?"><Trash2 aria-hidden="true" /></ConfirmButton>
                </span>
              </div>
              <p className={s.replyBody}>{r.body}</p>
            </li>
          ))}
        </ul>
      )}
      <div className={s.composer}>
        <label className="label" htmlFor={`reply-${post.id}`}>Reply as {STAFF_NAME}</label>
        <textarea id={`reply-${post.id}`} className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={5000}
          placeholder="Write a helpful answer. Cite the code section when you can." />
        <div className="row between">
          <button type="button" className="btn sm" onClick={aiAnswer} disabled={ai || sending}>
            {ai ? <><span className={`spin ${s.spinSm}`} aria-hidden="true" />AI is answering…</> : <><Sparkles aria-hidden="true" />Let the AI answer</>}
          </button>
          <button type="button" className="btn primary" onClick={send} disabled={!text.trim() || sending}><Send aria-hidden="true" />{sending ? "Posting…" : "Post reply"}</button>
        </div>
      </div>
    </div>
  );
}
