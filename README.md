# Licensing Bro's

The contractor-licensing education platform for General Contractor, Electrical, Plumbing and HVAC exams in all 50 states and DC. One codebase ships as the **website**, which works in any desktop browser and on tablets and phones, and as the **Android app**. iPhone and iPad users use the website in Safari and can add it to their home screen like an app.

## What's inside

**For students**
- **Free accounts** get free courses, free live classes, the community, and limited study tools (5 AI questions a day and 10-question practice exams). Buying a course unlocks all of it, plus the full study tools.
- **Courses**: catalog with the "Find your course" state and trade finder, course pages with Stripe checkout, a lesson player (video with resume and speed, reading, quizzes, downloads, notes), and completion certificates anyone can verify at `/verify`.
- **Live classes**: watch in the browser or app, with live chat, offers that pop up during class, polls and replays.
- **Talk to Bro**: a voice AI tutor. Students talk, Bro answers out loud and then listens again, hands-free. Text chat and photo questions work too. Answers are built on the **checked knowledge base** (see `KNOWLEDGE_BASE.md`) plus anything you add to the knowledge library, and cite the code section. When a rule can differ by state (licensing, liens, bonds, code editions), Bro searches official sources for the student's state first (skipping public flashcard and Q&A sites) and lists them.
  - **Fast and exact**: quick questions and voice go to a fast model, calculations and explanations to the strongest one, and every multi-step calculation runs through an exact calculator instead of the AI's head. The tutor answers first, never guesses a number, and names the section to check when it isn't sure.
- **Study tools**: timed mock exams (verified question bank, AI sets for each state, and sets you publish), Smart Review that brings back missed questions, games (Code Match, Speed Round, Calc Sprint) that can use the decks and tests you publish, spaced-repetition flashcards, field calculators, the **readiness score**, streaks, XP and badges.
- **Community Q&A** with "Ask AI Bro" answers, plus a notification bell.

**Account protection (like Netflix)**
- **One device at a time.** Opening the account somewhere new asks "Use it here instead?" and pauses the other device.
- **Home area.** Paid lessons and classes play within about 100 miles of home. The home area is set automatically from the internet connection the first time someone opens paid content.
- **Travel mode** lets students study away from home. Turning it on, or moving home, needs a 6-digit code emailed to the account owner, so a shared password isn't enough.
- All of this is enforced on the server and adjustable in **Admin → Settings**.

**For you (Admin control center at `/admin`)**
- **Bro Command (command center)**: your AI chief of staff. Ask in plain words or by voice: "Who's at risk of failing this month?", "Build a 25-question Tennessee lien law test", "Plan Thursday's live class around what students miss", "Email my instructors a summary". It looks up students, stats and topic trends, builds draft tests, game decks and class plans, and prepares announcements, emails, live classes, publishing and automation changes, which only happen after you tap **Confirm**.
- **Knowledge library**: add PDFs (candidate bulletins, board rules, your notes), pasted text or web pages. They're split into cited passages that the tutor, the builders and Bro Command search by keyword and by meaning. Includes a "test what the AI finds" box.
- **Automations**: a weekly team digest, at-risk alerts, study nudges for students who go quiet, exam countdown tips, and new signup alerts. Switch each on or off and pick when it runs and who hears about it.
- **Instructors**: make a teammate an instructor (Students → open them). Instructors get Bro Command, the AI builder, the knowledge library, live classes, announcements and community moderation, without prices, settings, roles or payments.
- **Dashboard**: students, paying students, revenue, who's online, AI use, signups chart, and the topics students miss most.
- **Courses**: modules, lessons, video uploads or YouTube/Vimeo links, markdown lessons, and quizzes, with an AI quiz writer.
- **Live classes**: schedule them, then go live from your browser in the **Live studio** (camera, mic, screen share). During class, push course offers with promo codes, links, polls and messages.
- **AI builder (tests & games)**: pick trade, state, section and topic. The AI writes practice tests (multiple choice) or **game decks** (term-and-meaning cards) from the checked facts. You review and edit, then publish. Tests appear in Practice exam and Speed Round; decks appear in Code Match and Flashcards.
- **Admin code**: the code that makes someone an admin. Before there's any admin it claims the site; after that, admins share it to add teammates, and change it or switch it off in Settings.
- **Students**: grant or revoke courses, sign out a device, reset a home area, make or remove admins.
- **Also**: community moderation, announcements, and settings for homepage text and stats, plan limits, location rules and the admin code.

