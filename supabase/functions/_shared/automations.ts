// Automations engine: runs the jobs admins switched on, when they're due.
//   weekly_digest     — the team's week in one message: signups, activity, who's at risk, toughest topics, classes
//   at_risk_alert     — tells instructors when a student newly looks likely to fail
//   inactive_nudge    — a friendly in-app nudge to students who've gone quiet (once a week at most)
//   exam_countdown    — tips 14, 7, 3 and 1 day(s) before each student's exam
//   new_signup_alert  — tells admins about new accounts
//   knowledge_research — Bro's research desk studies the next topics (see research.ts); runs in the background
// Messages go by email when the job's "email" option is on and email is set up; otherwise as in-app notifications.
import { adminClient } from "./common.ts";
import { type AutomationKind, countdownNote, isDue, localParts, nudgeNote, type StudentSummary } from "./logic.ts";
import { allStudents } from "./assistant.ts";
import { emailReady, sendEmails } from "./email.ts";
import { background, nextBatch, researchOne, researchStats } from "./research.ts";

export type AutomationRow = { kind: AutomationKind; enabled: boolean; config: Record<string, any>; state: Record<string, any>; last_run_at: string | null; last_result: string | null };
const DAY = 864e5;
const site = () => (Deno.env.get("SITE_URL") || "").replace(/\/+$/, "");

async function notify(rows: { user_id: string; title: string; body: string; link: string | null }[]) {
  const db = adminClient();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("notifications").insert(rows.slice(i, i + 500));
    if (error) throw new Error(`notifications: ${error.message}`);
  }
}

/** Sends to staff by email when asked and possible, otherwise as in-app notifications. */
async function tellStaff(staff: StudentSummary[], wantEmail: boolean, subject: string, text: string, link: string): Promise<string> {
  if (!staff.length) return "no one to tell";
  if (wantEmail && emailReady()) {
    const r = await sendEmails(staff.map((s) => s.email), subject, text);
    if (r.sent) return `emailed ${r.sent}`;
  }
  await notify(staff.map((s) => ({ user_id: s.id, title: subject.slice(0, 120), body: text.slice(0, 900), link })));
  return `notified ${staff.length} in the app${wantEmail && !emailReady() ? " (email isn't set up)" : ""}`;
}

function staffFor(all: StudentSummary[], audience: string) {
  return all.filter((s) => (audience === "admins" ? s.role === "admin" : audience === "instructors" ? s.role === "instructor" || s.role === "admin" : s.role !== "student"));
}

function toughestTopics(students: StudentSummary[], n = 4) {
  const agg = new Map<string, { c: number; a: number }>();
  for (const s of students) for (const w of s.weakest) {
    const cur = agg.get(w.topic) || { c: 0, a: 0 };
    cur.c += (w.pct / 100) * w.attempts; cur.a += w.attempts;
    agg.set(w.topic, cur);
  }
  return [...agg].filter(([, v]) => v.a >= 10).map(([t, v]) => ({ topic: t, pct: Math.round((v.c / v.a) * 100), attempts: v.a })).sort((x, y) => x.pct - y.pct).slice(0, n);
}

