-- =====================================================================================
-- Licensing Bro's database
-- Run once in Supabase: Dashboard > SQL Editor > New query > paste everything > Run.
-- Safe to re-run: it only creates what's missing and replaces functions and policies.
-- =====================================================================================

create extension if not exists pgcrypto;

-- -------------------------------------------------------------------------------------
-- Roles and profiles
-- -------------------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  state text not null default 'Tennessee',
  trade text not null default 'gc' check (trade in ('gc','elec','plumb','hvac')),
  exam_date date,
  created_at timestamptz not null default now()
);

-- Admins and instructors are listed here. Only the service role or an admin can add one.
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin')),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = p_user and role = 'admin');
$$;

-- Staff = admins and instructors. Instructors teach (knowledge library, tests and games, live classes,
-- announcements, student progress); only admins change settings, prices, roles and payments.
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check check (role in ('admin','instructor'));

create or replace function public.is_staff(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = p_user and role in ('admin','instructor'));
$$;
grant execute on function public.is_staff(uuid) to authenticated, service_role;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.user_roles where user_id = auth.uid()), 'student');
$$;
grant execute on function public.my_role() to authenticated;

-- Create a profile automatically for every new account
-- The app's onboarding can pass the trade, state and exam date picked before signing up (sign-up metadata).
-- Anything unexpected falls back to the defaults, so a bad value never blocks a sign-up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_trade text := case when m->>'trade' in ('gc','elec','plumb','hvac') then m->>'trade' else 'gc' end;
  v_state text := case when coalesce(m->>'state', '') ~ '^[A-Za-z .]{4,30}$' then m->>'state' else 'Tennessee' end;
  v_exam date := null;
begin
  begin
    if coalesce(m->>'exam_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then v_exam := (m->>'exam_date')::date; end if;
  exception when others then v_exam := null;
  end;
  insert into public.profiles (id, full_name, state, trade, exam_date)
  values (new.id, coalesce(m->>'full_name', split_part(new.email, '@', 1)), v_state, v_trade, v_exam)
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for accounts created before this script ran
insert into public.profiles (id, full_name)
select u.id, split_part(u.email, '@', 1) from auth.users u
on conflict (id) do nothing;

-- -------------------------------------------------------------------------------------
-- Site settings (homepage stats, plan limits, location rules). Readable by everyone.
-- -------------------------------------------------------------------------------------
create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.site_settings (key, value) values
  ('home_stats', '[{"value":"50","label":"States + DC covered"},{"value":"4","label":"Trades: GC, electrical, plumbing, HVAC"},{"value":"2,700+","label":"Verified code, OSHA, business & state facts"}]'),
  ('hero', '{"badge_top":"2026 Edition","badge_main":"Industry-leading contractor education","headline_1":"Master your","headline_2":"Contractor license","sub":"The blueprint to your exam preparation for electrical, plumbing, HVAC, and general contractor certifications"}'),
  ('free_limits', '{"ai_daily":5,"exam_max_questions":10,"ai_exams":false,"practice_sets":false}'),
  ('paid_limits', '{"ai_daily":60,"exam_max_questions":50,"ai_exams":true,"practice_sets":true}'),
  ('location_rules', '{"enforce":true,"home_radius_miles":100,"home_change_days":30,"away_max_days":30,"away_default_days":14,"away_passes_per_90_days":3,"session_timeout_seconds":120}'),
  ('support', '{"email":"","phone":""}')
on conflict (key) do nothing;

-- -------------------------------------------------------------------------------------
-- Courses, modules, lessons
-- -------------------------------------------------------------------------------------
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  subtitle text not null default '',
  description text not null default '',
  trade text not null default 'gc' check (trade in ('gc','elec','plumb','hvac','all')),
  states text[] not null default '{}',          -- empty = every state
  level text not null default 'Exam prep',
  price_cents integer not null default 0 check (price_cents >= 0),
  is_free boolean not null default false,
  published boolean not null default false,
  cover_url text,
  est_hours numeric,
  what_you_learn text[] not null default '{}',
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  sort integer not null default 0
);

-- Lesson outline (titles etc.) is visible to everyone so the catalog can show it.
create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  module_id uuid references public.modules(id) on delete set null,
  title text not null,
  kind text not null default 'video' check (kind in ('video','text','quiz')),
  is_preview boolean not null default false,     -- free preview lesson inside a paid course
  duration_min integer,
  summary text not null default '',
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

-- The protected part of a lesson. Only admins read this table directly; students get it
-- through the `lesson` edge function, which checks enrollment, device and location.
create table if not exists public.lesson_content (
  lesson_id uuid primary key references public.lessons(id) on delete cascade,
  video_url text,          -- YouTube/Vimeo URL, direct .mp4 URL, or "storage:<path>" in the course-media bucket
  body_md text not null default '',
  quiz jsonb not null default '[]',   -- [{q, c:[4], a, why}]
  attachments jsonb not null default '[]'  -- [{name, url}]
);

create table if not exists public.enrollments (
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  source text not null default 'stripe' check (source in ('stripe','admin','free')),
  created_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  course_id uuid references public.courses(id) on delete set null,
  amount_cents integer not null,
  currency text not null default 'usd',
  stripe_session_id text unique,
  stripe_payment_intent text,
  status text not null default 'paid' check (status in ('paid','refunded')),
  created_at timestamptz not null default now()
);

