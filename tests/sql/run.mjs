// Runs supabase/schema.sql inside an in-process Postgres (PGlite) and checks the security rules.
// Usage: cd tests && npm install && node sql/run.mjs
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const schema = fs.readFileSync(path.join(here, "../../supabase/schema.sql"), "utf8");
const stub = fs.readFileSync(path.join(here, "supabase-stub.sql"), "utf8");

const db = new PGlite({ extensions: { pgcrypto } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name, extra); } };

async function as(userId, role, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId || ""}', false); set role ${role};`);
  try { return await fn(); } finally { await db.exec("reset role;"); }
}
async function tryQ(sql, params) { try { const r = await db.query(sql, params); return { rows: r.rows, error: null }; } catch (e) { return { rows: [], error: e.message }; } }

await db.exec(stub);
await db.exec(schema);
console.log("schema loaded");
// Running it twice must also work
await db.exec(schema);
ok("schema is re-runnable", true);

// --- seed ---
const ids = {};
for (const name of ["admin", "free", "paid", "other"]) {
  const r = await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [`${name}@test.com`, JSON.stringify({ full_name: name.toUpperCase() })]);
  ids[name] = r.rows[0].id;
}
await db.query(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [ids.admin]);
const c = await db.query(`insert into public.courses (slug, title, price_cents, published) values ('gc-master', 'GC Master Course', 29900, true), ('free-osha', 'Free OSHA Basics', 0, true), ('draft', 'Draft Course', 9900, false) returning id, slug`);
const course = Object.fromEntries(c.rows.map((r) => [r.slug, r.id]));
await db.query(`update public.courses set is_free = true where slug = 'free-osha'`);
const l = await db.query(`insert into public.lessons (course_id, title, sort) values ($1, 'Lesson 1', 1), ($1, 'Lesson 2', 2), ($2, 'Free lesson', 1) returning id`, [course["gc-master"], course["free-osha"]]);
const [l1, l2, lf] = l.rows.map((r) => r.id);
await db.query(`insert into public.lesson_content (lesson_id, video_url, body_md) values ($1, 'storage:secret.mp4', 'secret body')`, [l1]);
await db.query(`insert into public.enrollments (user_id, course_id, source) values ($1, $2, 'stripe')`, [ids.paid, course["gc-master"]]);
const lv = await db.query(`insert into public.lives (title, is_free, course_id) values ('Paid live', false, $1), ('Free live', true, null) returning id`, [course["gc-master"]]);
const [livePaid, liveFree] = lv.rows.map((r) => r.id);

console.log("\nprofiles");
ok("profile created by trigger", (await db.query(`select count(*)::int n from public.profiles`)).rows[0].n === 4);
ok("full_name from signup metadata", (await db.query(`select full_name from public.profiles where id = $1`, [ids.free])).rows[0].full_name === "FREE");

console.log("\ncatalog visibility");
const anonCourses = await as(null, "anon", () => tryQ(`select slug from public.courses order by slug`));
ok("anonymous sees published courses only", JSON.stringify(anonCourses.rows.map((r) => r.slug)) === JSON.stringify(["free-osha", "gc-master"]), JSON.stringify(anonCourses));
const adminCourses = await as(ids.admin, "authenticated", () => tryQ(`select slug from public.courses`));
ok("admin sees drafts", adminCourses.rows.length === 3);
const anonLessons = await as(null, "anon", () => tryQ(`select id from public.lessons`));
ok("lesson outline is public", anonLessons.rows.length === 3);

console.log("\nprotected lesson content");
const paidContent = await as(ids.paid, "authenticated", () => tryQ(`select * from public.lesson_content`));
ok("students cannot read lesson_content directly (edge function only)", paidContent.rows.length === 0 && !paidContent.error);
const adminContent = await as(ids.admin, "authenticated", () => tryQ(`select * from public.lesson_content`));
ok("admin can read lesson_content", adminContent.rows.length === 1);

