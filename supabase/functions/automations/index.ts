// Automations: runs the jobs that are due.
//   Scheduler (GitHub Actions, hourly): POST with header x-automation-key = AUTOMATION_SECRET  -> runs what's due
//   Staff opening the admin area:       POST {action:"run_due"} with their sign-in               -> runs what's due
//   Admins:                             POST {action:"run_now", kind} with their sign-in         -> runs that job now
// verify_jwt is off for this function (the scheduler has no user sign-in); every path checks access itself.
import { adminClient, handler, HttpError, json, readBody, requireUser, staffRole } from "../_shared/common.ts";
import { runAutomation, runDue, type AutomationRow } from "../_shared/automations.ts";

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(handler(async (req) => {
  const secret = (Deno.env.get("AUTOMATION_SECRET") || "").trim();
  const key = (req.headers.get("x-automation-key") || "").trim();
  if (key) {
    if (!secret || !timingSafeEqual(key, secret)) throw new HttpError(401, "forbidden", "Wrong automation key.");
    return json({ ran: await runDue() });
  }

  const { user } = await requireUser(req);
  const role = await staffRole(user.id);
  if (!role) throw new HttpError(403, "forbidden", "Only staff can run automations.");
  const body = await readBody(req);

  if (body.action === "run_now") {
    if (role !== "admin") throw new HttpError(403, "forbidden", "Only admins can run an automation by hand.");
    const { data: row } = await adminClient().from("automations").select("*").eq("kind", String(body.kind || "")).maybeSingle();
    if (!row) throw new HttpError(404, "not_found", "That automation doesn't exist. Run the latest schema.sql.");
    return json({ ran: [await runAutomation(row as AutomationRow)] });
  }
  return json({ ran: await runDue() });
}));