**Stack:** Next.js (static, hosted on GitHub Pages or any static host) + Capacitor for Android. Supabase handles accounts, the database, storage, realtime and edge functions. Stripe takes payments, LiveKit runs live video, and Anthropic powers the AI. No other servers.

---

## Setup (one time, about 60–90 minutes)

You'll create a few accounts, then GitHub deploys everything.

### 1. Supabase (database, accounts, backend)
1. Create a project at https://supabase.com.
2. Open **SQL Editor**, paste all of `supabase/schema.sql`, and click **Run**.
3. Copy **your admin code** from the results panel under the editor (it looks like `LB-7KQ2-M9XD-4TPA`). Once the site is live, sign up, open `/admin`, and enter it to become the first admin. Lost it? Run `schema.sql` again; it shows the same code and changes nothing else. (The SQL way still works: `insert into public.user_roles (user_id, role) select id, 'admin' from auth.users where email = 'you@example.com';`)
4. Under **Authentication → Email (Notifications) → Templates → Magic Link**, make sure the email shows the code: `Your Licensing Bro's code is {{ .Token }}`. The code is used for password resets, Travel mode and moving home.
5. Under **Authentication → URL Configuration**, set **Site URL** to your website and add `https://YOUR-SITE/learn/` to the redirect URLs.
6. Under **Authentication → Email (Notifications) → SMTP Settings**, connect a real email sender (Resend, Postmark, Brevo or SendGrid). This is required: Supabase's built-in sender only emails members of your Supabase team and only about 2 messages an hour, so students can't sign up until this is done.
7. Save three values for later: the **Project URL** and **publishable key** (starts with `sb_publishable_`; the older "anon" key also works), (click **Connect** at the top of the project to see both; every key also lives under Settings → API Keys), and the **Project ID** (Settings → General). Also create an access token at https://supabase.com/dashboard/account/tokens. The backend reads Supabase's new secret key automatically and falls back to the legacy service_role key, so it keeps working after Supabase retires legacy keys.

### 2. Anthropic (AI)
Create an API key in the Claude Console at https://platform.claude.com/settings/keys, add credits under Billing, and set a monthly spend limit. Web search for state rules costs $10 per 1,000 searches plus tokens, and only runs on state-sensitive questions.

### 3. Stripe (payments)
1. Get your **secret key** at https://dashboard.stripe.com/apikeys. Start with test mode.
2. Add a webhook under **Developers → Webhooks**. The URL is `https://YOUR-PROJECT.supabase.co/functions/v1/stripe-webhook`, and the events are `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `charge.refunded`. Copy its **signing secret**.
3. Promo codes you create in Stripe (Products → Coupons) work at checkout. Use them for live-class offers.

### 4. LiveKit (live classes)
Create a free project at https://cloud.livekit.io and copy the **URL** (`wss://…`), **API key** and **API secret**. Prefer streaming from OBS or StreamYard instead? Pick "Stream link" when you schedule a class, and you won't need LiveKit for that class.

### 5. Optional: ipinfo (better location accuracy)
A free token from https://ipinfo.io raises the lookup limits. Without one, location still works at lower volume.

### 6. GitHub (deploys everything)
1. Push this folder to a **private** repo with GitHub Desktop or `git push`. Drag-and-drop in the GitHub web page can skip the hidden `.github` folder.
2. In the repo, go to **Settings → Secrets and variables → Actions** and add these.

   **Variables:**
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_PROJECT_REF`
   - `SITE_URL` (your website, e.g. `https://licensingbros.com`)

   **Secrets:**
   - `SUPABASE_ACCESS_TOKEN`
   - `ANTHROPIC_API_KEY`
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
   - `AUTOMATION_SECRET` (any long random text; lets the hourly **Run automations** workflow start the automations)
   - `RESEND_API_KEY` and `EMAIL_FROM` (optional; team emails from Bro Command and automations, e.g. `Licensing Bro's <team@yourdomain.com>` from a domain you verified at resend.com)
   - `IPINFO_TOKEN` (optional)

   **Optional AI variables:** `ANTHROPIC_MODEL` (main model, default `claude-sonnet-5-5`), `ANTHROPIC_FAST_MODEL` (quick answers and voice, default `claude-haiku-5-5`), `ANTHROPIC_ROUTING` (`off` sends everything to the main model).
