// Protected lesson content. Free courses and preview lessons need only a sign-in; paid lessons need
// an enrollment (or admin) plus the current device session and the home-area rule.
import { adminClient, handler, HttpError, staffRole, isUuid, json, parseVideoUrl, readBody, requirePaidAccess, requireUser } from "../_shared/common.ts";

const BUCKET = "course-media";
const SIGNED_SECONDS = 7200;

async function signed(path: string): Promise<string | null> {
  const { data, error } = await adminClient().storage.from(BUCKET).createSignedUrl(path, SIGNED_SECONDS);
  return error ? null : data?.signedUrl ?? null;
}

Deno.serve(handler(async (req) => {
  const { user } = await requireUser(req);
  const body = await readBody(req);
  if (!isUuid(body.lesson_id)) throw new HttpError(400, "bad_request", "Pick a lesson first.");
  const db = adminClient();

  const { data: lesson } = await db.from("lessons").select("*").eq("id", body.lesson_id).maybeSingle();
  if (!lesson) throw new HttpError(404, "not_found", "That lesson isn't available.");
  const [{ data: course }, admin] = await Promise.all([
    db.from("courses").select("id, title, slug, is_free, published").eq("id", lesson.course_id).maybeSingle(),
    staffRole(user.id).then((r) => r !== null)
  ]);
  if (!course || (!course.published && !admin)) throw new HttpError(404, "not_found", "That lesson isn't available.");

  const free = course.is_free || lesson.is_preview;
  if (!free && !admin) {
    const { data: enr } = await db.from("enrollments").select("course_id").eq("user_id", user.id).eq("course_id", course.id).maybeSingle();
    if (!enr) throw new HttpError(403, "not_enrolled", "Get this course to unlock this lesson.", { course_id: course.id });
    await requirePaidAccess(req, user.id, false);
  }

  const { data: content } = await db.from("lesson_content").select("*").eq("lesson_id", lesson.id).maybeSingle();

  let video: { type: "youtube" | "vimeo" | "file"; url: string } | null = null;
  const parsed = parseVideoUrl(content?.video_url);
  if (parsed?.type === "storage") {
    const url = await signed(parsed.path);
    if (url) video = { type: "file", url };
  } else if (parsed) {
    video = parsed;
  }

  const rawAttachments: { name?: unknown; url?: unknown }[] = Array.isArray(content?.attachments) ? content.attachments : [];
  const attachments = (await Promise.all(rawAttachments.map(async (a) => {
    const url = typeof a?.url === "string" ? a.url.trim() : "";
    if (!url) return null;
    const name = typeof a?.name === "string" && a.name.trim() ? a.name.trim() : "Download";
    if (/^storage:/i.test(url)) {
      const s = await signed(url.slice(8).trim().replace(/^\/+/, ""));
      return s ? { name, url: s } : null;
    }
    return /^https?:\/\//i.test(url) ? { name, url } : null;
  }))).filter((a): a is { name: string; url: string } => !!a);

  return json({
    lesson,
    course: { id: course.id, title: course.title, slug: course.slug, is_free: course.is_free },
    content: {
      body_md: content?.body_md ?? "",
      quiz: Array.isArray(content?.quiz) ? content.quiz : [],
      attachments,
      video
    }
  });
}));
