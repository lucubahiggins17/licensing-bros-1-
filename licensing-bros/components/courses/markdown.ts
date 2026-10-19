// Safe Markdown → HTML for lesson bodies, course descriptions and tutor replies.
// Security model: ALL input is HTML-escaped first, then a small fixed set of tags is added
// (headings, paragraphs, bold/italic/strike, lists, links, images, inline code, code blocks,
// blockquotes, tables, horizontal rules). Link and image URLs go through an allowlist, so
// `javascript:` / `data:` / `vbscript:` (including whitespace or entity tricks) never reach an attribute.
// No regex lookbehind is used, so this runs on older iOS Safari and Android WebViews too.

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const UNESC: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);
const unescapeHtml = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => UNESC[e]);

/**
 * Takes an already-escaped URL and returns it ready for an attribute, or null when it isn't allowed.
 * Allowed: http(s), mailto, tel (links only) and relative URLs.
 */
export function safeUrl(escapedUrl: string, opts: { image?: boolean } = {}): string | null {
  const raw = unescapeHtml(escapedUrl).trim();
  if (!raw) return null;
  // Browsers ignore control characters and whitespace inside a scheme ("java\tscript:"), so check without them.
  const compact = raw.replace(/[\u0000- \u007f-\u009f]/g, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    const allowed = opts.image ? ["http", "https"] : ["http", "https", "mailto", "tel"];
    if (!allowed.includes(s)) return null;
  }
  return escapeHtml(raw);
}

// ---------------------------------------------------------------------------------------
// Inline formatting
// ---------------------------------------------------------------------------------------
type Ctx = { slots: string[] };
const PH = "\u0000";
const keep = (ctx: Ctx, html: string) => `${PH}${ctx.slots.push(html) - 1}${PH}`;

function restore(s: string, ctx: Ctx): string {
  for (let n = 0; n < 6 && s.includes(PH); n++) s = s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => ctx.slots[Number(i)] ?? "");
  return s;
}