3. Open **Actions → Build Android app → Run workflow**. It tests and deploys the backend, then builds the APK. Download it from the finished run under **Artifacts**. Push a tag (`git tag v1.0.0 && git push --tags`) to publish the APK on a Releases page.

### 7. Website (GitHub Pages)
The `Publish website` workflow builds the site and publishes it to GitHub Pages on every push to `main`, using the same `SUPABASE_URL` and `SUPABASE_ANON_KEY` variables as the app.
1. In the repo, open **Settings → Pages** and set **Source** to **GitHub Actions**. Publishing from a private repo needs a paid GitHub plan (GitHub Pro); the published site itself is public either way.
2. Open **Actions → Publish website → Run workflow**. The site appears at `https://YOUR-USERNAME.github.io/licensing-bros/` (the build handles the subfolder automatically).
3. For your own domain, enter it under **Settings → Pages → Custom domain**, add the DNS records GitHub lists (four `A` records for the bare domain and a `CNAME` for `www` pointing to `YOUR-USERNAME.github.io`), wait for the check to pass, tick **Enforce HTTPS**, and run the workflow again.

GitHub's rules say Pages isn't meant to run an online business or e-commerce site, so treat it as your free setup and testing host. Before you take real payments, move the website to a host that allows business use, such as Vercel Pro: import the repo at https://vercel.com, add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the publishable key) and `NEXT_PUBLIC_SITE_URL`, deploy, point your domain there, and disable the `Publish website` workflow. No code changes are needed; any static host works (build command `npx next build`, output folder `out`).

