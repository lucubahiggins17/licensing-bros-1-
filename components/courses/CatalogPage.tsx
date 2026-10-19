"use client";
// /courses/?state=&trade=  — "Find your course": trade tiles + Form CS-1, then matching course cards.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Search, X, UserCheck, RefreshCw, GraduationCap, Plus, ArrowUpDown } from "lucide-react";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/lib/auth";
import { routes } from "@/lib/nav";
import { STATES } from "@/lib/data";
import type { Trade } from "@/lib/types";
import { useParam, fetchCatalog, courseMatches, coversState, isTrade, isFreeCourse, TRADE_META, TILE_TRADES, STATE_ABBR, type CatalogCourse } from "./courseData";
import CourseCard, { CourseCardSkeleton } from "./CourseCard";
import s from "./Catalog.module.css";

type Sort = "recommended" | "price_asc" | "price_desc";

/** Accepts "Tennessee", "tennessee" or "TN" in the URL. */
function normalizeState(v: string | null): string {
  if (!v) return "";
  const t = v.trim().toLowerCase();
  return STATES.find((st) => st.toLowerCase() === t || (STATE_ABBR[st] || "").toLowerCase() === t) || "";
}

export default function CatalogPage() {
  return (
    <AppShell blueprint>
      <Suspense fallback={<Hero state="" trade="" onApply={() => {}} counts={null} />}>
        <Catalog />
      </Suspense>
    </AppShell>
  );
}