create table if not exists public.lesson_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  completed boolean not null default false,
  position_sec integer not null default 0,
  notes text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  student_name text not null,
  course_title text not null,
  issued_at timestamptz not null default now(),
  unique (user_id, course_id)
);

-- -------------------------------------------------------------------------------------
-- Live classes
-- -------------------------------------------------------------------------------------
create table if not exists public.lives (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  trade text not null default 'all' check (trade in ('gc','elec','plumb','hvac','all')),
  is_free boolean not null default false,
  course_id uuid references public.courses(id) on delete set null,  -- enrolled students of this course get access
  starts_at timestamptz not null default now(),
  status text not null default 'scheduled' check (status in ('scheduled','live','ended')),
  provider text not null default 'livekit' check (provider in ('livekit','embed')),
  room_name text not null default ('lb-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  cover_url text,
  host_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Stream links are protected the same way as lesson content (read via the live-token function)
create table if not exists public.live_private (
  live_id uuid primary key references public.lives(id) on delete cascade,
  embed_url text,     -- YouTube Live / Vimeo / StreamYard embed link when provider = 'embed'
  replay_url text     -- recording to show after the class ends
);

-- Calls to action pushed by the host during a live class
create table if not exists public.live_ctas (
  id uuid primary key default gen_random_uuid(),
  live_id uuid not null references public.lives(id) on delete cascade,
  kind text not null check (kind in ('course','link','poll','message')),
  title text not null,
  body text not null default '',
  button_label text not null default '',
  url text,
  course_id uuid references public.courses(id) on delete set null,
  promo_code text,
  options jsonb not null default '[]',     -- poll choices: ["A","B",...]
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.poll_votes (
  cta_id uuid not null references public.live_ctas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  choice integer not null,
  created_at timestamptz not null default now(),
  primary key (cta_id, user_id)
);

create table if not exists public.live_messages (
  id uuid primary key default gen_random_uuid(),
  live_id uuid not null references public.lives(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  body text not null check (char_length(body) between 1 and 500),
  is_host boolean not null default false,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------------------------------
-- Community
-- -------------------------------------------------------------------------------------
create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  trade text not null default 'gc',
  state text,
  title text not null check (char_length(title) between 3 and 160),
  body text not null default '' check (char_length(body) <= 5000),
  pinned boolean not null default false,
  reply_count integer not null default 0,
  upvotes integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.community_replies (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  body text not null check (char_length(body) between 1 and 5000),
  is_ai boolean not null default false,
  is_staff boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.community_votes (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (post_id, user_id)
);

-- -------------------------------------------------------------------------------------
-- Notifications (user_id null = everyone)
-- -------------------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  title text not null,
  body text not null default '',
  link text,
  created_at timestamptz not null default now()
);
create table if not exists public.notification_reads (
  user_id uuid primary key references auth.users(id) on delete cascade,
  read_until timestamptz not null default now()
);

-- -------------------------------------------------------------------------------------
-- Practice tests and game decks created by admins with the AI builder
--   kind 'test' = multiple-choice questions (Practice exam, Speed Round)
--   kind 'game' = term/meaning pairs (Code Match, Flashcards)
-- -------------------------------------------------------------------------------------
create table if not exists public.practice_sets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null default 'test' check (kind in ('test','game')),
  trade text not null default 'gc' check (trade in ('gc','elec','plumb','hvac','all')),
  state text,                                   -- null = every state
  part text not null default 'mix' check (part in ('trade','law','mix')),
  topic text not null default '',
  questions jsonb not null default '[]',        -- tests: [{t, topic, q, c:[4], a, ref, why}]
  pairs jsonb not null default '[]',            -- games: [{k: term, v: meaning}]
  is_free boolean not null default false,
  published boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
-- Projects created before game decks existed
alter table public.practice_sets add column if not exists kind text not null default 'test' check (kind in ('test','game'));
alter table public.practice_sets add column if not exists topic text not null default '';
alter table public.practice_sets add column if not exists pairs jsonb not null default '[]';
create index if not exists practice_sets_kind_idx on public.practice_sets (kind, published, trade);

-- -------------------------------------------------------------------------------------
-- One device at a time + home location (written only by edge functions)
-- -------------------------------------------------------------------------------------
create table if not exists public.active_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id uuid not null,
  device text not null default '',
  ip text,
  city text, region text, country text,
  lat double precision, lon double precision,
  location_ok boolean not null default true,
  started_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table if not exists public.account_locations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  home_lat double precision, home_lon double precision,
  home_city text, home_region text, home_country text,
  home_set_at timestamptz,
  away_lat double precision, away_lon double precision,
  away_city text, away_region text,
  away_until timestamptz,
  away_history timestamptz[] not null default '{}'
);

-- -------------------------------------------------------------------------------------
-- Study data (existing) and AI usage
-- -------------------------------------------------------------------------------------
create table if not exists public.progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  count integer not null default 0,
  primary key (user_id, day)
);

create or replace function public.bump_ai_usage(p_user uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare new_count integer;
begin
  insert into public.ai_usage (user_id, day, count) values (p_user, current_date, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
  returning count into new_count;
  return new_count;
end; $$;
revoke all on function public.bump_ai_usage(uuid) from public, anon, authenticated;
grant execute on function public.bump_ai_usage(uuid) to service_role;

-- -------------------------------------------------------------------------------------
-- Access helpers
-- -------------------------------------------------------------------------------------
create or replace function public.has_paid_plan(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff(p_user) or exists (
    select 1 from public.enrollments e join public.courses c on c.id = e.course_id
    where e.user_id = p_user and (e.source <> 'free' and not c.is_free)
  );
$$;

create or replace function public.can_access_course(p_course uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and (
    public.is_staff(p_user)
    or exists (select 1 from public.courses where id = p_course and is_free and published)
    or exists (select 1 from public.enrollments where course_id = p_course and user_id = p_user)
  );
$$;

create or replace function public.can_view_live(p_live uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and exists (
    select 1 from public.lives l where l.id = p_live and (
      public.is_staff(p_user) or l.is_free
      or (l.course_id is not null and exists (select 1 from public.enrollments e where e.course_id = l.course_id and e.user_id = p_user))
      or (l.course_id is null and public.has_paid_plan(p_user))
    )
  );
$$;

-- -------------------------------------------------------------------------------------
-- Row level security
-- -------------------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.site_settings enable row level security;
alter table public.courses enable row level security;
alter table public.modules enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_content enable row level security;
alter table public.enrollments enable row level security;
alter table public.payments enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.certificates enable row level security;
alter table public.lives enable row level security;
alter table public.live_private enable row level security;
alter table public.live_ctas enable row level security;
alter table public.poll_votes enable row level security;
alter table public.live_messages enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_replies enable row level security;
alter table public.community_votes enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;
alter table public.practice_sets enable row level security;
alter table public.active_sessions enable row level security;
alter table public.account_locations enable row level security;
alter table public.progress enable row level security;
alter table public.ai_usage enable row level security;

-- Helper to (re)create a policy idempotently
create or replace function pg_temp.pol(p_table text, p_name text, p_sql text) returns void language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', p_name, p_table);
  execute p_sql;
end; $$;

-- profiles: everyone signed in can read names (community, chat); you edit only your own
select pg_temp.pol('profiles','profiles read','create policy "profiles read" on public.profiles for select to authenticated using (true)');
select pg_temp.pol('profiles','profiles update own','create policy "profiles update own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid())');
select pg_temp.pol('profiles','profiles admin','create policy "profiles admin" on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin())');

select pg_temp.pol('user_roles','roles read own','create policy "roles read own" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_admin())');
select pg_temp.pol('user_roles','roles admin','create policy "roles admin" on public.user_roles for all to authenticated using (public.is_admin()) with check (public.is_admin())');

select pg_temp.pol('site_settings','settings read','create policy "settings read" on public.site_settings for select using (true)');
select pg_temp.pol('site_settings','settings admin','create policy "settings admin" on public.site_settings for all to authenticated using (public.is_admin()) with check (public.is_admin())');

-- catalog: published courses and their outline are public; admins see and edit everything
select pg_temp.pol('courses','courses read','create policy "courses read" on public.courses for select using (published or public.is_staff())');
select pg_temp.pol('courses','courses admin','create policy "courses admin" on public.courses for all to authenticated using (public.is_admin()) with check (public.is_admin())');
select pg_temp.pol('modules','modules read','create policy "modules read" on public.modules for select using (exists (select 1 from public.courses c where c.id = course_id and (c.published or public.is_staff())))');
select pg_temp.pol('modules','modules admin','create policy "modules admin" on public.modules for all to authenticated using (public.is_admin()) with check (public.is_admin())');
select pg_temp.pol('lessons','lessons read','create policy "lessons read" on public.lessons for select using (exists (select 1 from public.courses c where c.id = course_id and (c.published or public.is_staff())))');
select pg_temp.pol('lessons','lessons admin','create policy "lessons admin" on public.lessons for all to authenticated using (public.is_admin()) with check (public.is_admin())');
select pg_temp.pol('lesson_content','content admin','create policy "content admin" on public.lesson_content for all to authenticated using (public.is_admin()) with check (public.is_admin())');

select pg_temp.pol('enrollments','enrollments read own','create policy "enrollments read own" on public.enrollments for select to authenticated using (user_id = auth.uid() or public.is_staff())');
select pg_temp.pol('enrollments','enrollments admin','create policy "enrollments admin" on public.enrollments for all to authenticated using (public.is_admin()) with check (public.is_admin())');
select pg_temp.pol('payments','payments read','create policy "payments read" on public.payments for select to authenticated using (user_id = auth.uid() or public.is_admin())');

select pg_temp.pol('lesson_progress','progress own','create policy "progress own" on public.lesson_progress for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_access_course(course_id))');
select pg_temp.pol('lesson_progress','progress admin read','create policy "progress admin read" on public.lesson_progress for select to authenticated using (public.is_staff())');

select pg_temp.pol('certificates','certs read own','create policy "certs read own" on public.certificates for select to authenticated using (user_id = auth.uid() or public.is_admin())');

-- lives: the schedule is public; stream links go through the live-token function
select pg_temp.pol('lives','lives read','create policy "lives read" on public.lives for select using (true)');
select pg_temp.pol('lives','lives admin','create policy "lives admin" on public.lives for all to authenticated using (public.is_staff()) with check (public.is_staff())');
select pg_temp.pol('live_private','live private admin','create policy "live private admin" on public.live_private for all to authenticated using (public.is_staff()) with check (public.is_staff())');
select pg_temp.pol('live_ctas','ctas read','create policy "ctas read" on public.live_ctas for select to authenticated using (public.can_view_live(live_id))');
select pg_temp.pol('live_ctas','ctas admin','create policy "ctas admin" on public.live_ctas for all to authenticated using (public.is_staff()) with check (public.is_staff())');
select pg_temp.pol('poll_votes','votes own','create policy "votes own" on public.poll_votes for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.live_ctas c where c.id = cta_id and c.kind = ''poll'' and c.active and public.can_view_live(c.live_id)))');
select pg_temp.pol('poll_votes','votes read','create policy "votes read" on public.poll_votes for select to authenticated using (user_id = auth.uid() or public.is_staff())');
select pg_temp.pol('live_messages','chat read','create policy "chat read" on public.live_messages for select to authenticated using (public.can_view_live(live_id))');
select pg_temp.pol('live_messages','chat write','create policy "chat write" on public.live_messages for insert to authenticated with check (user_id = auth.uid() and public.can_view_live(live_id) and (not is_host or public.is_staff()))');
select pg_temp.pol('live_messages','chat admin','create policy "chat admin" on public.live_messages for delete to authenticated using (public.is_staff())');

-- community: signed-in users read and post; authors and admins edit/delete
select pg_temp.pol('community_posts','posts read','create policy "posts read" on public.community_posts for select to authenticated using (true)');
select pg_temp.pol('community_posts','posts insert','create policy "posts insert" on public.community_posts for insert to authenticated with check (user_id = auth.uid() and not pinned and reply_count = 0 and upvotes = 0)');
select pg_temp.pol('community_posts','posts own','create policy "posts own" on public.community_posts for delete to authenticated using (user_id = auth.uid() or public.is_staff())');
select pg_temp.pol('community_posts','posts admin','create policy "posts admin" on public.community_posts for update to authenticated using (public.is_staff()) with check (public.is_staff())');
select pg_temp.pol('community_replies','replies read','create policy "replies read" on public.community_replies for select to authenticated using (true)');
select pg_temp.pol('community_replies','replies insert','create policy "replies insert" on public.community_replies for insert to authenticated with check (user_id = auth.uid() and not is_ai and (not is_staff or public.is_staff()))');
select pg_temp.pol('community_replies','replies own','create policy "replies own" on public.community_replies for delete to authenticated using (user_id = auth.uid() or public.is_staff())');
select pg_temp.pol('community_votes','cvotes own','create policy "cvotes own" on public.community_votes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())');

select pg_temp.pol('notifications','notes read','create policy "notes read" on public.notifications for select to authenticated using (user_id is null or user_id = auth.uid())');
select pg_temp.pol('notifications','notes admin','create policy "notes admin" on public.notifications for all to authenticated using (public.is_staff()) with check (public.is_staff())');
select pg_temp.pol('notification_reads','reads own','create policy "reads own" on public.notification_reads for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())');

select pg_temp.pol('practice_sets','sets read','create policy "sets read" on public.practice_sets for select to authenticated using (public.is_staff() or (published and (is_free or public.has_paid_plan())))');
select pg_temp.pol('practice_sets','sets admin','create policy "sets admin" on public.practice_sets for all to authenticated using (public.is_staff()) with check (public.is_staff())');

-- your own device/location record is readable (account page); only edge functions write it
select pg_temp.pol('active_sessions','sessions read own','create policy "sessions read own" on public.active_sessions for select to authenticated using (user_id = auth.uid() or public.is_admin())');
select pg_temp.pol('account_locations','locations read own','create policy "locations read own" on public.account_locations for select to authenticated using (user_id = auth.uid() or public.is_admin())');

select pg_temp.pol('progress','read own progress','create policy "read own progress" on public.progress for select using (auth.uid() = user_id)');
select pg_temp.pol('progress','insert own progress','create policy "insert own progress" on public.progress for insert with check (auth.uid() = user_id)');
select pg_temp.pol('progress','update own progress','create policy "update own progress" on public.progress for update using (auth.uid() = user_id) with check (auth.uid() = user_id)');
select pg_temp.pol('progress','admin read progress','create policy "admin read progress" on public.progress for select to authenticated using (public.is_staff())');
-- ai_usage: no policies (server only)

-- -------------------------------------------------------------------------------------
-- Triggers: reply counts, vote counts, profile name protection
-- -------------------------------------------------------------------------------------
create or replace function public.bump_reply_count() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update public.community_posts set reply_count = reply_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then update public.community_posts set reply_count = greatest(0, reply_count - 1) where id = old.post_id; end if;
  return null;
end; $$;
drop trigger if exists community_reply_count on public.community_replies;
create trigger community_reply_count after insert or delete on public.community_replies for each row execute function public.bump_reply_count();

create or replace function public.bump_vote_count() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update public.community_posts set upvotes = upvotes + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then update public.community_posts set upvotes = greatest(0, upvotes - 1) where id = old.post_id; end if;
  return null;
end; $$;
drop trigger if exists community_vote_count on public.community_votes;
create trigger community_vote_count after insert or delete on public.community_votes for each row execute function public.bump_vote_count();

-- -------------------------------------------------------------------------------------
-- RPCs used by the app
-- -------------------------------------------------------------------------------------

-- Public certificate check: /verify?code=XXXX
create or replace function public.verify_certificate(p_code text)
returns table (code text, student_name text, course_title text, issued_at timestamptz)
language sql stable security definer set search_path = public as $$
  select code, student_name, course_title, issued_at from public.certificates where code = upper(trim(p_code));
$$;
grant execute on function public.verify_certificate(text) to anon, authenticated;

-- Issue a certificate when every lesson in the course is complete
create or replace function public.claim_certificate(p_course uuid)
returns text language plpgsql security definer set search_path = public as $$
declare total int; done int; v_code text; v_name text; v_title text;
begin
  if auth.uid() is null or not public.can_access_course(p_course) then raise exception 'not allowed'; end if;
  select count(*) into total from public.lessons where course_id = p_course;
  select count(*) into done from public.lesson_progress where course_id = p_course and user_id = auth.uid() and completed;
  if total = 0 or done < total then raise exception 'finish every lesson first'; end if;
  select code into v_code from public.certificates where user_id = auth.uid() and course_id = p_course;
  if v_code is not null then return v_code; end if;
  select coalesce(nullif(full_name, ''), 'Student') into v_name from public.profiles where id = auth.uid();
  select title into v_title from public.courses where id = p_course;
  insert into public.certificates (user_id, course_id, student_name, course_title) values (auth.uid(), p_course, v_name, v_title)
  returning code into v_code;
  return v_code;
end; $$;
grant execute on function public.claim_certificate(uuid) to authenticated;

-- What the signed-in user can do (used by the app shell)
create or replace function public.my_account()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'is_admin', public.is_admin(),
    'is_staff', public.is_staff(),
    'role', public.my_role(),
    'paid', public.has_paid_plan(),
    'enrolled', coalesce((select jsonb_agg(course_id) from public.enrollments where user_id = auth.uid()), '[]'::jsonb),
    'limits', (select value from public.site_settings where key = case when public.has_paid_plan() then 'paid_limits' else 'free_limits' end)
  );
$$;
grant execute on function public.my_account() to authenticated;

-- Live poll results (counts per choice)
create or replace function public.poll_results(p_cta uuid)
returns table (choice integer, votes bigint) language sql stable security definer set search_path = public as $$
  select choice, count(*) from public.poll_votes v
  where v.cta_id = p_cta and exists (select 1 from public.live_ctas c where c.id = p_cta and public.can_view_live(c.live_id))
  group by choice order by choice;
$$;
grant execute on function public.poll_results(uuid) to authenticated;

-- Notifications: unread count since the last time the bell was opened
create or replace function public.unread_notifications()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.notifications n
  where (n.user_id is null or n.user_id = auth.uid())
    and n.created_at > coalesce((select read_until from public.notification_reads where user_id = auth.uid()), '-infinity'::timestamptz);
$$;
grant execute on function public.unread_notifications() to authenticated;

-- ---------- Admin RPCs (each checks is_admin) ----------
create or replace function public.admin_list_users(p_search text default '', p_limit int default 50, p_offset int default 0)
returns table (id uuid, email text, full_name text, state text, trade text, created_at timestamptz, last_sign_in_at timestamptz,
               is_admin boolean, enrolled_count bigint, paid boolean, device text, device_city text, last_seen timestamptz, home_city text, home_region text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query
  select u.id, u.email::text, p.full_name, p.state, p.trade, u.created_at, u.last_sign_in_at,
         public.is_admin(u.id), (select count(*) from public.enrollments e where e.user_id = u.id), public.has_paid_plan(u.id),
         s.device, s.city, s.last_seen, l.home_city, l.home_region
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.active_sessions s on s.user_id = u.id
  left join public.account_locations l on l.user_id = u.id
  where p_search = '' or u.email ilike '%' || p_search || '%' or p.full_name ilike '%' || p_search || '%'
  order by u.created_at desc
  limit p_limit offset p_offset;
end; $$;
grant execute on function public.admin_list_users(text, int, int) to authenticated;

create or replace function public.admin_grant_course(p_user uuid, p_course uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  insert into public.enrollments (user_id, course_id, source) values (p_user, p_course, 'admin') on conflict do nothing;
  insert into public.notifications (user_id, title, body, link)
  select p_user, 'You have a new course', 'You now have full access to ' || title || '.', '/course/?id=' || id from public.courses where id = p_course;
end; $$;
grant execute on function public.admin_grant_course(uuid, uuid) to authenticated;

create or replace function public.admin_revoke_course(p_user uuid, p_course uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  delete from public.enrollments where user_id = p_user and course_id = p_course;
end; $$;
grant execute on function public.admin_revoke_course(uuid, uuid) to authenticated;

create or replace function public.admin_reset_device(p_user uuid, p_reset_home boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  delete from public.active_sessions where user_id = p_user;
  if p_reset_home then delete from public.account_locations where user_id = p_user; end if;
end; $$;
grant execute on function public.admin_reset_device(uuid, boolean) to authenticated;

create or replace function public.admin_set_admin(p_user uuid, p_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_admin then insert into public.user_roles (user_id, role) values (p_user, 'admin') on conflict do nothing;
  else
    if p_user = auth.uid() then raise exception 'you cannot remove your own admin access'; end if;
    delete from public.user_roles where user_id = p_user;
  end if;
end; $$;
grant execute on function public.admin_set_admin(uuid, boolean) to authenticated;

-- -------------------------------------------------------------------------------------
-- Admin code: whoever enters it at /admin becomes an admin.
--   * Before there are any admins, it always works, so the owner can claim the site without SQL.
--   * Admins see it, copy it, change it or switch it off in Admin -> Settings, and share it to add admins.
--   * The table is locked (no policies); only the functions below can read or change it.
--   * 5 wrong tries per account per hour, and 50 site-wide per hour, then a pause.
-- -------------------------------------------------------------------------------------
create table if not exists public.admin_code (
  id boolean primary key default true check (id),
  code text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create table if not exists public.admin_code_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists admin_code_attempts_user_idx on public.admin_code_attempts (user_id, at);
alter table public.admin_code enable row level security;
alter table public.admin_code_attempts enable row level security;
revoke all on public.admin_code from anon, authenticated;
revoke all on public.admin_code_attempts from anon, authenticated;

-- Random code like LB-7KQ2-M9XD-4TPA (no 0/O/1/I). Uses gen_random_uuid(), which is built into Postgres and
-- cryptographically random; byte 6 is skipped because it holds the UUID version bits.
create or replace function public.new_admin_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  idx int[] := array[0,1,2,3,4,5,9,10,11,12,13,14];
  out text := 'LB';
  i int;
begin
  for i in 1..12 loop
    if (i - 1) % 4 = 0 then out := out || '-'; end if;
    out := out || substr(alphabet, (get_byte(b, idx[i]) % 32) + 1, 1);
  end loop;
  return out;
end; $$;
revoke execute on function public.new_admin_code() from public, anon, authenticated;

-- Compare codes ignoring case, spaces and dashes
create or replace function public.norm_admin_code(p text)
returns text language sql immutable set search_path = public as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

insert into public.admin_code (id, code) values (true, public.new_admin_code()) on conflict (id) do nothing;

-- Is there an admin yet? (Lets /admin show the "claim your site" screen on a brand-new install.)
create or replace function public.admin_setup_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('has_admin', exists (select 1 from public.user_roles where role = 'admin'))
$$;
grant execute on function public.admin_setup_status() to anon, authenticated;

create or replace function public.redeem_admin_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  rec public.admin_code%rowtype;
  has_admin boolean;
  fails int;
  given text := public.norm_admin_code(p_code);
  want text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'code', 'signed_out'); end if;
  if public.is_admin(uid) then return jsonb_build_object('ok', true, 'already', true); end if;
  select count(*) into fails from public.admin_code_attempts where user_id = uid and at > now() - interval '1 hour';
  if fails >= 5 then return jsonb_build_object('ok', false, 'code', 'too_many_attempts'); end if;
  -- Site-wide brake so making lots of accounts doesn't help anyone guess
  if (select count(*) from public.admin_code_attempts where at > now() - interval '1 hour') >= 50 then
    return jsonb_build_object('ok', false, 'code', 'too_many_attempts');
  end if;
  select * into rec from public.admin_code where id;
  has_admin := exists (select 1 from public.user_roles where role = 'admin');
  if rec.code is null or (has_admin and not rec.enabled) then return jsonb_build_object('ok', false, 'code', 'code_off'); end if;
  want := public.norm_admin_code(rec.code);
  if length(given) < 6 or (given <> want and 'LB' || given <> want) then
    insert into public.admin_code_attempts (user_id) values (uid);
    return jsonb_build_object('ok', false, 'code', 'wrong_code', 'tries_left', greatest(0, 4 - fails));
  end if;
  insert into public.user_roles (user_id, role) values (uid, 'admin') on conflict do nothing;
  delete from public.admin_code_attempts where user_id = uid;
  return jsonb_build_object('ok', true, 'first_admin', not has_admin);
end; $$;
grant execute on function public.redeem_admin_code(text) to authenticated;

create or replace function public.admin_code_info()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select jsonb_build_object('code', c.code, 'enabled', c.enabled, 'updated_at', c.updated_at,
         'admins', (select count(*) from public.user_roles where role = 'admin'))
    into r from public.admin_code c where c.id;
  return r;
end; $$;
grant execute on function public.admin_code_info() to authenticated;

-- p_code null = make a new random code; otherwise use the admin's own code (8 to 40 letters/numbers)
create or replace function public.admin_set_code(p_code text default null)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_code is null then c := public.new_admin_code();
  else
    c := btrim(p_code);
    if length(public.norm_admin_code(c)) < 8 then raise exception 'code_too_short'; end if;
    if length(public.norm_admin_code(c)) > 40 then raise exception 'code_too_long'; end if;
  end if;
  insert into public.admin_code (id, code, updated_at, updated_by) values (true, c, now(), auth.uid())
    on conflict (id) do update set code = excluded.code, updated_at = now(), updated_by = auth.uid();
  return c;
end; $$;
grant execute on function public.admin_set_code(text) to authenticated;

create or replace function public.admin_set_code_enabled(p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.admin_code set enabled = coalesce(p_on, true), updated_at = now(), updated_by = auth.uid() where id;
end; $$;
grant execute on function public.admin_set_code_enabled(boolean) to authenticated;

-- Dashboard numbers and the topics students miss most
create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select jsonb_build_object(
    'users', (select count(*) from auth.users),
    'new_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'paying', (select count(distinct user_id) from public.enrollments where source = 'stripe'),
    'revenue_cents', (select coalesce(sum(amount_cents), 0) from public.payments where status = 'paid'),
    'revenue_30d_cents', (select coalesce(sum(amount_cents), 0) from public.payments where status = 'paid' and created_at > now() - interval '30 days'),
    'online_now', (select count(*) from public.active_sessions where last_seen > now() - interval '2 minutes'),
    'ai_today', (select coalesce(sum(count), 0) from public.ai_usage where day = current_date),
    'courses', (select count(*) from public.courses),
    'enrollments', (select count(*) from public.enrollments),
    'signups_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d), '[]') from (
        select date_trunc('day', created_at)::date d, count(*) n from auth.users where created_at > now() - interval '30 days' group by 1) s),
    'weak_topics', (select coalesce(jsonb_agg(jsonb_build_object('topic', topic, 'answered', a, 'accuracy', round(100.0 * c / nullif(a, 0)))) , '[]') from (
        select t.key topic, sum((t.value->>'a')::int) a, sum((t.value->>'c')::int) c
        from public.progress p, jsonb_each(coalesce(p.data->'stats', '{}'::jsonb)) tr, jsonb_each(tr.value) t
        group by t.key having sum((t.value->>'a')::int) >= 10 order by sum((t.value->>'c')::int)::float / sum((t.value->>'a')::int) asc limit 8) w)
  ) into r;
  return r;
end; $$;
grant execute on function public.admin_stats() to authenticated;

-- -------------------------------------------------------------------------------------
-- Realtime: live chat, calls to action and notifications update instantly
-- -------------------------------------------------------------------------------------
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.live_messages'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.live_ctas'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.lives'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.notifications'; exception when others then null; end;
end $$;

-- -------------------------------------------------------------------------------------
-- Instructors (see is_staff near the top)
-- -------------------------------------------------------------------------------------

-- Admins make someone an instructor (or a student again). Admin accounts are changed with admin_set_admin.
create or replace function public.admin_set_instructor(p_user uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if exists (select 1 from public.user_roles where user_id = p_user and role = 'admin') then
    raise exception 'that account is an admin; remove admin access first';
  end if;
  if p_on then
    insert into public.user_roles (user_id, role) values (p_user, 'instructor') on conflict (user_id) do update set role = 'instructor';
  else
    delete from public.user_roles where user_id = p_user and role = 'instructor';
  end if;
end; $$;
grant execute on function public.admin_set_instructor(uuid, boolean) to authenticated;

-- -------------------------------------------------------------------------------------
-- Knowledge library: documents staff add (bulletins, board rules, their own notes, web pages),
-- split into passages the AI searches by keywords and by meaning (384-number gte-small vectors,
-- made inside the edge function). Students never read these tables directly.
-- -------------------------------------------------------------------------------------
create extension if not exists vector with schema extensions;

create table if not exists public.kb_docs (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  kind text not null default 'notes' check (kind in ('notes','bulletin','rules','code','lesson','web','other')),
  trade text check (trade in ('gc','elec','plumb','hvac','law')),
  state text,
  source_url text,
  status text not null default 'processing' check (status in ('processing','ready','error')),
  error text,
  chunk_count int not null default 0,
  char_count int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.kb_chunks (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.kb_docs(id) on delete cascade,
  seq int not null,
  ref text,
  content text not null check (char_length(content) between 1 and 4000),
  trade text,
  state text,
  embedding extensions.vector(384),
  fts tsvector generated always as (to_tsvector('english', coalesce(ref, '') || ' ' || content)) stored,
  created_at timestamptz not null default now(),
  unique (doc_id, seq)
);
create index if not exists kb_chunks_fts_idx on public.kb_chunks using gin (fts);
create index if not exists kb_chunks_doc_idx on public.kb_chunks (doc_id, seq);
create index if not exists kb_chunks_embedding_idx on public.kb_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists kb_docs_created_idx on public.kb_docs (created_at desc);

alter table public.kb_docs enable row level security;
alter table public.kb_chunks enable row level security;
select pg_temp.pol('kb_docs','kb docs staff','create policy "kb docs staff" on public.kb_docs for all to authenticated using (public.is_staff()) with check (public.is_staff())');
select pg_temp.pol('kb_chunks','kb chunks staff read','create policy "kb chunks staff read" on public.kb_chunks for select to authenticated using (public.is_staff())');
revoke insert, update, delete on public.kb_chunks from anon, authenticated;

-- Hybrid search: keyword matches (any word) and meaning matches, merged by reciprocal rank.
-- p_embedding is the question's vector as text ('[0.1, ...]') or null for keywords only.
create or replace function public.kb_search(p_query text, p_embedding text default null, p_trade text default null, p_state text default null, p_limit int default 6)
returns table (id uuid, doc_id uuid, ref text, content text, score double precision)
language sql stable security definer set search_path = public, extensions as $$
  with q as (
    select (select to_tsquery('simple', string_agg(quote_literal(w), ' | '))
              from unnest(tsvector_to_array(to_tsvector('english', left(coalesce(p_query, ''), 2000)))) w) as tsq,
           case when p_embedding is null or p_embedding = '' then null else p_embedding::extensions.vector(384) end as emb
  ),
  pool as (
    select c.id, c.fts, c.embedding
    from public.kb_chunks c join public.kb_docs d on d.id = c.doc_id
    where d.status = 'ready'
      and (c.trade is null or p_trade is null or c.trade = p_trade or c.trade = 'law')
      and (c.state is null or c.state = p_state)
  ),
  kw as (
    select p.id, row_number() over (order by ts_rank_cd(p.fts, q.tsq) desc) as r
    from pool p, q where q.tsq is not null and p.fts @@ q.tsq
    order by ts_rank_cd(p.fts, q.tsq) desc limit 40
  ),
  sem as (
    select p.id, row_number() over (order by p.embedding <=> q.emb) as r
    from pool p, q where q.emb is not null and p.embedding is not null
    order by p.embedding <=> q.emb limit 40
  ),
  fused as (
    select x.id, sum(1.0 / (60 + x.r)) as score from (select kw.id, kw.r from kw union all select sem.id, sem.r from sem) x group by x.id
  )
  select c.id, c.doc_id, coalesce(nullif(c.ref, ''), d.title) as ref, c.content, f.score::double precision
  from fused f join public.kb_chunks c on c.id = f.id join public.kb_docs d on d.id = c.doc_id
  order by f.score desc, c.seq
  limit greatest(1, least(coalesce(p_limit, 6), 20));
$$;
revoke execute on function public.kb_search(text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.kb_search(text, text, text, text, int) to service_role;

-- -------------------------------------------------------------------------------------
-- AI command center (admins and instructors). Actions that reach people or change the site
-- (announcements, emails, scheduling, publishing, roles) wait here until the person taps Confirm.
-- Server only: no policies, so the app can't read or change these rows directly.
-- -------------------------------------------------------------------------------------
create table if not exists public.assistant_actions (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','done','cancelled','failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists assistant_actions_user_idx on public.assistant_actions (created_by, created_at desc);
alter table public.assistant_actions enable row level security;

-- One row per student with what the command center needs to spot who's on track (server only)
create or replace function public.staff_student_rows(p_limit int default 2000)
returns table (id uuid, email text, full_name text, state text, trade text, created_at timestamptz, last_sign_in_at timestamptz,
               role text, paid boolean, enrolled bigint, progress jsonb, progress_updated_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email::text, p.full_name, p.state, p.trade, u.created_at, u.last_sign_in_at,
         coalesce(r.role, 'student'), public.has_paid_plan(u.id),
         (select count(*) from public.enrollments e where e.user_id = u.id),
         pr.data, pr.updated_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.user_roles r on r.user_id = u.id
  left join public.progress pr on pr.user_id = u.id
  order by u.created_at desc
  limit greatest(1, least(coalesce(p_limit, 2000), 10000));
$$;
revoke execute on function public.staff_student_rows(int) from public, anon, authenticated;
grant execute on function public.staff_student_rows(int) to service_role;

-- -------------------------------------------------------------------------------------
-- Automations: jobs that run on their own (weekly team digest, at-risk alerts, study nudges,
-- exam countdowns, new-signup alerts). Admins switch them on and off; the automations function
-- runs whatever is due (called every hour by GitHub Actions, and when staff open the admin area).
-- -------------------------------------------------------------------------------------
create table if not exists public.automations (
  kind text primary key check (kind in ('weekly_digest','at_risk_alert','inactive_nudge','exam_countdown','new_signup_alert')),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  last_result text,
  updated_at timestamptz not null default now()
);
alter table public.automations enable row level security;
select pg_temp.pol('automations','automations staff read','create policy "automations staff read" on public.automations for select to authenticated using (public.is_staff())');
select pg_temp.pol('automations','automations admin','create policy "automations admin" on public.automations for update to authenticated using (public.is_admin()) with check (public.is_admin())');
insert into public.automations (kind, enabled, config) values
  ('weekly_digest',    true,  '{"weekday":1,"hour":8,"audience":"staff","email":true}'),
  ('at_risk_alert',    true,  '{"hour":8,"audience":"instructors","email":true}'),
  ('inactive_nudge',   true,  '{"hour":18,"days":5,"email":false}'),
  ('exam_countdown',   true,  '{"hour":9,"email":false}'),
  ('new_signup_alert', false, '{"audience":"admins","email":true}')
on conflict (kind) do nothing;
-- Admins change only the switch and the options; run times and results are written by the server
revoke insert, update, delete on public.automations from anon, authenticated;
grant update (enabled, config, updated_at) on public.automations to authenticated;

-- -------------------------------------------------------------------------------------
-- Storage: course videos (private) and public images
-- -------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('course-media', 'course-media', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('public-media', 'public-media', true) on conflict (id) do nothing;

drop policy if exists "course media admin" on storage.objects;
create policy "course media admin" on storage.objects for all to authenticated
  using (bucket_id = 'course-media' and public.is_admin()) with check (bucket_id = 'course-media' and public.is_admin());
drop policy if exists "public media read" on storage.objects;
create policy "public media read" on storage.objects for select using (bucket_id = 'public-media');
drop policy if exists "public media admin" on storage.objects;
create policy "public media admin" on storage.objects for all to authenticated
  using (bucket_id = 'public-media' and public.is_admin()) with check (bucket_id = 'public-media' and public.is_admin());

-- -------------------------------------------------------------------------------------
-- Your admin code (shown in the results panel below after you click Run).
-- Sign up on your site, open /admin, and enter this code to become the first admin.
-- After that, see and change it in Admin -> Settings. Lost it? Run this file again, or run the select below.
-- (The old way still works too:
--   insert into public.user_roles (user_id, role) select id, 'admin' from auth.users where email = 'you@example.com';)
-- -------------------------------------------------------------------------------------
select code as "Your admin code",
       case when exists (select 1 from public.user_roles where role = 'admin')
            then 'Admins exist. This code adds more admins' || case when enabled then '.' else ' only after you switch it on in Admin -> Settings.' end
            else 'No admin yet. Sign up on your site, open /admin and enter this code.' end as "What to do"
from public.admin_code where id;