/** Trailing punctuation that usually isn't part of a pasted URL. */
function splitTrailing(url: string): [string, string] {
  let tail = "";
  for (;;) {
    const ent = /(&quot;|&#39;|&gt;|&lt;)$/.exec(url);
    if (ent) { tail = ent[1] + tail; url = url.slice(0, -ent[1].length); continue; }
    const last = url.slice(-1);
    if (".,:;!?*_]".includes(last) && last) { tail = last + tail; url = url.slice(0, -1); continue; }
    if (last === ")" && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) { tail = last + tail; url = url.slice(0, -1); continue; }
    return [url, tail];
  }
}

function anchor(ctx: Ctx, href: string, inner: string, title?: string) {
  return keep(ctx, `<a href="${href}" target="_blank" rel="noopener noreferrer"${title ? ` title="${title}"` : ""}>${inner}</a>`);
}

// URL in (...) allowing one level of balanced parentheses, e.g. Wikipedia links
const URL_IN_PARENS = "((?:[^()\\s]|\\([^()\\s]*\\))+)";
const TITLE = "(?:\\s+&quot;(.*?)&quot;)?";
const IMG_RE = new RegExp(`!\\[([^\\]]*)\\]\\(${URL_IN_PARENS}${TITLE}\\)`, "g");
const LINK_RE = new RegExp(`\\[([^\\]]+)\\]\\(${URL_IN_PARENS}${TITLE}\\)`, "g");

function inline(s: string, ctx: Ctx, links = true): string {
  // 1. Code spans: protected from every other rule
  s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, _ticks, code: string) => keep(ctx, `<code>${code.trim()}</code>`));

  if (links) {
    // 2. Images
    s = s.replace(IMG_RE, (_, alt: string, url: string, title?: string) => {
      const u = safeUrl(url, { image: true });
      return u ? keep(ctx, `<img src="${u}" alt="${alt}" loading="lazy" decoding="async"${title ? ` title="${title}"` : ""}>`) : alt;
    });
    // 3. Links [text](url "title"); link text gets formatting but never nested links
    s = s.replace(LINK_RE, (_, text: string, url: string, title?: string) => {
      const u = safeUrl(url);
      return u ? anchor(ctx, u, inline(text, ctx, false), title) : text;
    });
    // 4. Autolinks <https://…> (arrive escaped as &lt;…&gt;)
    s = s.replace(/&lt;((?:https?:\/\/|mailto:)\S+?)&gt;/gi, (m, url: string) => {
      const u = safeUrl(url);
      return u ? anchor(ctx, u, url.replace(/^mailto:/i, "")) : m;
    });
    // 5. Bare URLs
    s = s.replace(/(^|[\s(\[])((?:https?:\/\/|www\.)[^\s\u0000]+)/gi, (m, pre: string, found: string) => {
      const [url, tail] = splitTrailing(found);
      const u = safeUrl(/^www\./i.test(url) ? `https://${url}` : url);
      return u ? pre + anchor(ctx, u, url) + tail : m;
    });
  }

  // 6. Emphasis (no lookbehind: the boundary character is captured and put back)
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, "$1<strong>$2</strong>");
  s = s.replace(/(^|[^\w*])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>");
  return s;
}

/** Inline-only Markdown (bold, italic, code, links) for short strings like quiz questions. */
export function renderInline(src: string): string {
  if (!src) return "";
  const ctx: Ctx = { slots: [] };
  return restore(inline(escapeHtml(String(src)), ctx), ctx);
}

// ---------------------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------------------
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE_RE = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const HR_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE_RE = /^\s{0,3}&gt;\s?/;

const indentOf = (l: string) => (/^\s*/.exec(l) as RegExpExecArray)[0].length;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
    if (s[i] === "|") { cells.push(cur.trim()); cur = ""; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

function isTableSep(line: string | undefined): boolean {
  if (!line || !line.includes("-")) return false;
  if (!/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line)) return false;
  return line.includes("|") || splitRow(line).length > 1;
}

function startsBlock(lines: string[], i: number): boolean {
  const l = lines[i];
  return FENCE_RE.test(l) || HEADING_RE.test(l) || HR_RE.test(l) || QUOTE_RE.test(l) || LIST_RE.test(l) ||
    (l.includes("|") && isTableSep(lines[i + 1]));
}

function table(lines: string[], start: number, ctx: Ctx): [string, number] {
  const head = splitRow(lines[start]);
  const aligns = splitRow(lines[start + 1]).map((c) => {
    const l = c.startsWith(":"), r = c.endsWith(":");
    return l && r ? "center" : r ? "right" : l ? "left" : "";
  });
  const cell = (tag: "th" | "td", text: string, idx: number) => {
    const a = aligns[idx];
    return `<${tag}${a ? ` style="text-align:${a}"` : ""}>${inline(text, ctx)}</${tag}>`;
  };
  let i = start + 2;
  const rows: string[] = [];
  while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
    const cells = splitRow(lines[i]);
    rows.push(`<tr>${head.map((_, k) => cell("td", cells[k] ?? "", k)).join("")}</tr>`);
    i++;
  }
  const html = `<div data-md="table"><table><thead><tr>${head.map((h, k) => cell("th", h, k)).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  return [html, i];
}

function list(lines: string[], start: number, ctx: Ctx): [string, number] {
  const first = LIST_RE.exec(lines[start]) as RegExpExecArray;
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const startNum = ordered ? parseInt(first[2], 10) : 1;
  const items: string[][] = [];
  let i = start;
  while (i < lines.length) {
    const l = lines[i];
    const m = LIST_RE.exec(l);
    if (m && m[1].length >= base && m[1].length <= base + 1) {
      if (/\d/.test(m[2]) !== ordered) break; // switching between bullets and numbers starts a new list
      items.push([m[3]]);
      i++;
      continue;
    }
    if (m && m[1].length < base) break;
    if (!l.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && indentOf(lines[j]) > base) { items[items.length - 1].push(""); i = j; continue; }
      const nm = j < lines.length ? LIST_RE.exec(lines[j]) : null;
      if (nm && nm[1].length >= base && nm[1].length <= base + 1 && /\d/.test(nm[2]) === ordered) { i = j; continue; }
      break;
    }
    if (indentOf(l) > base) { items[items.length - 1].push(l.slice(Math.min(indentOf(l), base + 2))); i++; continue; }
    if (!startsBlock(lines, i)) { items[items.length - 1].push(l.trim()); i++; continue; } // lazy continuation
    break;
  }
  const lis = items.map((itemLines) => {
    // Leading plain lines are the item's text; anything after a blank line or a nested block is rendered as blocks
    let k = 1;
    while (k < itemLines.length && itemLines[k].trim() && !startsBlock(itemLines, k)) k++;
    let text = itemLines.slice(0, k).map((t) => t.trim()).join("\n");
    let box = "";
    const task = /^\[( |x|X)\]\s+/.exec(text);
    if (task) { box = `<input type="checkbox" disabled${task[1] !== " " ? " checked" : ""}> `; text = text.slice(task[0].length); }
    const rest = itemLines.slice(k);
    const nested = rest.some((r) => r.trim()) ? blocks(rest, ctx) : "";
    return `<li>${box}${inline(text, ctx).replace(/\n/g, "<br>")}${nested}</li>`;
  });
  const tag = ordered ? "ol" : "ul";
  return [`<${tag}${ordered && startNum !== 1 ? ` start="${startNum}"` : ""}>${lis.join("")}</${tag}>`, i];
}

function blocks(lines: string[], ctx: Ctx): string {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) { buf.push(lines[i]); i++; }
      i++; // closing fence
      out.push(`<pre><code>${buf.join("\n")}</code></pre>`);
      continue;
    }

    const h = HEADING_RE.exec(line);
    if (h) {
      // The page already has an h1, so Markdown "#" becomes h2
      const level = Math.min(6, h[1].length + 1);
      out.push(`<h${level}>${inline(h[2], ctx)}</h${level}>`);
      i++;
      continue;
    }

    if (HR_RE.test(line)) { out.push("<hr>"); i++; continue; }

    if (QUOTE_RE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim() && QUOTE_RE.test(lines[i])) { buf.push(lines[i].replace(QUOTE_RE, "")); i++; }
      out.push(`<blockquote>${blocks(buf, ctx)}</blockquote>`);
      continue;
    }

    if (line.includes("|") && isTableSep(lines[i + 1])) {
      const [html, next] = table(lines, i, ctx);
      out.push(html);
      i = next;
      continue;
    }

    if (LIST_RE.test(line)) {
      const [html, next] = list(lines, i, ctx);
      out.push(html);
      i = next;
      continue;
    }

    // Paragraph: single line breaks are kept (authors type in a plain text box)
    const buf = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) { buf.push(lines[i].trim()); i++; }
    out.push(`<p>${inline(buf.join("\n"), ctx).replace(/\n/g, "<br>")}</p>`);
  }
  return out.join("\n");
}

/** Full Markdown → safe HTML string for dangerouslySetInnerHTML. */
export function renderMarkdown(src: string | null | undefined): string {
  if (!src) return "";
  const text = escapeHtml(String(src).replace(/\r\n?/g, "\n").replace(/\t/g, "    "));
  const ctx: Ctx = { slots: [] };
  return restore(blocks(text.split("\n"), ctx), ctx);
}

/** Plain text version (for AI context and previews): strips Markdown symbols. */
export function markdownToText(src: string | null | undefined): string {
  if (!src) return "";
  return String(src)
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*/g, ""))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
