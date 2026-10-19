// Knowledge library for staff (admins and instructors): add documents and web pages, index them for meaning
// search a few passages at a time, try a search, and see what the built-in knowledge base covers.
//   add_text  {title, kind, trade, state, source_url?, text}  -> {doc_id, passages}   (keyword-searchable right away)
//   add_url   {url, title?, kind?, trade, state}               -> {doc_id, passages, title}
//   embed     {doc_id?}                                        -> {done, remaining, available}  (call until remaining = 0)
//   search    {query, trade?, state?}                          -> {hits}
//   stats     {}                                               -> {builtin: {...}, library: {...}}
import { adminClient, handler, HttpError, json, readBody, requireUser } from "../_shared/common.ts";
import { htmlToText, STATES } from "../_shared/logic.ts";
import { embedPending, saveLibraryDocument, searchLibrary } from "../_shared/library.ts";
import { kbStats } from "../_shared/kb.ts";

const TRADES = new Set(["gc", "elec", "plumb", "hvac", "law"]);
const KINDS = new Set(["notes", "bulletin", "rules", "code", "lesson", "web", "other"]);

async function requireStaff(userId: string) {
  const { data, error } = await adminClient().rpc("is_staff", { p_user: userId });
  if (error) throw new HttpError(500, "server_error", "Couldn't check your account. Try again.");
  if (data !== true) throw new HttpError(403, "forbidden", "Only admins and instructors can manage the knowledge library.");
}

function docFields(body: Record<string, unknown>) {
  const title = String(body.title || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const trade = body.trade && TRADES.has(String(body.trade)) ? String(body.trade) : null;
  const state = body.state && STATES.includes(String(body.state)) ? String(body.state) : null;
  const kind = KINDS.has(String(body.kind)) ? String(body.kind) : "notes";
  let source_url: string | null = null;
  if (body.source_url) {
    try { const u = new URL(String(body.source_url)); if (/^https?:$/.test(u.protocol)) source_url = u.toString().slice(0, 1000); } catch { /* ignore */ }
  }
  return { title, trade, state, kind, source_url };
}

async function fetchPage(raw: string): Promise<{ title: string; text: string; url: string }> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new HttpError(400, "bad_request", "That doesn't look like a web address."); }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, "bad_request", "Use an http or https link.");
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1)/i.test(u.hostname) || /\.(local|internal)$/i.test(u.hostname)) {
    throw new HttpError(400, "bad_request", "That address isn't on the public internet.");
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(u, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": "LicensingBrosLibrary/1.0 (+study notes)", accept: "text/html,text/plain;q=0.9,*/*;q=0.5" } });
  } catch {
    throw new HttpError(400, "bad_request", "Couldn't open that page. Check the link and try again.");
  } finally { clearTimeout(t); }
  if (!res.ok) throw new HttpError(400, "bad_request", `That page answered with an error (${res.status}).`);
  const type = res.headers.get("content-type") || "";
  if (/pdf/i.test(type)) throw new HttpError(400, "bad_request", "That link is a PDF. Download it and use Upload a file instead.");
  if (!/text\/(html|plain)|xhtml/i.test(type)) throw new HttpError(400, "bad_request", "That link isn't a web page or text file.");
  const body = (await res.text()).slice(0, 4_000_000);
  if (/text\/plain/i.test(type)) return { title: u.hostname + u.pathname, text: body, url: res.url || u.toString() };
  const { title, text } = htmlToText(body);
  return { title: title || u.hostname, text, url: res.url || u.toString() };
}

Deno.serve(handler(async (req) => {
  const { user } = await requireUser(req);
  await requireStaff(user.id);
  const body = await readBody(req);
  const action = String(body.action || "");
  const db = adminClient();

  if (action === "add_text") {
    const text = typeof body.text === "string" ? body.text : "";
    if (text.trim().length < 20) throw new HttpError(400, "bad_request", "Add some text (at least a sentence).");
    return json(await saveLibraryDocument(user.id, docFields(body), text));
  }

  if (action === "add_url") {
    const page = await fetchPage(String(body.url || ""));
    if (page.text.length < 40) throw new HttpError(400, "bad_request", "That page has almost no text (it may need JavaScript or a sign-in).");
    const f = docFields({ ...body, kind: body.kind || "web", source_url: page.url, title: String(body.title || "").trim() || page.title });
    return json({ ...(await saveLibraryDocument(user.id, f, page.text)), title: f.title });
  }

  if (action === "embed") {
    return json(await embedPending(body.doc_id ? String(body.doc_id) : null));
  }

  if (action === "search") {
    const query = String(body.query || "").trim();
    if (query.length < 3) throw new HttpError(400, "bad_request", "Type a question to search for.");
    const trade = body.trade && TRADES.has(String(body.trade)) ? String(body.trade) : undefined;
    const state = body.state && STATES.includes(String(body.state)) ? String(body.state) : undefined;
    const hits = await searchLibrary(query, { trade, state, limit: 8 });
    return json({ hits });
  }

  if (action === "stats") {
    const [{ count: docs }, { count: passages }, { count: unindexed }] = await Promise.all([
      db.from("kb_docs").select("id", { count: "exact", head: true }),
      db.from("kb_chunks").select("id", { count: "exact", head: true }),
      db.from("kb_chunks").select("id", { count: "exact", head: true }).is("embedding", null)
    ]);
    return json({ builtin: kbStats(), library: { docs: docs ?? 0, passages: passages ?? 0, unindexed: unindexed ?? 0 } });
  }

  throw new HttpError(400, "bad_request", "Unknown action.");
}));