console.log("\naccess helpers");
const acc = async (u, courseId) => (await db.query(`select public.can_access_course($1, $2) a`, [courseId, u])).rows[0].a;
ok("paid student can access purchased course", await acc(ids.paid, course["gc-master"]));
ok("free student cannot access paid course", !(await acc(ids.free, course["gc-master"])));
ok("free student can access free course", await acc(ids.free, course["free-osha"]));
ok("admin can access everything", await acc(ids.admin, course["draft"]));
const paidPlan = async (u) => (await db.query(`select public.has_paid_plan($1) p`, [u])).rows[0].p;
ok("has_paid_plan true for buyer", await paidPlan(ids.paid));
ok("has_paid_plan false for free user", !(await paidPlan(ids.free)));
const live = async (u, id) => (await db.query(`select public.can_view_live($1, $2) v`, [id, u])).rows[0].v;
ok("free user can view free live", await live(ids.free, liveFree));
ok("free user cannot view paid live", !(await live(ids.free, livePaid)));
ok("enrolled user can view course live", await live(ids.paid, livePaid));

console.log("\nenrollments & payments cannot be self-granted");
const selfEnroll = await as(ids.free, "authenticated", () => tryQ(`insert into public.enrollments (user_id, course_id) values ($1, $2)`, [ids.free, course["gc-master"]]));
ok("student cannot insert own enrollment", !!selfEnroll.error);
const selfPay = await as(ids.free, "authenticated", () => tryQ(`insert into public.payments (user_id, course_id, amount_cents) values ($1, $2, 1)`, [ids.free, course["gc-master"]]));
ok("student cannot insert payments", !!selfPay.error);
const seeOthers = await as(ids.free, "authenticated", () => tryQ(`select * from public.enrollments`));
ok("student sees only own enrollments", seeOthers.rows.length === 0);

console.log("\nroles");
const selfAdmin = await as(ids.free, "authenticated", () => tryQ(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [ids.free]));
ok("student cannot make themselves admin", !!selfAdmin.error);
const rpcAdmin = await as(ids.free, "authenticated", () => tryQ(`select public.admin_set_admin($1, true)`, [ids.free]));
ok("admin RPC rejects non-admins", !!rpcAdmin.error && /admins only/.test(rpcAdmin.error));
const listUsers = await as(ids.admin, "authenticated", () => tryQ(`select * from public.admin_list_users('', 10, 0)`));
ok("admin can list users with emails", listUsers.rows.length === 4 && listUsers.rows.some((r) => r.email === "paid@test.com"), listUsers.error || "");
const grant = await as(ids.admin, "authenticated", () => tryQ(`select public.admin_grant_course($1, $2)`, [ids.free, course["gc-master"]]));
ok("admin can grant a course", !grant.error && (await acc(ids.free, course["gc-master"])), grant.error || "");
ok("granting notifies the student", (await db.query(`select count(*)::int n from public.notifications where user_id = $1`, [ids.free])).rows[0].n === 1);
await as(ids.admin, "authenticated", () => tryQ(`select public.admin_revoke_course($1, $2)`, [ids.free, course["gc-master"]]));
ok("admin can revoke a course", !(await acc(ids.free, course["gc-master"])));
const stats = await as(ids.admin, "authenticated", () => tryQ(`select public.admin_stats() s`));
ok("admin_stats runs", !stats.error && stats.rows[0].s.users === 4, stats.error || "");
const statsFree = await as(ids.free, "authenticated", () => tryQ(`select public.admin_stats() s`));
ok("admin_stats blocked for students", !!statsFree.error);

console.log("\nprofiles");
const editOwn = await as(ids.free, "authenticated", () => tryQ(`update public.profiles set full_name = 'New Name' where id = $1 returning id`, [ids.free]));
ok("student can edit own profile", editOwn.rows.length === 1);
const editOther = await as(ids.free, "authenticated", () => tryQ(`update public.profiles set full_name = 'Hacked' where id = $1 returning id`, [ids.other]));
ok("student cannot edit another profile", editOther.rows.length === 0);

