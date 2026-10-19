// The site's knowledge library: documents admins and instructors upload (bulletins, board rules, their own notes),
// split into passages and searched by keywords and by meaning. Lives in Postgres (kb_docs / kb_chunks).
// Meaning search uses Supabase's built-in gte-small embedding model, which runs inside the edge function, so there
// is no extra service or key. When it isn't available (local tests), search falls back to keywords only.
import { adminClient, HttpError } from "./common.ts";
import { chunkText } from "./logic.ts";

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

const MAX_TEXT = 2_000_000;
export type DocFields = { title: string; trade: string | null; state: string | null; kind: string; source_url: string | null };

/** Saves a document as cited passages. Searchable by keywords right away; call embedPending to add meaning search. */
export async function saveLibraryDocument(userId: string, f: DocFields, text: string) {
  if (!f.title) throw new HttpError(400, "bad_request", "Give the document a title.");
  const clean = text.slice(0, MAX_TEXT);
  const passages = chunkText(clean);
  if (!passages.length) throw new HttpError(400, "bad_request", "There's no readable text in that document.");
  const db = adminClient();
  const { data: doc, error } = await db.from("kb_docs").insert({ ...f, status: "processing", created_by: userId }).select("id").single();
  if (error || !doc) throw new HttpError(500, "server_error", "Couldn't save the document. Run the latest schema.sql in Supabase, then try again.");
  const rows = passages.map((p) => ({ doc_id: doc.id, seq: p.seq, ref: p.ref, content: p.text, trade: f.trade, state: f.state }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: e } = await db.from("kb_chunks").insert(rows.slice(i, i + 500));
    if (e) {
      await db.from("kb_docs").update({ status: "error", error: e.message.slice(0, 300) }).eq("id", doc.id);
      throw new HttpError(500, "server_error", "Couldn't save the passages. Try again.");
    }
  }
  await db.from("kb_docs").update({ status: "ready", chunk_count: rows.length, char_count: clean.length, updated_at: new Date().toISOString() }).eq("id", doc.id);
  return { doc_id: doc.id as string, passages: rows.length, truncated: text.length > MAX_TEXT };
}

/** Adds meaning vectors to up to `batch` passages that don't have one yet (one document, or any). */
export async function embedPending(docId: string | null, batch = 8): Promise<{ done: number; remaining: number; available: boolean }> {
  const db = adminClient();
  let q = db.from("kb_chunks").select("id, ref, content").is("embedding", null).order("created_at").limit(batch);
  if (docId) q = q.eq("doc_id", docId);
  const { data: rows, error } = await q;
  if (error) throw new HttpError(500, "server_error", "Couldn't read the passages. Try again.");
  let done = 0;
  let available = true;
  for (const r of rows || []) {
    const v = await embed(`${r.ref ? `${r.ref}\n` : ""}${r.content}`);
    if (!v) { available = false; break; }
    const { error: e } = await db.from("kb_chunks").update({ embedding: JSON.stringify(v) }).eq("id", r.id);
    if (!e) done++;
  }
  let left = db.from("kb_chunks").select("id", { count: "exact", head: true }).is("embedding", null);
  if (docId) left = left.eq("doc_id", docId);
  const { count } = await left;
  return { done, remaining: count ?? 0, available };
}