async function run(row: AutomationRow, now: number): Promise<{ result: string; state: Record<string, any> }> {
  const cfg = row.config || {};
  const state = { ...(row.state || {}) };
  if (row.kind === "knowledge_research") {
    const { rows, note } = await nextBatch(cfg, now);
    if (!rows.length) return { result: `Research desk: ${note}.`, state };
    background(Promise.all(rows.map((r) => researchOne(r, { reviewFirst: cfg.review_first === true }))));
    return { result: `Research desk: studying ${rows.map((r) => `"${r.topic.slice(0, 60)}"`).join(", ")}.`.slice(0, 300), state };
  }
  const all = await allStudents();
  const students = all.filter((s) => s.role === "student");
  const link = site() ? `${site()}/admin/#assistant` : "/admin/#assistant";

  switch (row.kind) {
    case "weekly_digest": {
      const db = adminClient();
      const week = students.filter((s) => now - Date.parse(s.joined) <= 7 * DAY);
      const active = students.filter((s) => s.days_inactive !== null && s.days_inactive <= 7);
      const risky = students.filter((s) => s.risk === "high").sort((a, b) => (a.days_to_exam ?? 999) - (b.days_to_exam ?? 999));
      const exams = students.filter((s) => s.days_to_exam !== null && s.days_to_exam >= 0 && s.days_to_exam <= 14);
      const { data: lives } = await db.from("lives").select("title, starts_at").neq("status", "ended").gte("starts_at", new Date(now).toISOString()).lte("starts_at", new Date(now + 7 * DAY).toISOString()).order("starts_at").limit(5);
      const tz = cfg.tz || "America/Chicago";
      const topics = toughestTopics(students);
      const rs = await researchStats(now).catch(() => null);
      const lines = [
        `Here's your week at Licensing Bro's.`,
        "",
        `- ${week.length} new student${week.length === 1 ? "" : "s"} (${students.length} total, ${students.filter((s) => s.paid).length} paid)`,
        `- ${active.length} studied in the last 7 days`,
        `- ${exams.length} ha${exams.length === 1 ? "s an exam" : "ve exams"} in the next 2 weeks`,
        `- ${risky.length} at risk of failing`,
        ...(risky.length ? ["", "Who needs help first:", ...risky.slice(0, 8).map((s) => `- ${s.name} (${s.email}): ${s.reasons.join("; ")}`)] : []),
        ...(topics.length ? ["", "Toughest topics across students:", ...topics.map((t) => `- ${t.topic}: ${t.pct}% correct`)] : []),
        ...(rs && rs.studies_week ? ["", `Bro's research desk: ${rs.studies_week} topic${rs.studies_week === 1 ? "" : "s"} studied, ${rs.learned_week} new fact${rs.learned_week === 1 ? "" : "s"} checked and added to the library${rs.waiting_review ? `, ${rs.waiting_review} stud${rs.waiting_review === 1 ? "y" : "ies"} waiting for your review` : ""}.`] : []),
        ...(lives && lives.length ? ["", "Live classes this week:", ...lives.map((l: { title: string; starts_at: string }) => `- ${l.title}, ${new Date(l.starts_at).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`)] : ["", "No live classes on the schedule this week. A review class on the toughest topic above would help."]),
        "",
        `Ask Bro Command to act on any of this: ${link}`
      ];
      const sent = await tellStaff(staffFor(all, cfg.audience || "staff"), cfg.email !== false, `Your week: ${week.length} new, ${risky.length} at risk`, lines.join("\n"), "/admin/#assistant");
      return { result: `Weekly digest: ${sent}.`, state };
    }
    case "at_risk_alert": {
      const alerted: Record<string, string> = state.alerted || {};
      const fresh = students.filter((s) => s.risk === "high" && (!alerted[s.id] || now - Date.parse(alerted[s.id]) > 7 * DAY));
      if (!fresh.length) return { result: "At-risk check: nobody new.", state };
      const text = [`${fresh.length} student${fresh.length === 1 ? "" : "s"} newly look${fresh.length === 1 ? "s" : ""} at risk:`, "", ...fresh.slice(0, 15).map((s) => `- ${s.name} (${s.email}): ${s.reasons.join("; ")}`), "", `Bro Command can message them with a study plan: ${link}`].join("\n");
      const sent = await tellStaff(staffFor(all, cfg.audience || "instructors"), cfg.email !== false, `${fresh.length} student${fresh.length === 1 ? "" : "s"} at risk`, text, "/admin/#assistant");
      for (const s of fresh) alerted[s.id] = new Date(now).toISOString();
      for (const [k, v] of Object.entries(alerted)) if (now - Date.parse(v) > 30 * DAY) delete alerted[k];
      return { result: `At-risk alert: ${fresh.length} student${fresh.length === 1 ? "" : "s"}, ${sent}.`, state: { ...state, alerted } };
    }
    case "inactive_nudge": {
      const days = Math.max(3, Math.min(30, Number(cfg.days) || 5));
      const nudged: Record<string, string> = state.nudged || {};
      const list = students.filter((s) => s.days_inactive !== null && s.days_inactive >= days && (s.paid || (s.days_to_exam !== null && s.days_to_exam >= 0 && s.days_to_exam <= 60))
        && (!nudged[s.id] || now - Date.parse(nudged[s.id]) > 7 * DAY)).slice(0, 1000);
      if (!list.length) return { result: "Study nudges: nobody needed one.", state };
      await notify(list.map((s) => { const n = nudgeNote(s); return { user_id: s.id, ...n }; }));
      let emailed = 0;
      if (cfg.email === true && emailReady()) {
        for (const s of list.slice(0, 300)) {
          const n = nudgeNote(s);
          const r = await sendEmails([s.email], n.title, `${n.body}\n\nOpen your study plan: ${site()}${n.link}\n\nYou're getting this because you're studying with Licensing Bro's.`).catch(() => ({ sent: 0 }));
          emailed += r.sent;
        }
      }
      for (const s of list) nudged[s.id] = new Date(now).toISOString();
      for (const [k, v] of Object.entries(nudged)) if (now - Date.parse(v) > 30 * DAY) delete nudged[k];
      return { result: `Study nudges: ${list.length} student${list.length === 1 ? "" : "s"}${emailed ? `, ${emailed} emailed` : ""}.`, state: { ...state, nudged } };
    }
    case "exam_countdown": {
      const sent: Record<string, string> = state.sent || {};
      const rows: { user_id: string; title: string; body: string; link: string }[] = [];
      for (const s of students) {
        const note = countdownNote(s.days_to_exam, s.weakest[0]?.topic);
        if (!note || !s.exam_date) continue;
        const key = `${s.id}:${s.exam_date}:${s.days_to_exam}`;
        if (sent[key]) continue;
        rows.push({ user_id: s.id, ...note });
        sent[key] = new Date(now).toISOString();
      }
      if (rows.length) await notify(rows);
      for (const [k, v] of Object.entries(sent)) if (now - Date.parse(v) > 45 * DAY) delete sent[k];
      return { result: `Exam countdown: ${rows.length} reminder${rows.length === 1 ? "" : "s"}.`, state: { ...state, sent } };
    }
    case "new_signup_alert": {
      const since = row.last_run_at ? Date.parse(row.last_run_at) : now - 3600_000;
      const fresh = students.filter((s) => Date.parse(s.joined) > since);
      if (!fresh.length) return { result: "New signups: none.", state };
      const text = [`${fresh.length} new account${fresh.length === 1 ? "" : "s"}:`, "", ...fresh.slice(0, 25).map((s) => `- ${s.name} (${s.email}), ${s.state || "state not set"}`)].join("\n");
      const r = await tellStaff(staffFor(all, cfg.audience || "admins"), cfg.email !== false, `${fresh.length} new signup${fresh.length === 1 ? "" : "s"}`, text, "/admin/#users");
      return { result: `New signups: ${fresh.length}, ${r}.`, state };
    }
  }
}