function Catalog() {
  const router = useRouter();
  const state = normalizeState(useParam("state"));
  const tradeParam = useParam("trade");
  const trade: Trade | "" = isTrade(tradeParam) ? tradeParam : "";
  const { account } = useAuth();
  const isAdmin = !!account?.is_admin;

  const [courses, setCourses] = useState<CatalogCourse[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("recommended");
  const resultsRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    setError("");
    setCourses(null);
    try {
      setCourses(await fetchCatalog());
    } catch (e: any) {
      setError(typeof navigator !== "undefined" && !navigator.onLine
        ? "You're offline. Connect to the internet to see courses."
        : "We couldn't load the courses right now.");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const apply = useCallback((st: string, tr: string, scroll = false) => {
    router.replace(routes.courses({ state: st, trade: tr }), { scroll: false });
    if (scroll) {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      window.setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        resultsRef.current?.focus({ preventScroll: true });
      }, 60);
    }
  }, [router]);

  // Per-trade counts for the tiles (respecting the chosen state)
  const counts = useMemo(() => {
    if (!courses) return null;
    const c: Record<string, number> = {};
    TILE_TRADES.forEach((t) => { c[t] = courses.filter((x) => courseMatches(x, state || null, t)).length; });
    return c;
  }, [courses, state]);

  const results = useMemo(() => {
    if (!courses) return [];
    const q = search.trim().toLowerCase();
    let list = courses.filter((c) => courseMatches(c, state || null, trade || null));
    if (q) {
      list = list.filter((c) =>
        [c.title, c.subtitle, c.description, c.level, (TRADE_META[c.trade] || TRADE_META.all).label, ...(c.states || [])].join(" ").toLowerCase().includes(q));
    }
    const price = (c: CatalogCourse) => (isFreeCourse(c) ? 0 : c.price_cents);
    const fit = (c: CatalogCourse) =>
      (state && (c.states || []).length && coversState(c.states, state) ? 0 : 2) + (trade && c.trade === trade ? 0 : 1);
    const base = (a: CatalogCourse, b: CatalogCourse) => a.sort - b.sort || a.title.localeCompare(b.title);
    return [...list].sort((a, b) =>
      sort === "price_asc" ? price(a) - price(b) || base(a, b)
        : sort === "price_desc" ? price(b) - price(a) || base(a, b)
          : fit(a) - fit(b) || base(a, b));
  }, [courses, state, trade, search, sort]);

  const tradeLabel = trade ? TRADE_META[trade].label : "";
  const scope = [state, tradeLabel].filter(Boolean).join(" · ");

  return (
    <>
      <Hero state={state} trade={trade} onApply={apply} counts={counts} />
      <div className="hazard" />

      <section className={s.results} aria-labelledby="results-title">
        <div className="wrap">
          <div className={s.resultsHead}>
            <div className={s.resultsTitle}>
              <p className="eyebrow orange">Course results</p>
              <h2 id="results-title" ref={resultsRef} tabIndex={-1}>
                {courses ? `${results.length} ${results.length === 1 ? "course" : "courses"}` : "Courses"}
                <span>{scope ? `for ${scope}` : "All states & trades"}</span>
              </h2>
              {(state || trade) && (
                <div className={s.chips}>
                  {state && <button className={s.filterChip} onClick={() => apply("", trade)} aria-label={`Remove state filter ${state}`}>{state} <X aria-hidden="true" /></button>}
                  {trade && <button className={s.filterChip} onClick={() => apply(state, "")} aria-label={`Remove trade filter ${tradeLabel}`}>{tradeLabel} <X aria-hidden="true" /></button>}
                  <button className="btn sm ghost" onClick={() => apply("", "")}>Clear all</button>
                </div>
              )}
            </div>
            <div className={s.controls}>
              <label className={s.search}>
                <span className={s.sr}>Search courses</span>
                <Search aria-hidden="true" />
                <input className="input" type="search" placeholder="Search courses" value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
              <label className={s.sort}>
                <ArrowUpDown aria-hidden="true" />
                <span className={s.sr}>Sort by</span>
                <select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="recommended">Recommended</option>
                  <option value="price_asc">Price: low to high</option>
                  <option value="price_desc">Price: high to low</option>
                </select>
              </label>
            </div>
          </div>

          {error ? (
            <div className={`card hard ${s.state}`} role="alert">
              <h3>Couldn&rsquo;t load courses</h3>
              <p>{error}</p>
              <button className="btn primary" onClick={load}><RefreshCw aria-hidden="true" /> Try again</button>
            </div>
          ) : !courses ? (
            <div className={s.grid} aria-busy="true" aria-label="Loading courses">
              <CourseCardSkeleton /><CourseCardSkeleton /><CourseCardSkeleton />
            </div>
          ) : results.length ? (
            <div className={s.grid}>
              {results.map((c) => <CourseCard key={c.id} course={c} owned={!!account?.enrolled?.includes(c.id)} isAdmin={isAdmin} />)}
            </div>
          ) : (
            <EmptyState
              total={courses.length}
              search={search}
              state={state}
              trade={trade}
              isAdmin={isAdmin}
              onClearSearch={() => setSearch("")}
              onApply={apply}
            />
          )}
        </div>
      </section>
    </>
  );
}