console.log("\nlesson progress & certificates");
const progPaid = await as(ids.paid, "authenticated", () => tryQ(`insert into public.lesson_progress (user_id, lesson_id, course_id, completed) values ($1, $2, $3, true), ($1, $4, $3, true)`, [ids.paid, l1, course["gc-master"], l2]));
ok("enrolled student can save progress", !progPaid.error, progPaid.error || "");
const progFree = await as(ids.free, "authenticated", () => tryQ(`insert into public.lesson_progress (user_id, lesson_id, course_id) values ($1, $2, $3)`, [ids.free, l1, course["gc-master"]]));
ok("non-enrolled student cannot save progress on paid course", !!progFree.error);
const cert = await as(ids.paid, "authenticated", () => tryQ(`select public.claim_certificate($1) code`, [course["gc-master"]]));
ok("certificate issued after finishing all lessons", !cert.error && cert.rows[0].code.length === 10, cert.error || "");
const certAgain = await as(ids.paid, "authenticated", () => tryQ(`select public.claim_certificate($1) code`, [course["gc-master"]]));
ok("claiming again returns the same certificate", certAgain.rows[0]?.code === cert.rows[0]?.code);
const verify = await as(null, "anon", () => tryQ(`select * from public.verify_certificate($1)`, [cert.rows[0].code.toLowerCase()]));
ok("anyone can verify a certificate code", verify.rows.length === 1 && verify.rows[0].student_name === "PAID", verify.error || "");
const certFree = await as(ids.free, "authenticated", () => tryQ(`select public.claim_certificate($1)`, [course["free-osha"]]));
ok("no certificate before lessons are complete", !!certFree.error);

console.log("\nlive classes");
const ctaInsert = await as(ids.admin, "authenticated", () => tryQ(`insert into public.live_ctas (live_id, kind, title, options) values ($1, 'poll', 'Ready?', '["Yes","No"]') returning id`, [livePaid]));
const ctaId = ctaInsert.rows[0]?.id;
ok("admin can push a call to action", !!ctaId, ctaInsert.error || "");
const ctaSeePaid = await as(ids.paid, "authenticated", () => tryQ(`select id from public.live_ctas`));
ok("enrolled viewer sees the call to action", ctaSeePaid.rows.length === 1);
const ctaSeeFree = await as(ids.free, "authenticated", () => tryQ(`select id from public.live_ctas`));
ok("free user does not see paid-live calls to action", ctaSeeFree.rows.length === 0);
const vote = await as(ids.paid, "authenticated", () => tryQ(`insert into public.poll_votes (cta_id, user_id, choice) values ($1, $2, 0)`, [ctaId, ids.paid]));
ok("viewer can vote once", !vote.error, vote.error || "");
const vote2 = await as(ids.paid, "authenticated", () => tryQ(`insert into public.poll_votes (cta_id, user_id, choice) values ($1, $2, 1)`, [ctaId, ids.paid]));
ok("second vote is rejected", !!vote2.error);
const results = await as(ids.paid, "authenticated", () => tryQ(`select * from public.poll_results($1)`, [ctaId]));
ok("poll results visible", results.rows.length === 1 && Number(results.rows[0].votes) === 1, results.error || "");
const chatFree = await as(ids.free, "authenticated", () => tryQ(`insert into public.live_messages (live_id, user_id, display_name, body) values ($1, $2, 'x', 'hi')`, [liveFree, ids.free]));
ok("free user can chat in free live", !chatFree.error, chatFree.error || "");
const chatPaidBlocked = await as(ids.free, "authenticated", () => tryQ(`insert into public.live_messages (live_id, user_id, display_name, body) values ($1, $2, 'x', 'hi')`, [livePaid, ids.free]));
ok("free user cannot chat in paid live", !!chatPaidBlocked.error);
const fakeHost = await as(ids.paid, "authenticated", () => tryQ(`insert into public.live_messages (live_id, user_id, display_name, body, is_host) values ($1, $2, 'x', 'hi', true)`, [livePaid, ids.paid]));
ok("student cannot post as host", !!fakeHost.error);
const privateStream = await as(ids.paid, "authenticated", () => tryQ(`select * from public.live_private`));
ok("stream links hidden from direct reads", privateStream.rows.length === 0 && !privateStream.error);