/** Runs one job now and records the result. Claims the run first so two callers can't run it twice. */
export async function runAutomation(row: AutomationRow, now = Date.now()): Promise<string> {
  const db = adminClient();
  const stamp = new Date(now).toISOString();
  let claim = db.from("automations").update({ last_run_at: stamp }).eq("kind", row.kind);
  claim = row.last_run_at ? claim.eq("last_run_at", row.last_run_at) : claim.is("last_run_at", null);
  const { data: claimed } = await claim.select("kind");
  if (!claimed?.length) return `${row.kind}: already running`;
  try {
    const out = await run(row, now);
    await db.from("automations").update({ last_result: out.result.slice(0, 300), state: out.state }).eq("kind", row.kind);
    return out.result;
  } catch (e) {
    const msg = `Didn't finish: ${(e as Error)?.message || "error"}`.slice(0, 300);
    await db.from("automations").update({ last_result: msg }).eq("kind", row.kind);
    return msg;
  }
}

/** Runs every switched-on job that's due. */
export async function runDue(now = Date.now()): Promise<string[]> {
  const { data, error } = await adminClient().from("automations").select("*").eq("enabled", true);
  if (error) return [`Couldn't read automations: ${error.message}`];
  const out: string[] = [];
  for (const row of (data || []) as AutomationRow[]) {
    if (isDue(row.kind, row.config || {}, row.last_run_at, now)) out.push(await runAutomation(row, now));
  }
  return out;
}

export { localParts };