function Hero({ state, trade, onApply, counts }: { state: string; trade: Trade | ""; onApply: (st: string, tr: string, scroll?: boolean) => void; counts: Record<string, number> | null }) {
  const { user, profile } = useAuth();
  const [draftState, setDraftState] = useState(state);
  const [draftTrade, setDraftTrade] = useState<string>(trade);
  useEffect(() => { setDraftState(state); }, [state]);
  useEffect(() => { setDraftTrade(trade); }, [trade]);

  const pickTile = (t: Trade) => {
    const next = trade === t ? "" : t;
    setDraftTrade(next);
    onApply(state, next);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onApply(draftState, draftTrade, true);
  };
  const profileDiffers = !!(user && profile && (profile.state !== state || profile.trade !== trade));

  return (
    <section className={s.hero}>
      <div className={`wrap ${s.heroGrid}`}>
        <div className={s.intro}>
          <div className={`plate orange ${s.plate}`}>
            <h1>Find your course</h1>
            <p className={s.plateSub}>State &amp; trade specific training</p>
            <span className="bolts" />
          </div>
          <p className={s.lede}>
            Every state tests a little differently. Pick your trade and your state and we&rsquo;ll show the courses built for
            your exam: the code book, the law and business rules, and practice that matches the real test.
          </p>
          <div className={s.tiles} role="group" aria-label="Filter by trade">
            {TILE_TRADES.map((t) => {
              const { short, Icon } = TRADE_META[t];
              return (
                <button key={t} type="button" className={s.tile} aria-pressed={trade === t} onClick={() => pickTile(t)}>
                  <span className={s.tileIco}><Icon aria-hidden="true" /></span>
                  <span className={s.tileName}>{short}</span>
                  <span className={s.tileCount}>
                    {counts ? `${counts[t]} ${counts[t] === 1 ? "course" : "courses"}` : " "}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <form className={`formcs ${s.form}`} onSubmit={submit} aria-labelledby="cs1-title">
          <div className="hazard" />
          <div className={`formhead ${s.formHead}`}>
            <b id="cs1-title">Form CS-1 <span className={s.formName}>Course Selection Form</span></b>
            <span className={s.rev} aria-hidden="true">LB-2026</span>
          </div>
          <div className="formbody">
            <label className="field" htmlFor="cs1-state">
              <span className={s.step}><span className="stepnum">1</span>Your state</span>
              <select id="cs1-state" value={draftState} onChange={(e) => setDraftState(e.target.value)}>
                <option value="">All states</option>
                {STATES.map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
            </label>
            <label className="field" htmlFor="cs1-trade">
              <span className={s.step}><span className="stepnum">2</span>Trade specialization</span>
              <select id="cs1-trade" value={draftTrade} onChange={(e) => setDraftTrade(e.target.value)}>
                <option value="">All trades</option>
                {TILE_TRADES.map((t) => <option key={t} value={t}>{TRADE_META[t].label}</option>)}
              </select>
            </label>
            <button type="submit" className="btn navy cta block big">Submit course request <ArrowRight aria-hidden="true" /></button>
            {profileDiffers && profile && (
              <button type="button" className={s.useProfile} onClick={() => onApply(profile.state, profile.trade, true)}>
                <UserCheck aria-hidden="true" /> Use my profile: {profile.state} &middot; {TRADE_META[profile.trade]?.short || profile.trade}
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}

function EmptyState({ total, search, state, trade, isAdmin, onClearSearch, onApply }: {
  total: number; search: string; state: string; trade: Trade | ""; isAdmin: boolean;
  onClearSearch: () => void; onApply: (st: string, tr: string, scroll?: boolean) => void;
}) {
  const nothingYet = total === 0;
  return (
    <div className={`card tape ${s.state}`}>
      <h3>{nothingYet ? "Courses are on the way" : "No courses match that yet"}</h3>
      <p>
        {nothingYet
          ? "We're building courses for every state and trade. In the meantime, My Learning already has the AI tutor, practice exams, games and flashcards for your exam."
          : search
            ? `Nothing matched “${search}”${state || trade ? " with these filters" : ""}. Try a shorter word, or clear the search.`
            : `We don't have a course for ${[state, trade ? TRADE_META[trade].label : ""].filter(Boolean).join(" ") || "that"} yet. Courses for every state are listed under "All states", and My Learning covers your state's exam today.`}
      </p>
      <div className="row">
        {search && <button className="btn" onClick={onClearSearch}><X aria-hidden="true" /> Clear search</button>}
        {!nothingYet && state && <button className="btn" onClick={() => onApply("", trade, true)}>Show all states</button>}
        {!nothingYet && trade && <button className="btn" onClick={() => onApply(state, "", true)}>Show all trades</button>}
        <Link className="btn primary" href={routes.learn()}><GraduationCap aria-hidden="true" /> Open My Learning</Link>
        {isAdmin && <Link className="btn navy" href={routes.admin("courses")}><Plus aria-hidden="true" /> {nothingYet ? "Add your first course" : "Add a course"}</Link>}
      </div>
    </div>
  );
}