console.log("\ncommunity");
const post = await as(ids.free, "authenticated", () => tryQ(`insert into public.community_posts (user_id, display_name, title, body) values ($1, 'FREE', 'How do I size a footing?', 'details') returning id`, [ids.free]));
ok("student can post", post.rows.length === 1, post.error || "");
const fakePin = await as(ids.free, "authenticated", () => tryQ(`insert into public.community_posts (user_id, display_name, title, pinned) values ($1, 'FREE', 'Pinned spam post', true)`, [ids.free]));
ok("student cannot pin own post", !!fakePin.error);
const reply = await as(ids.paid, "authenticated", () => tryQ(`insert into public.community_replies (post_id, user_id, display_name, body) values ($1, $2, 'PAID', 'Use the IRC table') returning id`, [post.rows[0].id, ids.paid]));
ok("student can reply", !reply.error);
const fakeAi = await as(ids.paid, "authenticated", () => tryQ(`insert into public.community_replies (post_id, user_id, display_name, body, is_ai) values ($1, $2, 'AI', 'fake', true)`, [post.rows[0].id, ids.paid]));
ok("student cannot post as AI", !!fakeAi.error);
ok("reply count updated by trigger", (await db.query(`select reply_count from public.community_posts where id = $1`, [post.rows[0].id])).rows[0].reply_count === 1);
await as(ids.paid, "authenticated", () => tryQ(`insert into public.community_votes (post_id, user_id) values ($1, $2)`, [post.rows[0].id, ids.paid]));
ok("upvote count updated by trigger", (await db.query(`select upvotes from public.community_posts where id = $1`, [post.rows[0].id])).rows[0].upvotes === 1);
const delOther = await as(ids.other, "authenticated", () => tryQ(`delete from public.community_posts where id = $1 returning id`, [post.rows[0].id]));
ok("another student cannot delete the post", delOther.rows.length === 0);

console.log("\nnotifications");
await db.query(`insert into public.notifications (user_id, title) values (null, 'Live starting'), ($1, 'For paid only')`, [ids.paid]);
const notesFree = await as(ids.free, "authenticated", () => tryQ(`select title from public.notifications`));
ok("broadcast + own notifications only", notesFree.rows.every((r) => r.title !== "For paid only") && notesFree.rows.some((r) => r.title === "Live starting"));
const unread = await as(ids.free, "authenticated", () => tryQ(`select public.unread_notifications() n`));
ok("unread count", unread.rows[0]?.n >= 1, unread.error || "");

console.log("\npractice sets");
await db.query(`insert into public.practice_sets (title, published, is_free) values ('Free set', true, true), ('Paid set', true, false), ('Draft set', false, true)`);
const setsFree = await as(ids.free, "authenticated", () => tryQ(`select title from public.practice_sets order by title`));
ok("free user sees only free published sets", JSON.stringify(setsFree.rows.map((r) => r.title)) === JSON.stringify(["Free set"]), JSON.stringify(setsFree.rows));
const setsPaid = await as(ids.paid, "authenticated", () => tryQ(`select title from public.practice_sets order by title`));
ok("paid user sees all published sets", setsPaid.rows.length === 2);
const deckIns = await as(ids.admin, "authenticated", () => tryQ(`insert into public.practice_sets (title, kind, pairs, published, is_free) values ('Free deck', 'game', '[{"k":"Retainage","v":"Money held back"}]', true, true), ('Paid deck', 'game', '[{"k":"Bond","v":"Guarantee"}]', true, false) returning kind`));
ok("admin can save game decks", !deckIns.error && deckIns.rows.every((r) => r.kind === "game"), deckIns.error);
const badKind = await as(ids.admin, "authenticated", () => tryQ(`insert into public.practice_sets (title, kind) values ('Bad', 'puzzle')`));
ok("unknown set kind is rejected", !!badKind.error);
const decksFree = await as(ids.free, "authenticated", () => tryQ(`select title, pairs from public.practice_sets where kind = 'game' order by title`));
ok("free user sees only free published decks", JSON.stringify(decksFree.rows.map((r) => r.title)) === JSON.stringify(["Free deck"]) && decksFree.rows[0].pairs[0].k === "Retainage", JSON.stringify(decksFree.rows));
const decksPaid = await as(ids.paid, "authenticated", () => tryQ(`select title from public.practice_sets where kind = 'game'`));
ok("paid user sees all published decks", decksPaid.rows.length === 2);
const deckWrite = await as(ids.paid, "authenticated", () => tryQ(`insert into public.practice_sets (title, kind, published) values ('Mine', 'game', true)`));
ok("students cannot publish decks", !!deckWrite.error);
const oldTests = await db.query(`select count(*)::int n from public.practice_sets where kind = 'test'`);
ok("existing sets default to tests", oldTests.rows[0].n === 3);

