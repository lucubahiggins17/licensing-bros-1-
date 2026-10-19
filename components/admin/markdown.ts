// Safe Markdown → HTML for lesson notes. Everything is HTML-escaped first, so lesson text can never inject markup.
// Supports: # headings, **bold**, *italic*, ~~strike~~, `code`, ``` code blocks, - / 1. lists, > quotes, --- rules,
// [links](https://...), ![images](https://...) and simple | tables |.
// Other teams may import renderMarkdown read-only so the lesson page matches the admin preview.

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const unesc = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function safeUrl(raw: string, images = false): string | null {
  const u = raw.trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (!images && /^mailto:/i.test(u)) return u;
  if (u.startsWith("/") && !u.startsWith("//")) return u;
  if (!images && u.startsWith("#")) return u;
  return null;
}

/** Inline formatting. Input must already be HTML-escaped. */
function inline(s: string): string {
  const codes: string[] = [];
  let out = s.replace(/`([^`]+)`/g, (_m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    const u = safeUrl(unesc(url), true);
    return u ? `<img src="${esc(u)}" alt="${alt}" loading="lazy">` : m;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, txt, url) => {
    const u = safeUrl(unesc(url));
    return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${txt}</a>` : txt;
  });
  out = out
    .replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_([^_\s](?:[^_]*[^_\s])?)_(?![\w])/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${codes[Number(i)]}</code>`);
}

const LIST_RE = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const splitRow = (ln: string) => ln.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function renderMarkdown(src: string): string {
  const lines = (src || "").replace(/\r\n?/g, "\n").split("\n");
  let out = "";
  let para: string[] = [];
  const flush = () => {
    if (para.length) out += `<p>${para.map((l) => inline(esc(l.trim()))).join("<br>")}</p>`;
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];

    // fenced code block
    if (/^\s*```/.test(ln)) {
      flush();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out += `<pre><code>${esc(buf.join("\n"))}</code></pre>`;
      continue;
    }
    if (!ln.trim()) { flush(); i++; continue; }

    // headings: # → h2 (the lesson title is the page's h1)
    const h = ln.match(/^\s{0,3}(#{1,4})\s+(.*?)\s*#*\s*$/);
    if (h) {
      flush();
      const lvl = Math.min(5, h[1].length + 1);
      out += `<h${lvl}>${inline(esc(h[2]))}</h${lvl}>`;
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)) { flush(); out += "<hr>"; i++; continue; }

    // blockquote
    if (/^\s*>/.test(ln)) {
      flush();
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      out += `<blockquote>${renderMarkdown(buf.join("\n"))}</blockquote>`;
      continue;
    }

    // table
    if (ln.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      flush();
      const head = splitRow(ln);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitRow(lines[i++]));
      out += `<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(esc(c))}</th>`).join("")}</tr></thead><tbody>${rows
        .map((r) => `<tr>${head.map((_, k) => `<td>${inline(esc(r[k] ?? ""))}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`;
      continue;
    }

    // lists (consecutive items of the same kind; indented lines continue the last item)
    const m = ln.match(LIST_RE);
    if (m) {
      flush();
      const ordered = /\d/.test(m[2]);
      const tag = ordered ? "ol" : "ul";
      const start = ordered ? parseInt(m[2], 10) : 1;
      const items: string[] = [];
      while (i < lines.length) {
        const mm = lines[i].match(LIST_RE);
        if (mm && /\d/.test(mm[2]) === ordered) { items.push(mm[3]); i++; continue; }
        if (!mm && items.length && /^\s{2,}\S/.test(lines[i])) { items[items.length - 1] += "\n" + lines[i].trim(); i++; continue; }
        break;
      }
      out += `<${tag}${ordered && start !== 1 ? ` start="${start}"` : ""}>${items
        .map((t) => `<li>${t.split("\n").map((p) => inline(esc(p))).join("<br>")}</li>`)
        .join("")}</${tag}>`;
      continue;
    }

    para.push(ln);
    i++;
  }
  flush();
  return out;
}
