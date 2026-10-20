# Knowledge round 5: independent audit brief

You are an independent fact-checker for Licensing Bro's, a contractor licensing exam prep school. Another writer
produced the round file named in your task. You did NOT write it. Students will memorize these facts and answer
these questions on real exams, so be strict: a wrong number can fail someone.

Repo root: /home/claude/licensing-bros-1-

## What to check
For EVERY fact and EVERY question in the round file:
- Is it correct for the stated code/edition/regulation/state as currently in force? Check numbers, thresholds,
  table values, section numbers, dates and exceptions against official sources with WebSearch/WebFetch: ecfr.gov,
  osha.gov, epa.gov, state .gov / legislature / board sites, codes.iccsafe.org, up.codes, nfpa.org free access,
  testing-company candidate bulletins. Respected trade references (Mike Holt, IAEI, ICC/IAPMO, manufacturer manuals)
  are acceptable when the code text isn't reachable. Never rely on quizlet/brainscape/cram/chegg/reddit-type sites.
- Is the citation right (the section actually says this)?
- Is it misleading by omission (missing the exception that's commonly tested)?
- For questions: exactly one defensible correct answer? Is "a" pointing at it? Are the distractors clearly wrong?
  Does "why" explain it correctly? Is "ref" right?
- State facts: is it still current (code adoptions change; note effective dates)? Is "verified" justified? If you
  can't confirm a state fact on an official page, mark it "unverify" (not remove) unless you find it's wrong.

## Output
Write knowledge/audits/result_round5_<name>.json, listing ONLY items that need a change:
{
  "facts": [
    {"id": "<fact id>", "action": "fix" | "unverify" | "remove", "reason": "what was wrong, with the source you checked",
     "fixed": {"fact": "...", "source": "...", "keywords": [...]}}   // fixed: only fields that change; omit for remove/unverify unless also correcting text
  ],
  "questions": [
    {"i": <0-based index in the questions array>, "action": "fix" | "remove", "reason": "...",
     "fixed": {"q": "...", "c": ["..."], "a": 1, "ref": "...", "why": "..."}}   // only fields that change
  ]
}
- "fix": you know the correct version (write it fully in "fixed").
- "unverify": plausible but you couldn't confirm it from an authoritative source.
- "remove": wrong and not fixable with confidence, a duplicate, or not useful for an exam.
Items you don't list are kept as they are, so only leave something out if you checked it and it's right.
Validate your JSON with node at the end. Then reply with counts (checked, fixed, unverified, removed) and the most
important corrections.
