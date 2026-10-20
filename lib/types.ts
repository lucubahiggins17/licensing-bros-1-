// Shared row types for the Supabase tables (see supabase/schema.sql).
export type Trade = "gc" | "elec" | "plumb" | "hvac";
export type TradeOrAll = Trade | "all";

export const TRADE_LABELS: Record<TradeOrAll, string> = {
  gc: "General Contractor",
  elec: "Electrical",
  plumb: "Plumbing",
  hvac: "HVAC / Mechanical",
  all: "All trades"
};

export type Profile = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  state: string;
  trade: Trade;
  exam_date: string | null;
  created_at: string;
};

export type Limits = { ai_daily: number; exam_max_questions: number; ai_exams: boolean; practice_sets: boolean };

/** Result of the my_account() RPC */
export type Account = { is_admin: boolean; is_staff?: boolean; role?: "admin" | "instructor" | "student"; paid: boolean; enrolled: string[]; limits: Limits };

export type Course = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  trade: TradeOrAll;
  states: string[];
  level: string;
  price_cents: number;
  is_free: boolean;
  published: boolean;
  cover_url: string | null;
  est_hours: number | null;
  what_you_learn: string[];
  sort: number;
  created_at: string;
  updated_at: string;
};

export type Module = { id: string; course_id: string; title: string; sort: number };

export type Lesson = {
  id: string;
  course_id: string;
  module_id: string | null;
  title: string;
  kind: "video" | "text" | "quiz";
  is_preview: boolean;
  duration_min: number | null;
  summary: string;
  sort: number;
  created_at: string;
};

export type QuizItem = { q: string; c: string[]; a: number; why: string };

export type LessonContent = {
  lesson_id: string;
  video_url: string | null;
  body_md: string;
  quiz: QuizItem[];
  attachments: { name: string; url: string }[];
};

/** What the `lesson` edge function returns to students */
export type LessonPayload = {
  lesson: Lesson;
  course: Pick<Course, "id" | "title" | "slug" | "is_free">;
  content: {
    body_md: string;
    quiz: QuizItem[];
    attachments: { name: string; url: string }[];
    video: null | { type: "youtube" | "vimeo" | "file"; url: string };
  };
};

export type Enrollment = { user_id: string; course_id: string; source: "stripe" | "admin" | "free"; created_at: string };

export type LessonProgress = {
  user_id: string;
  lesson_id: string;
  course_id: string;
  completed: boolean;
  position_sec: number;
  notes: string;
  updated_at: string;
};

export type Certificate = {
  id: string;
  code: string;
  user_id: string;
  course_id: string;
  student_name: string;
  course_title: string;
  issued_at: string;
};

export type Live = {
  id: string;
  title: string;
  description: string;
  trade: TradeOrAll;
  is_free: boolean;
  course_id: string | null;
  starts_at: string;
  status: "scheduled" | "live" | "ended";
  provider: "livekit" | "embed";
  room_name: string;
  cover_url: string | null;
  host_id: string | null;
  created_at: string;
};

export type LivePrivate = { live_id: string; embed_url: string | null; replay_url: string | null };

export type LiveCta = {
  id: string;
  live_id: string;
  kind: "course" | "link" | "poll" | "message";
  title: string;
  body: string;
  button_label: string;
  url: string | null;
  course_id: string | null;
  promo_code: string | null;
  options: string[];
  active: boolean;
  created_at: string;
};

export type LiveMessage = {
  id: string;
  live_id: string;
  user_id: string;
  display_name: string;
  body: string;
  is_host: boolean;
  created_at: string;
};

/** What the `live-token` edge function returns */
export type LiveAccess =
  | { mode: "livekit"; url: string; token: string; identity: string; role?: "viewer" | "host" }
  | { mode: "embed"; embed_url: string }
  | { mode: "replay"; replay_url: string }
  | { mode: "waiting"; starts_at: string; message?: string; ended?: boolean };

export type CommunityPost = {
  id: string;
  user_id: string | null;
  display_name: string;
  trade: Trade;
  state: string | null;
  title: string;
  body: string;
  pinned: boolean;
  reply_count: number;
  upvotes: number;
  created_at: string;
};

export type CommunityReply = {
  id: string;
  post_id: string;
  user_id: string | null;
  display_name: string;
  body: string;
  is_ai: boolean;
  is_staff: boolean;
  created_at: string;
};

export type Notification = { id: string; user_id: string | null; title: string; body: string; link: string | null; created_at: string };

export type PracticeQuestion = { t: Trade | "law"; topic: string; q: string; c: string[]; a: number; ref: string; why: string };

export type TermPair = { k: string; v: string };

/** kind "test" = multiple-choice questions; kind "game" = term/meaning pairs for Code Match and Flashcards. */
export type PracticeSet = {
  id: string;
  title: string;
  kind: "test" | "game";
  trade: TradeOrAll;
  state: string | null;
  part: "trade" | "law" | "mix";
  topic: string;
  questions: PracticeQuestion[];
  pairs: TermPair[];
  is_free: boolean;
  published: boolean;
  created_by: string | null;
  created_at: string;
};

export type SiteSettings = {
  home_stats: { value: string; label: string }[];
  hero: { badge_top: string; badge_main: string; headline_1: string; headline_2: string; sub: string };
  free_limits: Limits;
  paid_limits: Limits;
  location_rules: {
    enforce: boolean;
    home_radius_miles: number;
    home_change_days: number;
    away_max_days: number;
    away_default_days: number;
    away_passes_per_90_days: number;
    session_timeout_seconds: number;
  };
  support: { email: string; phone: string };
  /** Bro's studio voice (the school's voice server) on or off */
  voice?: { studio?: boolean; ears?: boolean };
  /** Real exam formats (questions, minutes, passing score) instructors verified from candidate bulletins */
  exam_formats?: import("./examSim").ExamFormat[];
};

export const money = (cents: number) =>
  cents === 0 ? "Free" : `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
