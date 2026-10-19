"use client";
// Community question list: filters, search, sort, pinned first, paging.
import { useEffect, useRef, useState } from "react";
import { Search, ArrowBigUp, MessageCircle, Pin, MapPin, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { routes } from "@/lib/nav";
import type { CommunityPost } from "@/lib/types";
import { TradeBadge, tradeMeta } from "@/components/home/trades";
import { timeAgo } from "@/components/notifications/timeAgo";
import s from "./Community.module.css";

type Filter = "all" | "trade" | "state" | "unanswered";
type Sort = "new" | "top";
const PAGE = 20;

/** Strip characters that would break a PostgREST or() filter. */
const cleanTerm = (t: string) => t.replace(/[,()"'\\%*:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

export default function Feed({ onOpen, onAsk }: { onOpen: (id: string) => void; onAsk: () => void }) {
  const { user, profile } = useAuth();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("new");
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [posts, setPosts] = useState<CommunityPost[] | null>(null);
  const [voted, setVoted] = useState<Set<string>>(new Set());
  const [more, setMore] = useState(false);
  const [busyMore, setBusyMore] = useState(false);
  const [error, setError] = useState("");
  const reqId = useRef(0);

  // Debounce the search box
  useEffect(() => {
    const t = setTimeout(() => setQuery(cleanTerm(term)), 300);
    return () => clearTimeout(t);
  }, [term]);

  async function fetchPage(from: number): Promise<CommunityPost[]> {
    let q = supabase().from("community_posts").select("*");
    if (filter === "trade" && profile?.trade) q = q.eq("trade", profile.trade);
    if (filter === "state" && profile?.state) q = q.eq("state", profile.state);
    if (filter === "unanswered") q = q.eq("reply_count", 0);
    if (query) q = q.or(`title.ilike.%${query}%,body.ilike.%${query}%`);
    q = q.order("pinned", { ascending: false });
    if (sort === "top") q = q.order("upvotes", { ascending: false });
    q = q.order("created_at", { ascending: false }).range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) throw error;
    return (data as CommunityPost[]) || [];
  }

  async function loadVotes(ids: string[]) {
    if (!user || !ids.length) return;
    try {
      const { data } = await supabase().from("community_votes").select("post_id").eq("user_id", user.id).in("post_id", ids);
      if (data) setVoted((v) => { const n = new Set(v); (data as any[]).forEach((r) => n.add(r.post_id)); return n; });
    } catch { /* not critical */ }
  }

  useEffect(() => {
    const id = ++reqId.current;
    setPosts(null); setError("");
    fetchPage(0)
      .then((rows) => { if (id !== reqId.current) return; setPosts(rows); setMore(rows.length === PAGE); loadVotes(rows.map((r) => r.id)); })
      .catch((e) => { if (id !== reqId.current) return; setPosts([]); setError(/fetch|network/i.test(String(e?.message)) ? "You're offline. Connect to load the community." : "Couldn't load questions. Try again in a moment."); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, sort, query, profile?.trade, profile?.state]);

  async function loadMore() {
    if (!posts) return;
    setBusyMore(true);
    try {
      const rows = await fetchPage(posts.length);
      const seen = new Set(posts.map((p) => p.id));
      setPosts([...posts, ...rows.filter((r) => !seen.has(r.id))]);
      setMore(rows.length === PAGE);
      loadVotes(rows.map((r) => r.id));
    } catch { setError("Couldn't load more. Check your connection."); }
    setBusyMore(false);
  }

  const filters: { k: Filter; label: string }[] = [
    { k: "all", label: "All" },
    { k: "trade", label: profile?.trade ? tradeMeta(profile.trade).short : "My trade" },
    { k: "state", label: profile?.state || "My state" },
    { k: "unanswered", label: "Unanswered" }
  ];

  return (
    <section className={s.feed} aria-label="Questions">
      <div className={s.toolbar}>
        <label className={s.search}>
          <Search aria-hidden="true" />
          <span className={s.srOnly}>Search questions</span>
          <input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search questions" enterKeyHint="search" />
          {term && <button type="button" className={s.clear} onClick={() => setTerm("")} aria-label="Clear search"><X aria-hidden="true" /></button>}
        </label>
        <div className={s.filterRow}>
          <div className={s.chips} role="group" aria-label="Show">
            {filters.map((f) => (
              <button key={f.k} type="button" className="chip" aria-pressed={filter === f.k} onClick={() => setFilter(f.k)}>
                {f.k === "trade" ? <>My trade: {f.label}</> : f.k === "state" ? <>My state: {f.label}</> : f.label}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Sort by">
            <button type="button" aria-pressed={sort === "new"} onClick={() => setSort("new")}>Newest</button>
            <button type="button" aria-pressed={sort === "top"} onClick={() => setSort("top")}>Top</button>
          </div>
        </div>
      </div>

      {error && <p className="err" role="alert">{error}</p>}

      {posts === null ? (
        <ul className={s.list} aria-busy="true">
          {[0, 1, 2, 3].map((i) => <li key={i} className={`${s.postCard} ${s.skelCard}`}><span className={s.skel} /><span className={s.skel} /></li>)}
        </ul>
      ) : posts.length === 0 && !error ? (
        <div className={s.empty}>
          <MessageCircle aria-hidden="true" />
          <h2>{query ? "No questions match that search" : filter === "unanswered" ? "Every question has an answer" : "No questions here yet"}</h2>
          <p>{query ? "Try different words, or ask it yourself." : "Be the first to ask. Someone studying for the same exam is wondering too."}</p>
          <button type="button" className="btn primary cta" onClick={onAsk}>Ask a question</button>
        </div>
      ) : (
        <ul className={s.list}>
          {posts.map((p) => (
            <li key={p.id}>
              <a
                href={routes.post(p.id)}
                className={`${s.postCard} ${p.pinned ? s.pinned : ""}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  onOpen(p.id);
                }}
              >
                <span className={`${s.voteCol} ${voted.has(p.id) ? s.votedCol : ""}`}>
                  <ArrowBigUp aria-hidden="true" />
                  <b>{p.upvotes}</b>
                  <span className={s.srOnly}> upvote{p.upvotes === 1 ? "" : "s"}{voted.has(p.id) ? ", including yours" : ""}.</span>
                </span>
                <span className={s.postMain}>
                  <span className={s.badges}>
                    {p.pinned && <span className="badge warn"><Pin size={11} aria-hidden="true" />Pinned</span>}
                    <TradeBadge trade={p.trade} short />
                    {p.state && <span className={s.stateTag}><MapPin aria-hidden="true" />{p.state}</span>}
                  </span>
                  <b className={s.postTitle}>{p.title}</b>
                  {p.body && <span className={s.snippet}>{p.body}</span>}
                  <span className={s.meta}>
                    <span>{p.display_name}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={p.created_at}>{timeAgo(p.created_at)}</time>
                    <span className={`${s.replyCount} ${p.reply_count === 0 ? s.noReplies : ""}`}>
                      <MessageCircle aria-hidden="true" />{p.reply_count === 0 ? "No answers yet" : `${p.reply_count} ${p.reply_count === 1 ? "reply" : "replies"}`}
                    </span>
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {posts && more && (
        <div className="center" style={{ marginTop: 16 }}>
          <button type="button" className="btn" onClick={loadMore} disabled={busyMore}>{busyMore ? "Loading…" : "Show more questions"}</button>
        </div>
      )}
    </section>
  );
}
