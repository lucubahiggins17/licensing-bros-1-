# Licensing Bro's platform: build spec (source of truth for every build team)

Repo: /home/claude/licensing-bros. Next.js 14 App Router, **static export** (`output: "export"`, `trailingSlash: true`),
React 18, TypeScript (strict off). Backend = Supabase (Postgres + Auth + Storage + Realtime + Edge Functions in Deno).
The same build ships as the website and inside the Android app (Capacitor, `NEXT_PUBLIC_TARGET=app`).
Read these before writing code: `supabase/schema.sql` (tables, RLS, RPCs; already tested), `lib/types.ts`,
`lib/api.ts`, `lib/session.ts`, `lib/auth.tsx`, `lib/nav.ts`, `components/shell/*`, `app/globals.css`.

## Product
A contractor-licensing education platform for General Contractor, Electrical, Plumbing and HVAC exams in all 50 states.
Brand: **Licensing Bro's** (text). Logo image: `/logo.png` (640 px) and `/logo-sm.png` (nav). Audience: tradespeople who
are not tech-savvy, often on phones. Everything must feel advanced but be dead simple: big clear buttons, plain words,
one obvious next step on every screen, no jargon ("Travel mode", not "geo-fence override").

### Access model
- **Anonymous**: home page, course catalog, course outlines, live schedule, certificate verification.
- **Free account**: free courses (`courses.is_free`), preview lessons (`lessons.is_preview`), free lives (`lives.is_free`),
  community, and limited study tools: `site_settings.free_limits` = `{ai_daily:5, exam_max_questions:10, ai_exams:false, practice_sets:false}`.
- **Paid**: buying a course (Stripe Checkout) creates an `enrollments` row (source `stripe`) → full access to that course,
  to lives linked to it (`lives.course_id`) and, with any paid enrollment, to `paid_limits` study tools and lives with no course.
- **Admin** (`user_roles`): everything, plus /admin. People become admins with the **admin code** (`redeem_admin_code` RPC,
  entered at /admin): before any admin exists it always works (first-run claim; the code is printed when schema.sql runs);
  after that only while enabled. Admins manage it with `admin_code_info`, `admin_set_code(p_code|null)`,
  `admin_set_code_enabled`. 5 wrong tries per account per hour. `admin_setup_status()` tells /admin whether to show "Claim your site".
- `my_account()` RPC → `{is_admin, paid, enrolled:[course ids], limits}`; exposed as `useAuth().account`.

### One device at a time + home location (Netflix-style)
- On sign-in/app start the client calls `session` `claim`. If another device is active (heartbeat within
  `session_timeout_seconds`), the server answers `in_use`; the user can "Use it here instead" (takeover). The old device's
  next heartbeat gets `replaced`. UI for this already exists in `components/shell/SessionGuard.tsx`.
- Every edge-function call sends `x-session-id`. **Paid content** (paid lessons, paid lives) is only served when the
  session id is current **and** the location rule passes.
- Location = IP geolocation done server-side. First paid-content device sets the home area automatically. Outside the
  home radius (`location_rules.home_radius_miles`, default 100) → blocked with code `outside_home` unless Travel mode
  (`away_until` in the future and within radius of the away location). Turning on Travel mode or moving home requires a
  fresh email OTP (JWT `amr` contains method `otp` within 15 minutes). Limits: home change once per
  `home_change_days`; `away_passes_per_90_days` passes, each up to `away_max_days`.
- Free content never checks location. Admins bypass all checks.
- Client UI: when any call returns code `outside_home`, call `askForTravelMode()` from `components/shell/SessionGuard`.
  When it returns `session_replaced` or `no_session`, call `claimSession(false)` from `lib/session`.

