// Knowledge library: splitting documents into passages and reading web pages.
import { strict as assert } from "node:assert";
import { chunkText, htmlToText } from "../../supabase/functions/_shared/logic.ts";

Deno.test("chunkText: passages near the target size, citations from the nearest heading", () => {
  const para = (n: number, word: string) => Array.from({ length: n }, (_, i) => `${word} rule number ${i} applies to every job site.`).join(" ");
  const doc = [
    "CHAPTER 3 GENERAL REGULATIONS",
    para(20, "Trenching"),
    "305.4 Freezing",
    para(10, "Freezing"),
    "",
    "Section 306 Trenching, Excavation and Backfill",
    para(40, "Backfill")
  ].join("\n\n");
  const p = chunkText(doc, { target: 600 });
  assert.ok(p.length >= 4, `got ${p.length}`);
  p.forEach((x, i) => assert.equal(x.seq, i));
  for (const x of p) assert.ok(x.text.length <= 3500 && x.text.length > 50, String(x.text.length));
  assert.equal(p[0].ref, "CHAPTER 3 GENERAL REGULATIONS");
  assert.ok(p.some((x) => x.ref === "305.4 Freezing" && x.text.includes("Freezing rule number 0")));
  assert.ok(p.some((x) => x.ref === "Section 306 Trenching, Excavation and Backfill" && x.text.includes("Backfill rule")));
  // No passage mixes two headings' text (overlap only carries text within a section)
  assert.ok(!p.some((x) => x.ref === "305.4 Freezing" && x.text.includes("Backfill")));
});

Deno.test("chunkText: overlap carries the previous sentence; huge paragraphs split by sentence", () => {
  const long = Array.from({ length: 200 }, (_, i) => `Sentence ${i} is about grounding electrodes.`).join(" ");
  const p = chunkText(long, { target: 500 });
  assert.ok(p.length > 10);
  const lastOfFirst = p[0].text.split(/(?<=\.)\s/).pop()!;
  assert.ok(p[1].text.startsWith(lastOfFirst), `${p[1].text.slice(0, 60)} / ${lastOfFirst}`);
  for (const x of p) assert.ok(x.text.length <= 900, String(x.text.length));
  assert.equal(chunkText(long, { target: 500, overlap: false })[1].text.startsWith("Sentence"), true);
});

Deno.test("chunkText: markdown headings, empty input, whitespace cleanup", () => {
  const p = chunkText("# Lien law\n\nA mechanic's lien must be recorded within 90 days.\n\n## Notices\n\nSend notice of nonpayment.\r\n\r\n\r\nMore   text\there.");
  assert.deepEqual(p.map((x) => x.ref), ["Lien law", "Notices"]);
  assert.ok(p[1].text.includes("More text here."));
  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText("   \n\n  "), []);
  // Plain sentences ending in periods are never mistaken for headings
  assert.equal(chunkText("THE CONTRACTOR SHALL COMPLY.\n\nBody text goes here and keeps going.")[0].ref, null);
});

Deno.test("htmlToText: keeps headings, paragraphs, lists and tables; drops scripts, menus and footers", () => {
  const html = `<!doctype html><html><head><title>Contractor Licensing | TN.gov</title><style>p{color:red}</style><script>alert(1)</script></head>
  <body><nav><a>Home</a><a>Menu item</a></nav><header>Site header</header>
  <main><h1>Licensing Requirements</h1><p>A license is required for projects of <b>$25,000</b> or more.</p>
  <h2>Classifications</h2><ul><li>BC &ndash; Building</li><li>CMC &amp; mechanical</li></ul>
  <table><tr><th>Limit</th><th>Amount</th></tr><tr><td>Unlimited</td><td>&#36;1,500,000+</td></tr></table>
  <!-- hidden comment --></main><footer>Copyright footer</footer></body></html>`;
  const { title, text } = htmlToText(html);
  assert.equal(title, "Contractor Licensing | TN.gov");
  assert.ok(text.includes("# Licensing Requirements"));
  assert.ok(text.includes("A license is required for projects of $25,000 or more."));
  assert.ok(text.includes("## Classifications"));
  assert.ok(text.includes("- BC – Building"));
  assert.ok(text.includes("- CMC & mechanical"));
  assert.ok(text.includes("| Unlimited | $1,500,000+"));
  for (const gone of ["alert(1)", "color:red", "Menu item", "Site header", "Copyright footer", "hidden comment"]) assert.ok(!text.includes(gone), gone);
  // And the result splits into cited passages
  const p = chunkText(text);
  assert.equal(p[0].ref, "Licensing Requirements");
  assert.ok(p.some((x) => x.ref === "Classifications"));
});

import { searchFacts } from "../../supabase/functions/_shared/kb.ts";
Deno.test("searchFacts: plumbing ranks the student's own code (IPC in Tennessee, UPC in California) first", () => {
  const q = "maximum trap arm length for a 2 inch fixture drain";
  const tn = searchFacts(q, { trade: "plumb", state: "Tennessee", limit: 5 });
  const ca = searchFacts(q, { trade: "plumb", state: "California", limit: 5 });
  assert.ok(/^IPC/.test(tn[0].source), tn[0].source);
  assert.ok(/^UPC/.test(ca[0].source), ca[0].source);
  // Asking for the other code by name still finds it first
  assert.ok(/^UPC/.test(searchFacts(`UPC ${q}`, { trade: "plumb", state: "Tennessee", limit: 3 })[0].source));
});