### 8. Google Play (optional)
Add a signing key so the workflow also builds the Play Store bundle (`.aab`):
1. Create the key: `keytool -genkeypair -v -keystore upload.jks -alias licensingbros -keyalg RSA -keysize 2048 -validity 10000`
2. Add four secrets: `ANDROID_KEYSTORE_BASE64` (the output of `base64 -w0 upload.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`.

Back up the key. Play also needs a privacy policy link; in-app account deletion is already built in.

---

## Setup check
Open `https://YOUR-SITE/status/` (or Admin → Dashboard → **Setup check**) any time. It tests the site's Supabase address and key, whether sign-ups are allowed, whether `schema.sql` ran, whether an admin exists and whether the backend functions are deployed. Signed in as the admin, it also checks the AI, Stripe and LiveKit keys and the `SITE_URL`. Each line says what to fix. The GitHub workflows also tidy and test the Supabase variables before every build and show the result on the run's page.

## Running your business: quick guide
- **Add a course**: Admin → Courses → New course. Fill in the details and price, add modules and lessons, upload videos or paste YouTube/Vimeo links, and write quizzes yourself or with AI. Then flip **Published**.
  - Free courses need the **Free** switch.
  - Mark a lesson **Preview** to give it away as a sample.
- **Host a live class**: Admin → Live classes → New. Choose **Go live from browser**, then open the studio and press **Go live**. Students get a notification instantly.
  - During class, use the offer console to push a course with a promo code, a link or a poll. Results update live.
  - Afterwards, paste a replay link.
- **Build a test with AI**: Admin → AI builder → Build a test with AI. Review every question before publishing. Mark it Free to share it with free accounts.
- **Build a game with AI**: Admin → AI builder → Build a game with AI. Pick trade, state and a topic (or leave it empty), choose how many cards, and let the AI write them. Edit or replace any card, then Publish. Students pick it under Games → Code Match and in Flashcards.
- **Add an admin**: Admin → Settings → Admin code → Copy invite message, and send it. They sign in, open `/admin`, and enter the code. Make a new code (or switch it off) when you're done adding people. Remove admins in Students.
- **Help a student**: Admin → Students → open them. Grant a course, sign out their device, or reset their home area if they moved. Or ask Bro Command for their report and a study plan.
- **Add an instructor**: Admin → Students → open them → Make instructor. They see **Instructor tools** in their menu.
- **Teach the AI your material**: Admin → Knowledge → upload a PDF, paste text or add a web page. Only add material you have the right to use.
- **Put follow-ups on autopilot**: Admin → Automations. Add the `AUTOMATION_SECRET` secret once so they run every hour.
- **Change limits and rules**: Admin → Settings covers free/Pro limits, home radius, travel passes, and the homepage text and stats. Keep the stats true.

## Payments in the Android app
Google requires its own billing for digital goods sold inside Android apps, so the app sends buyers to your website to pay. The course unlocks in the app automatically, on the same account. Check Google Play's current payments policy before launch, since the rules have been changing.

## Tests
`bash tests/run-all.sh` runs every suite:
- **Database security** against real Postgres in-process (with pgvector): 145 checks (paid content can't be self-unlocked, admin powers and the admin code are protected, instructors get teaching tools but not owner controls, the knowledge library search and its privacy, command center and automations permissions, older projects upgrade in place, and so on).
- **Backend logic**: 79 Deno tests covering location rules, device sessions, Stripe signatures, LiveKit tokens, video links, AI output checks, model routing, the exact calculator, the tutor's answer loop against a fake AI server, document splitting, student risk scoring and automation schedules.
- **Production build.**
- **Browser tests**: 184 checks that click through the site as a visitor, a free student, a paying student, an instructor and the admin, on desktop and phone, including voice playback, the knowledge library (with a real PDF), Bro Command and automations.
- **GitHub Pages subfolder**: builds the site for `you.github.io/licensing-bros` and checks every file and link stays inside the subfolder (13 checks).
- **Device sweep**: opens all 25 main screens on 8 screen sizes (small phone, phone, iPad mini, iPad Air, iPad landscape, iPad Pro landscape, laptop, 1920 desktop) and fails on sideways scrolling, content wider than the screen, or errors.

## Project map
| Path | What it is |
|---|---|
| `components/home` | Home page in your design, plus the signed-in dashboard |
| `components/courses` | Catalog, course page, lesson player, certificates |
| `components/live` | Live list, watch page with chat and offers, host studio |
| `components/voice` | Talk to Bro voice mode |
| `components/admin` | Admin control center |
| `components/community`, `components/account`, `components/notifications` | Community, account and devices, bell |
| `components/Workspace.tsx` + study components | My Learning: tutor, exams, review, games, flashcards, calculators, progress |
| `components/shell` | Navigation, one-device and travel dialogs |
| `supabase/schema.sql` | Database, security rules, admin tools |
| `supabase/functions` | Backend: `tutor`, `generate`, `session`, `lesson`, `live-token`, `stripe-checkout`, `stripe-webhook`, `library` (knowledge library), `assistant` (Bro Command), `automations` |
| `supabase/functions/_shared/kb.json`, `lib/kb-questions.json` | Knowledge base and verified questions (`KNOWLEDGE_BASE.md`) |
| `mobile/` | Android app (Capacitor) |
| `tests/` | All automated tests |
| `docs/BUILD_SPEC.md` | Technical spec for developers |

## Plans you'll need once you're selling
Supabase's free plan pauses a project after a week with no activity and caps uploads at 50 MB, so move to Pro (from $25/month) before launch, or host lesson videos on YouTube/Vimeo (unlisted) and paste the links. LiveKit's free Build plan includes 5,000 participant-minutes a month (about one 100-minute class with 50 viewers); for bigger classes use the "Stream link" option with YouTube or StreamYard.

## Before you sell it
- Practice questions teach tested concepts. They aren't real exam items, and the site says so; don't market it that way.
- Have a licensed reviewer check the flagged facts in `KNOWLEDGE_BASE.md`. Code editions differ by state.
- Add Terms of Service and a Privacy Policy, and mention location checks, since the site uses connection location to protect accounts.
- Keep homepage numbers truthful (Admin → Settings).
