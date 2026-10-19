// AI generation (JSON responses): mock exams, flashcard/match sets, study plans, admin test + game deck builders,
// lesson quizzes, community answers, and account deletion.
import {
  adminClient,
  aiError,
  anthropic,
  clampInt,
  cleanContext,
  communitySystem,
  examPrompt,
  FAST_MODEL,
  ROUTING_ON,
  handler,
  HttpError,
  isAdmin,
  isUuid,
  json,
  lessonQuizPrompt,
  MODEL,
  pairsPrompt,
  parseJSON,
  planLimits,
  planPrompt,
  readBody,
  requireUser,
  useAiCredit,
  validatePairs,
  validateQuestions,
  validateQuiz
} from "../_shared/common.ts";
import { formatFacts, sampleFacts, searchFacts } from "../_shared/kb.ts";

async function ask(model: string, prompt: string, maxTokens: number, system?: string) {
  try {
    const msg = await anthropic().messages.create({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content: prompt }]
    });
    // deno-lint-ignore no-explicit-any
    return msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  } catch (e) {
    throw aiError(e);
  }
}

const PARTS = ["trade", "law", "mix"];

Deno.serve(handler(async (req) => {
  const body = await readBody(req);
  const kind = String(body.kind || "");
  const { user } = await requireUser(req);
  const db = adminClient();

  // Permanently deletes the signed-in student's account and data (required by Google Play).
  // Never counts against (or is blocked by) the daily AI limit.
  if (kind === "delete_account") {
    const { error } = await db.auth.admin.deleteUser(user.id);
    if (error) throw new HttpError(500, "server_error", "Couldn't delete the account. Try again.");
    return json({ deleted: true });
  }

  const [admin, limits] = await Promise.all([isAdmin(user.id), planLimits(user.id)]);

  // Setup check for the /status page: which server keys are present (never their values). Admins only.
  if (kind === "health") {
    if (!admin) throw new HttpError(403, "forbidden", "Only admins can run the setup check.");
    const has = (k: string) => !!(Deno.env.get(k) || "").trim();
    return json({
      ai: has("ANTHROPIC_API_KEY"),
      stripe: has("STRIPE_SECRET_KEY"),
      stripe_live: (Deno.env.get("STRIPE_SECRET_KEY") || "").startsWith("sk_live_"),
      stripe_webhook: has("STRIPE_WEBHOOK_SECRET"),
      livekit: has("LIVEKIT_URL") && has("LIVEKIT_API_KEY") && has("LIVEKIT_API_SECRET"),
      ipinfo: has("IPINFO_TOKEN"),
      site_url: (Deno.env.get("SITE_URL") || "").replace(/\/+$/, "") || null,
      model: MODEL(),
      fast_model: ROUTING_ON() ? FAST_MODEL() : null
    });
  }

  const { state, trade, tradeName, refs } = cleanContext(body.state, body.trade);

  switch (kind) {
    // ---------------------------------------------------------------------------------------
    case "exam": {
      if (!limits.ai_exams && !admin) {
        throw new HttpError(402, "upgrade_required", "AI practice exams come with any paid course. The built-in practice exams are free.");
      }
      const asked = [10, 25, 50].includes(Number(body.n)) ? Number(body.n) : 10;
      const n = Math.max(1, Math.min(asked, limits.exam_max_questions));
      const part = PARTS.includes(body.part) ? body.part : "trade";
      anthropic();
      await useAiCredit(user.id, limits, admin);
      const facts = formatFacts(sampleFacts({ trade, state, part, count: Math.min(60, n * 2) }));
      const text = await ask(MODEL(), examPrompt(n, part, state, tradeName, refs, facts), Math.min(16000, 600 + n * 320));
      const questions = validateQuestions(parseJSON(text), { trade, part }).slice(0, n).map((q) => ({ ...q, src: "ai" }));
      if (!questions.length) throw new HttpError(502, "ai_error", "The AI exam came back malformed. Try again.");
      return json({ questions });
    }

    // ---------------------------------------------------------------------------------------
    case "admin_test": {
      if (!admin) throw new HttpError(403, "forbidden", "Only admins can build tests.");
      const part = PARTS.includes(body.part) ? body.part : "mix";
      const count = clampInt(body.count, 1, 50, 20);
      const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 80) : "";
      anthropic();
      await useAiCredit(user.id, limits, true);
      // "All states" (state null/empty) = national material only: no state-specific facts, prompt says "any state"
      const national = !(typeof body.state === "string" && body.state.trim());
      const factState = national ? "__national__" : state;
      const promptState = national ? "any U.S. state (national model codes and federal rules only; skip state-specific rules)" : state;
      const facts = formatFacts(sampleFacts({ trade, state: factState, part, count: Math.min(80, count * 2), topic }));
      const text = await ask(MODEL(), examPrompt(count, part, promptState, tradeName, refs, facts, topic), Math.min(16000, 600 + count * 340));
      const questions = validateQuestions(parseJSON(text), { trade, part }).slice(0, count);
      if (!questions.length) throw new HttpError(502, "ai_error", "The AI test came back malformed. Try again.");
      return json({ questions });
    }

    // ---------------------------------------------------------------------------------------
    case "lesson_quiz": {
      if (!isUuid(body.lesson_id)) throw new HttpError(400, "bad_request", "Pick a lesson first.");
      const { data: lesson } = await db.from("lessons").select("id, course_id, title, summary, is_preview").eq("id", body.lesson_id).maybeSingle();
      if (!lesson) throw new HttpError(404, "not_found", "That lesson isn't available.");
      const { data: course } = await db.from("courses").select("id, trade, states, is_free, published").eq("id", lesson.course_id).maybeSingle();
      if (!course || (!course.published && !admin)) throw new HttpError(404, "not_found", "That lesson isn't available.");
      if (!admin && !course.is_free && !lesson.is_preview) {
        const { data: enr } = await db.from("enrollments").select("course_id").eq("user_id", user.id).eq("course_id", course.id).maybeSingle();
        if (!enr) throw new HttpError(403, "not_enrolled", "Get this course to unlock this lesson.", { course_id: course.id });
      }
      const ctx = cleanContext(
        typeof body.state === "string" ? body.state : Array.isArray(course.states) && course.states.length === 1 ? course.states[0] : undefined,
        course.trade === "all" ? body.trade : course.trade
      );
      anthropic();
      await useAiCredit(user.id, limits, admin);
      const { data: content } = await db.from("lesson_content").select("body_md").eq("lesson_id", lesson.id).maybeSingle();
      const bodyMd = String(content?.body_md || "").slice(0, 12000);
      const facts = formatFacts(searchFacts(`${lesson.title} ${lesson.summary || ""}`, { trade: ctx.trade, state: ctx.state, limit: 6 }));
      const text = await ask(MODEL(), lessonQuizPrompt(lesson.title, lesson.summary || "", bodyMd, ctx.state, ctx.tradeName, facts), 2000);
      const quiz = validateQuiz(parseJSON(text), 5);
      if (!quiz.length) throw new HttpError(502, "ai_error", "The AI quiz came back malformed. Try again.");
      return json({ quiz });
    }

    // ---------------------------------------------------------------------------------------
    case "community_answer": {
      if (!isUuid(body.post_id)) throw new HttpError(400, "bad_request", "Pick a post first.");
      const { data: post } = await db.from("community_posts").select("id, title, body, trade, state").eq("id", body.post_id).maybeSingle();
      if (!post) throw new HttpError(404, "not_found", "That post isn't available anymore.");
      // One AI answer per post
      const { data: existing } = await db.from("community_replies").select("*").eq("post_id", post.id).eq("is_ai", true).limit(1).maybeSingle();
      if (existing) return json({ reply: existing, existing: true });

      const ctx = cleanContext(post.state, post.trade);
      anthropic();
      await useAiCredit(user.id, limits, admin);
      const postText = `${post.title}\n\n${post.body || ""}`.slice(0, 5200);
      const notes = formatFacts(searchFacts(postText, { trade: ctx.trade, state: ctx.state, limit: 8 }));
      const answer = (await ask(MODEL(), `Community post:\nTITLE: ${post.title}\n\n${post.body || ""}`.slice(0, 5400), 900,
        communitySystem(ctx.state, ctx.tradeName, ctx.refs, notes))).trim();
      if (!answer) throw new HttpError(502, "ai_error", "The AI couldn't answer that one. Try again.");
      const { data: reply, error } = await db.from("community_replies").insert({
        post_id: post.id, user_id: null, display_name: "AI Bro", body: answer.slice(0, 4900), is_ai: true, is_staff: false
      }).select("*").single();
      if (error) throw new HttpError(500, "server_error", "Couldn't post the AI answer. Try again.");
      return json({ reply });
    }

    // ---------------------------------------------------------------------------------------
    case "pairs": {
      const count = body.count === 8 ? 8 : 6;
      const avoid = Array.isArray(body.avoid) ? body.avoid.map(String) : [];
      anthropic();
      await useAiCredit(user.id, limits, admin);
      const facts = formatFacts(sampleFacts({ trade, state, part: "mix", count: 24 }));
      const text = await ask(FAST_MODEL(), pairsPrompt(count, state, tradeName, refs, avoid, facts), 1500);
      const pairs = validatePairs(parseJSON(text), { max: count, avoid }).map((x) => ({ t: trade, ...x, ai: true }));
      if (pairs.length < 3) throw new HttpError(502, "ai_error", "The AI set came back malformed. Try again.");
      return json({ pairs });
    }

    // ---------------------------------------------------------------------------------------
    // Admin game deck builder: term/meaning pairs for Code Match and Flashcards, reviewed before publishing
    case "admin_pairs": {
      if (!admin) throw new HttpError(403, "forbidden", "Only admins can build game decks.");
      const count = clampInt(body.count, 1, 40, 12);
      const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 80) : "";
      const avoid = Array.isArray(body.avoid) ? body.avoid.slice(0, 200).map((x: unknown) => String(x).slice(0, 60)) : [];
      anthropic();
      await useAiCredit(user.id, limits, true);
      const national = !(typeof body.state === "string" && body.state.trim());
      const factState = national ? "__national__" : state;
      const promptState = national ? "any U.S. state (national model codes and federal rules only; skip state-specific rules)" : state;
      const facts = formatFacts(sampleFacts({ trade, state: factState, part: "mix", count: Math.min(60, count * 3), topic }));
      const text = await ask(MODEL(), pairsPrompt(count, promptState, tradeName, refs, avoid, facts, topic), Math.min(8000, 600 + count * 110));
      const pairs = validatePairs(parseJSON(text), { max: count, avoid, kMax: 60, vMax: 220 });
      if (!pairs.length) throw new HttpError(502, "ai_error", "The AI deck came back malformed. Try again.");
      return json({ pairs });
    }

    // ---------------------------------------------------------------------------------------
    case "plan": {
      const days = body.days !== null && body.days !== undefined && Number.isFinite(Number(body.days)) ? Number(body.days) : null;
      const weak = typeof body.weak === "string" ? body.weak.slice(0, 1500) : "";
      anthropic();
      await useAiCredit(user.id, limits, admin);
      const text = await ask(MODEL(), planPrompt(state, tradeName, days, weak), 1500);
      return json({ text });
    }

    default:
      throw new HttpError(400, "bad_request", "Unknown request.");
  }
}));