console.log("\nsessions & locations are server-written only");
const sessIns = await as(ids.free, "authenticated", () => tryQ(`insert into public.active_sessions (user_id, session_id) values ($1, gen_random_uuid())`, [ids.free]));
ok("student cannot write active_sessions", !!sessIns.error);
const locIns = await as(ids.free, "authenticated", () => tryQ(`insert into public.account_locations (user_id) values ($1)`, [ids.free]));
ok("student cannot write account_locations", !!locIns.error);

console.log("\nmy_account");
const me = await as(ids.paid, "authenticated", () => tryQ(`select public.my_account() a`));
ok("my_account reports paid plan and limits", me.rows[0]?.a?.paid === true && me.rows[0].a.limits.ai_daily === 60, me.error || JSON.stringify(me.rows));
const meFree = await as(ids.free, "authenticated", () => tryQ(`select public.my_account() a`));
ok("my_account reports free limits", meFree.rows[0]?.a?.paid === false && meFree.rows[0].a.limits.ai_daily === 5);

console.log("\nadmin code");
{
  const one = async (who, sql, params) => (await as(who, who ? "authenticated" : "anon", () => tryQ(sql, params)));
  const redeem = async (who, code) => (await one(who, `select public.redeem_admin_code($1) r`, [code])).rows[0]?.r;
  const fresh = (await db.query(`select public.new_admin_code() a, public.new_admin_code() b`)).rows[0];
  ok("new codes look like LB-XXXX-XXXX-XXXX and differ", /^LB(-[A-HJ-NP-Z2-9]{4}){3}$/.test(fresh.a) && fresh.a !== fresh.b, JSON.stringify(fresh));
  const before = (await db.query(`select code from public.admin_code`)).rows[0].code;
  const last = (await db.exec(schema)).at(-1);
  ok("running schema.sql shows the admin code and keeps it", last.rows[0]["Your admin code"] === before && /No admin yet|Admins exist/.test(last.rows[0]["What to do"]), JSON.stringify(last.rows));
  ok("anon cannot read the admin code", (await one(null, `select code from public.admin_code`)).rows.length === 0);
  ok("students cannot read the admin code", (await one(ids.free, `select code from public.admin_code`)).rows.length === 0);
  ok("students cannot call admin_code_info", !!(await one(ids.free, `select public.admin_code_info()`)).error);
  ok("students cannot change the code", !!(await one(ids.free, `select public.admin_set_code('MYOWNCODE123')`)).error);
  ok("students cannot switch the code off", !!(await one(ids.free, `select public.admin_set_code_enabled(false)`)).error);
  ok("students cannot mint codes directly", !!(await one(ids.free, `select public.new_admin_code()`)).error);
  ok("setup status says an admin exists", (await one(null, `select public.admin_setup_status() s`)).rows[0]?.s?.has_admin === true);

  const info = (await one(ids.admin, `select public.admin_code_info() i`)).rows[0]?.i;
  ok("admin sees the code and admin count", /^LB-/.test(info?.code) && info.enabled === true && info.admins === 1, JSON.stringify(info));
  const wrong = await redeem(ids.free, "LB-AAAA-BBBB-CCCC");
  ok("wrong code is refused with tries left", wrong?.ok === false && wrong.code === "wrong_code" && wrong.tries_left === 4, JSON.stringify(wrong));
  const right = await redeem(ids.free, info.code.toLowerCase().replace(/-/g, " "));
  ok("right code (any case, spaces) makes the student an admin", right?.ok === true && right.first_admin === false, JSON.stringify(right));
  const meNow = (await one(ids.free, `select public.my_account() a`)).rows[0]?.a;
  ok("new admin shows as admin", meNow?.is_admin === true);
  const sansPrefix = await redeem(ids.paid, info.code.replace(/^LB-/, ""));
  ok("code works without the LB- prefix", sansPrefix?.ok === true, JSON.stringify(sansPrefix));
  await one(ids.admin, `select public.admin_set_admin($1, false)`, [ids.free]);
  await one(ids.admin, `select public.admin_set_admin($1, false)`, [ids.paid]);

  await one(ids.admin, `select public.admin_set_code_enabled(false)`);
  const off = await redeem(ids.free, info.code);
  ok("switched-off code adds no admins", off?.ok === false && off.code === "code_off", JSON.stringify(off));
  await one(ids.admin, `select public.admin_set_code_enabled(true)`);

  ok("custom code under 8 characters is refused", !!(await one(ids.admin, `select public.admin_set_code('bro-12')`)).error);
  const set = await one(ids.admin, `select public.admin_set_code('Bros Crew 2026') c`);
  ok("admin can set their own code", set.rows[0]?.c === "Bros Crew 2026", set.error);
  const oldCode = await redeem(ids.other, info.code);
  ok("old code stops working after a change", oldCode?.ok === false && oldCode.code === "wrong_code");
  const newCode = await redeem(ids.other, "broscrew2026");
  ok("new custom code works", newCode?.ok === true, JSON.stringify(newCode));
  await one(ids.admin, `select public.admin_set_admin($1, false)`, [ids.other]);
  const regen = (await one(ids.admin, `select public.admin_set_code() c`)).rows[0]?.c;
  ok("admin can make a fresh random code", /^LB-/.test(regen) && regen !== info.code);

  for (let i = 0; i < 5; i++) await redeem(ids.paid, "LB-WRNG-WRNG-WRNG");
  const locked = await redeem(ids.paid, regen);
  ok("5 wrong tries in an hour pauses that account", locked?.ok === false && locked.code === "too_many_attempts", JSON.stringify(locked));
  ok("students cannot clear their failed tries", (await one(ids.paid, `delete from public.admin_code_attempts returning id`)).rows.length === 0);
  await db.query(`delete from public.admin_code_attempts`);
  // Lots of throwaway accounts don't help: 50 failures site-wide in an hour pauses everyone
  await db.query(`insert into public.admin_code_attempts (user_id) select $1 from generate_series(1, 50)`, [ids.other]);
  const brake = await redeem(ids.free, regen);
  ok("site-wide brake after 50 wrong tries in an hour", brake?.ok === false && brake.code === "too_many_attempts", JSON.stringify(brake));
  await db.query(`delete from public.admin_code_attempts`);

  // Brand-new install: no admins yet. The code works even if it was switched off, so the owner can't be locked out.
  await db.query(`delete from public.user_roles`);
  await db.query(`update public.admin_code set enabled = false`);
  ok("setup status says no admin yet", (await one(null, `select public.admin_setup_status() s`)).rows[0]?.s?.has_admin === false);
  const signedOut = await redeem(null, regen);
  ok("signed-out visitors cannot claim", signedOut?.ok === false || signedOut === undefined);
  const claim = await redeem(ids.admin, regen);
  ok("first person with the code becomes the first admin", claim?.ok === true && claim.first_admin === true, JSON.stringify(claim));
  await db.query(`update public.admin_code set enabled = true`);
  ok("the claimed admin has full admin powers", !(await one(ids.admin, `select public.admin_stats()`)).error);
}

console.log("\nupgrading an older project");
// A project set up before game decks existed: re-running schema.sql adds the new columns and keeps the data
await db.exec(`alter table public.practice_sets drop column kind, drop column topic, drop column pairs`);
await db.exec(schema);
const up = await db.query(`select count(*)::int n, bool_and(kind is not null) k, bool_and(jsonb_typeof(pairs) = 'array') p from public.practice_sets`);
ok("re-running schema.sql upgrades practice_sets in place", up.rows[0].n >= 5 && up.rows[0].k && up.rows[0].p, JSON.stringify(up.rows));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