## Design system (match the owner's screenshots exactly)
White "blueprint paper" grid background (`.blueprint`), navy `#1b1f3b` bands, safety orange `#f26a1b` primary,
hazard-tape yellow/navy stripes (`.hazard`), heavy uppercase **Archivo Black** headlines (`h1,h2` default font) with the
second line in orange, small letter-spaced uppercase labels (`.eyebrow`, `.label`), bolted sign plates (`.plate`, add
`<span className="bolts" />` inside for the bottom bolts), stat cards with colored top bars (`.statcard`), "Form CS-1"
panels with a hazard stripe top, numbered steps and a full-width navy uppercase submit (`.formcs`, `.stepnum`),
hard-shadow cards (`.card.hard`), tape cards (`.card.tape`). Buttons: `.btn`, `.btn.primary` (orange), `.btn.navy`,
`.btn.cta` (uppercase heavy), `.btn.sm`, `.btn.block`. Badges: `.badge.free|.paid|.live|.ai|.v|.warn`. Forms: `.field`
wrapper label with input/select/textarea inside. Layout: `.wrap` (1120 px), `.section`, `.section-head`, `.grid2`,
`.grid3`, `.row`, `.stack`. Icons: `lucide-react` (already installed). Use these global classes first; put anything
area-specific in a **CSS Module** next to your component (`Foo.module.css`), never in globals.css, so teams don't
collide. Phone width (360-430 px) must look great; the bottom tab bar covers 70 px at the bottom on phones.
Light theme only. Respect `prefers-reduced-motion`. Every control keyboard-focusable with visible focus.

