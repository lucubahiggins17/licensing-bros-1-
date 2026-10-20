# Knowledge round 5: writer brief

You are adding verified exam-prep knowledge for Licensing Bro's, a school that prepares people for U.S. contractor
licensing exams (general contractor, electrical, plumbing, HVAC/mechanical, plus business & law). Students rely on
this to pass, and a wrong number can fail them. Accuracy beats volume, every time.

Repo root: /home/claude/licensing-bros-1-

## Output
Write ONE file: knowledge/rounds/round5/<your-name>.json, exactly this shape:
{
  "source": "short description of this round",
  "facts": [
    {"id": "<PREFIX>-1", "topic": "...", "trade": "gc|law|elec|plumb|hvac", "state": null or "Full State Name",
     "source": "exact citation, e.g. NEC 2023 310.16 / IPC 2021 Table 709.1 / 29 CFR 1926.501(b)(1) / O.C.G.A. 44-14-361.1 / board page title + URL",
     "fact": "1-3 plain sentences a student can learn from, specific and self-contained (say which code/edition or state it applies to)",
     "status": "verified" or "unverified",
     "note": "why unverified, or an edition caveat; else empty",
     "keywords": ["4-8 search words students might use"]}
  ],
  "questions": [
    {"t": "gc|law|elec|plumb|hvac", "topic": "...", "q": "exam-style question", "c": ["4 distinct choices"], "a": 0-3,
     "ref": "citation, max 60 chars", "why": "one or two sentences explaining the right answer"}
  ]
}
Validate it at the end: node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.facts.length,j.questions.length)' <file>

## Before you write
Read supabase/functions/_shared/kb.json (facts array) and filter to your trade/topics, so you add NEW ground instead of
repeating what's there. Reuse existing topic names when a fact fits one (see the list for your trade); create a new
topic name only for genuinely new areas.

## Accuracy rules
- Editions: NEC 2023 (NFPA 70); IPC, IMC, IFGC, IBC, IRC 2021 (note a 2024 change in "note" when you know one);
  UPC 2021/2024 only for UPC-specific facts (say "UPC"); OSHA 29 CFR 1926/1910 as currently in force; EPA 40 CFR Part 82
  Subpart F and the AIM Act rules (40 CFR Part 84) as currently in force.
- Use WebSearch/WebFetch to confirm every number, threshold, table value and section number. Prefer official sources:
  ecfr.gov, osha.gov, epa.gov, state .gov sites and legislature/statute sites, codes.iccsafe.org, up.codes, nfpa.org free
  access, testing-company candidate bulletins (PSI, Prometric, Pearson VUE). Respected trade references (Mike Holt,
  IAEI, ICC/IAPMO publications, manufacturer technical manuals) are acceptable when the code text isn't reachable.
- "verified" = you confirmed it against the code/regulation text or an official page, or two independent reputable
  references agree. Otherwise "unverified" with the reason in note. Never use quizlet, brainscape, cram, studystack,
  chegg, coursehero, reddit, quora or other study-card/forum sites as sources; their answers are often wrong.
- Never invent a section number. If you can't pin the section, cite the article/chapter and mark unverified.
- State the rule as the code says it, including the exception students get tested on when it matters.
- Each question must be answerable from a fact in your file, with exactly one defensible answer and plausible wrong
  choices. Don't make "all of the above" questions. Avoid trick wording.
- Plain, friendly wording (8th-grade reading level), no marketing.

## When you finish
Reply with: counts (facts verified/unverified, questions), the topics you covered, and anything you were unsure about.
