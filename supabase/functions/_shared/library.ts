// The site's knowledge library: documents admins and instructors upload (bulletins, board rules, their own notes),
// split into passages and searched by keywords and by meaning. Lives in Postgres (kb_docs / kb_chunks).
// Meaning search uses Supabase's built-in gte-small embedding model, which runs inside the edge function, so there
// is no extra service or key. When it isn't available (local tests), search falls back to keywords only.
import { adminClient } from "./common.ts";

export type LibraryHit = { id: string; doc_id: string; ref: string; text: string; score: number };

// deno-lint-ignore no-explicit-any
let session: any = null;

/** 384-number meaning vector for a passage or question, or null when the embedding model isn't available. */
export async function embed(text: string): Promise<number[] | null> {
  try {
    // deno-lint-ignore no-explicit-any
    const ai = (globalThis as any).Supabase?.ai;
    if (!ai?.Session) return null;
    session ??= new ai.Session("gte-small");
    const out = await session.run(text.slice(0, 2000), { mean_pool: true, normalize: true });
    const arr = Array.from(out as ArrayLike<number>);
    return arr.length === 384 ? arr : null;
  } catch (e) {
    console.warn("embed", (e as Error)?.message);
    return null;
  }
}

/** Best passages for a question, filtered to the student's trade and state (national passages always count). */
export async function searchLibrary(query: string, o: { trade?: string; state?: string; limit?: number } = {}): Promise<LibraryHit[]> {
  const q = query.trim().slice(0, 1500);
  if (q.length < 3) return [];
  const vec = await embed(q);
  const { data, error } = await adminClient().rpc("kb_search", {
    p_query: q,
    p_embedding: vec ? JSON.stringify(vec) : null,
    p_trade: o.trade || null,
    p_state: o.state || null,
    p_limit: Math.max(1, Math.min(12, o.limit || 6))
  });
  if (error) {
    // Library not set up yet (schema.sql not rerun): the tutor still works from the built-in facts
    if (!/kb_search|does not exist|schema cache/i.test(error.message || "")) console.warn("kb_search", error.message);
    return [];
  }
  // deno-lint-ignore no-explicit-any
  return ((data || []) as any[]).map((r) => ({ id: r.id, doc_id: r.doc_id, ref: r.ref || "Library", text: r.content, score: Number(r.score) || 0 }));
}