## Page shell & routes
Every page renders `<AppShell>` (`components/shell/AppShell.tsx`): sticky nav (logo, Home, Courses, My Learning,
Community, Live, bell, ADMIN pill for admins, avatar menu) and phone bottom tabs. Static routes use query strings:
| Route | Component (owner) |
|---|---|
| `/` | `components/home/HomePage.tsx` (Engagement) |
| `/courses/` (`?state=&trade=`) | `components/courses/CatalogPage.tsx` (Courses) |
| `/course/?id=` (`&paid=1` after checkout) | `components/courses/CoursePage.tsx` (Courses) |
| `/lesson/?id=` | `components/courses/LessonPage.tsx` (Courses) |
| `/verify/?code=` | `components/courses/VerifyPage.tsx` (Courses) |
| `/learn/` (#tutor #review #exam #games #cards #tools #progress) | `components/Workspace.tsx` + study components (Study) |
| `/live/` | `components/live/LiveListPage.tsx` (Live) |
| `/live/watch/?id=` | `components/live/WatchPage.tsx` (Live) |
| `/live/studio/?id=` | `components/live/StudioPage.tsx` (Live; admin only) |
| `/community/` (`?post=`) | `components/community/CommunityPage.tsx` (Engagement) |
| `/account/` (#profile #devices #purchases #certificates) | `components/account/AccountPage.tsx` (Engagement) |
| `/admin/` (#dashboard #courses #lives #tests #users #community #notify #settings) | `components/admin/AdminPage.tsx` (Admin). #tests = AI builder for practice tests and game decks (`practice_sets.kind` = `test` or `game`) |
| `/login/` (`?mode=signup&next=`) | done |
Use `routes.*` from `lib/nav.ts` for links and `useQueryParam(name)` to read params. Never use `next/router`;
use `next/navigation` `useRouter` or `<Link>`. No dynamic route segments (static export). No server components that
fetch data; all data loading is client-side with `supabase()` from `lib/supabaseClient` or `callFn`/`streamFn` from `lib/api`.

## Edge functions (Backend team implements; everyone else calls them through `lib/api.ts`)
All POST JSON, CORS `*`, headers `authorization`, `apikey`, `x-session-id`. Errors: HTTP status + `{error, code}`.
Shared codes: `signed_out`(401), `forbidden`(403), `not_enrolled`(403), `no_session`(409), `session_replaced`(409),
`outside_home`(403, with `location`), `upgrade_required`(402), `limit_reached`(429), `bad_request`(400).
- `session` `{action}`: `claim {device, takeover, session_id?}` → `{status:"ok", session_id, location}` | `{status:"in_use", conflict}`;
  `heartbeat {session_id}` → `{status:"ok", location}` | `{status:"replaced", conflict}`; `release {session_id}`;
  `status {session_id}` → `{session, location, rules}`; `set_home`, `set_away {days}`, `end_away` → `{location}`.
  `location` shape = `LocationInfo` in `lib/session.ts`.
- `lesson` `{lesson_id}` → `LessonPayload` (`lib/types.ts`); `storage:` video paths become 2-hour signed URLs.
- `live-token` `{live_id, role:"viewer"|"host"}` → `LiveAccess` (`lib/types.ts`). LiveKit tokens: viewer = subscribe +
  data, no publish; host (admin) = publish + subscribe + data. Env: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
- `stripe-checkout` `{course_id, success_path?, cancel_path?}` → `{url}` (Stripe Checkout, promo codes allowed).
- `stripe-webhook` (no JWT): `checkout.session.completed` → enrollment + payment + notification; `charge.refunded` → refund.
- `tutor` (streams text) `{state, trade, messages, image?, context?, voice?}`: knowledge-base grounding (exists), plan
  daily limits, **state cross-check**: when the question can differ by state (licensing, lien law, code edition
  adopted, amendments, workers' comp, insurance/bond amounts) the model uses Anthropic web search
  (`web_search_20250305`, `user_location.region = state`, max 3 uses) to confirm the rule for that state from official
  sources and prefers it over generic notes; sources listed at the end as `Sources:` lines `- Title — URL`.
  `context` = extra text (lesson summary, the exam question being explained). `voice:true` = speech-friendly reply
  (no markdown symbols, no tables, <= 120 words, conversational, ends with a short check-in question).
- `generate` `{kind}`: `exam`, `pairs`, `plan`, `delete_account` (exist) + `admin_test {trade, state, part, count, topic?}`
  (admin only → `{questions: PracticeQuestion[]}`), `admin_pairs {trade, state, count, topic?, avoid?}` (admin only →
  `{pairs: {k, v}[]}` for game decks), `lesson_quiz {lesson_id}` (→ `{quiz: QuizItem[]}`),
  `community_answer {post_id}` (inserts an `is_ai` reply grounded in the KB, returns `{reply}`).

## Ownership (do not edit files owned by another team; tell the integrator in your final message instead)
- **Integrator (me)**: `app/layout.tsx`, `app/providers.tsx`, `app/globals.css`, `components/shell/*`, `lib/api.ts`,
  `lib/session.ts`, `lib/sessionId.ts`, `lib/auth.tsx`, `lib/nav.ts`, `lib/types.ts`, `supabase/schema.sql`, route files in `app/**/page.tsx`.
- **Backend**: `supabase/functions/**`, `supabase/config.toml`, `tests/functions/**`.
- **Admin**: `components/admin/**`.
- **Courses**: `components/courses/**`.
- **Live**: `components/live/**`.
- **Engagement**: `components/home/**`, `components/community/**`, `components/account/**`, `components/notifications/**`.
- **Study**: `components/Workspace.tsx`, `components/Tutor.tsx`, `components/Exam.tsx`, `components/Games.tsx`,
  `components/Flashcards.tsx`, `components/Calcs.tsx`, `components/ProgressPanel.tsx`, `components/ctx.tsx`,
  `components/Review.tsx`, `components/Study.module.css`, `components/voice/**`, `lib/ai.ts`, `lib/progress.ts`, `lib/native.ts`, `lib/data.ts`, `mobile/package.json`.
Shared reusable UI you create goes in your own folder; others may import it read-only (e.g. Courses may import
`components/voice/TalkButton` once Study publishes it, the Admin team links to `/live/studio/?id=` instead of
importing Live code).

## Quality bar
- Type-check your files: `cd /home/claude/licensing-bros && npx tsc --noEmit --incremental false -p .` (other teams'
  in-progress files may error; only your files must be clean). **Do not run `next build`** (the integrator does;
  parallel builds corrupt `.next`).
- Handle loading, empty, error and offline states with friendly copy. No `alert()`/`confirm()`; build confirm steps in.
- Never trust the client for access: the server (RLS or edge function) must enforce it; the client only hides UI.
- No fake data presented as real (no invented testimonials, stats or students). Empty states instead.
- Finish with a short report: files created, anything you need from the integrator or another team, how to test.
