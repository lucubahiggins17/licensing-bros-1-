"""
A small in-memory stand-in for Supabase (PostgREST + Auth + Edge Functions) used by the browser tests.
It understands the query shapes supabase-js sends: select (with one level of embedding), eq/neq/in/is/gt/gte/
lt/lte/ilike/or filters, order, limit, range, single-object responses, insert/upsert/update/delete and rpc calls.
Security is NOT modelled here (that is tested against real Postgres in tests/sql); this exercises the UI.
"""
import json, re, time, uuid, copy, random, urllib.parse
from datetime import datetime, timedelta, timezone

def now_iso(delta_minutes=0):
    return (datetime.now(timezone.utc) + timedelta(minutes=delta_minutes)).isoformat()

ADMIN_ID = "00000000-0000-0000-0000-00000000000a"
PAID_ID = "00000000-0000-0000-0000-00000000000b"
FREE_ID = "00000000-0000-0000-0000-00000000000c"
C_FREE = "10000000-0000-0000-0000-000000000001"
C_PAID = "10000000-0000-0000-0000-000000000002"
L_FREE1 = "20000000-0000-0000-0000-000000000001"
L_PAID1 = "20000000-0000-0000-0000-000000000002"
L_PAID2 = "20000000-0000-0000-0000-000000000003"
L_PREV = "20000000-0000-0000-0000-000000000004"
M1 = "30000000-0000-0000-0000-000000000001"
M2 = "30000000-0000-0000-0000-000000000002"
LIVE_NOW = "40000000-0000-0000-0000-000000000001"
LIVE_SOON = "40000000-0000-0000-0000-000000000002"
LIVE_DONE = "40000000-0000-0000-0000-000000000003"
POST1 = "50000000-0000-0000-0000-000000000001"
DECK1 = "60000000-0000-0000-0000-000000000001"

USERS = {
    ADMIN_ID: {"email": "owner@licensingbros.test", "name": "LuCuba Higgins", "admin": True},
    PAID_ID: {"email": "paid@licensingbros.test", "name": "Marcus Paid", "admin": False},
    FREE_ID: {"email": "free@licensingbros.test", "name": "Tasha Free", "admin": False},
}

def seed():
    db = {
        "site_settings": [
            {"key": "home_stats", "value": [{"value": "50", "label": "States + DC covered"}, {"value": "4", "label": "Trades: GC, electrical, plumbing, HVAC"}, {"value": "800+", "label": "Verified code, OSHA & business facts"}]},
            {"key": "hero", "value": {"badge_top": "2026 Edition", "badge_main": "Industry-leading contractor education", "headline_1": "Master your", "headline_2": "Contractor license", "sub": "The blueprint to your exam preparation for electrical, plumbing, HVAC, and general contractor certifications"}},
            {"key": "free_limits", "value": {"ai_daily": 5, "exam_max_questions": 10, "ai_exams": False, "practice_sets": False}},
            {"key": "paid_limits", "value": {"ai_daily": 60, "exam_max_questions": 50, "ai_exams": True, "practice_sets": True}},
            {"key": "location_rules", "value": {"enforce": True, "home_radius_miles": 100, "home_change_days": 30, "away_max_days": 30, "away_default_days": 14, "away_passes_per_90_days": 3, "session_timeout_seconds": 120}},
            {"key": "support", "value": {"email": "help@licensingbros.test", "phone": "(615) 555-0100"}},
        ],
        "profiles": [
            {"id": uid, "full_name": u["name"], "avatar_url": None, "state": "Tennessee", "trade": "gc", "exam_date": (datetime.now() + timedelta(days=40)).date().isoformat(), "created_at": now_iso(-60*24*20)}
            for uid, u in USERS.items()
        ],
        "user_roles": [{"user_id": ADMIN_ID, "role": "admin", "created_at": now_iso()}],
        "courses": [
            {"id": C_FREE, "slug": "osha-basics", "title": "OSHA Safety Basics for Contractors", "subtitle": "The safety rules every licensing exam tests", "description": "Fall protection, ladders, scaffolds, trenching and recordkeeping, explained with jobsite examples.", "trade": "all", "states": [], "level": "Beginner", "price_cents": 0, "is_free": True, "published": True, "cover_url": None, "est_hours": 2, "what_you_learn": ["When fall protection is required", "Trench protective systems", "OSHA 300 log rules"], "sort": 1, "created_at": now_iso(-9000), "updated_at": now_iso(-9000)},
            {"id": C_PAID, "slug": "tn-gc-master", "title": "Tennessee GC Exam Master Course", "subtitle": "Business & Law plus the Tennessee BC-A trade exam", "description": "A complete course for the Tennessee general contractor exam: NASCLA business and law, IBC/IRC code navigation, estimating math and OSHA.", "trade": "gc", "states": ["Tennessee"], "level": "Exam prep", "price_cents": 29900, "is_free": False, "published": True, "cover_url": None, "est_hours": 24, "what_you_learn": ["Tab and navigate your open-book references", "Lien law, bonds and contracts", "Estimating and markup math"], "sort": 2, "created_at": now_iso(-8000), "updated_at": now_iso(-8000)},
        ],
        "modules": [
            {"id": M1, "course_id": C_PAID, "title": "Business & Law", "sort": 1},
            {"id": M2, "course_id": C_PAID, "title": "Code navigation", "sort": 2},
        ],
        "lessons": [
            {"id": L_FREE1, "course_id": C_FREE, "module_id": None, "title": "Fall protection: the 6-foot rule", "kind": "video", "is_preview": False, "duration_min": 12, "summary": "When construction workers need fall protection and what counts.", "sort": 1, "created_at": now_iso()},
            {"id": L_PREV, "course_id": C_PAID, "module_id": M1, "title": "How the NASCLA exam works", "kind": "video", "is_preview": True, "duration_min": 8, "summary": "Format, timing and how to use your open book.", "sort": 1, "created_at": now_iso()},
            {"id": L_PAID1, "course_id": C_PAID, "module_id": M1, "title": "Mechanic's liens and lien waivers", "kind": "text", "is_preview": False, "duration_min": 15, "summary": "Conditional vs unconditional waivers and notice deadlines.", "sort": 2, "created_at": now_iso()},
            {"id": L_PAID2, "course_id": C_PAID, "module_id": M2, "title": "Finding answers fast in the IBC", "kind": "video", "is_preview": False, "duration_min": 20, "summary": "Index words and tables that answer most code questions.", "sort": 1, "created_at": now_iso()},
        ],
        "lesson_content": [
            {"lesson_id": L_PAID1, "video_url": None, "body_md": "## Lien waivers\n\nA **conditional** waiver only takes effect once payment clears.\n\n- Sign unconditional waivers only after you are paid\n- Track notice deadlines", "quiz": [{"q": "When does a conditional lien waiver take effect?", "c": ["On signing", "When payment is received", "At substantial completion", "After 30 days"], "a": 1, "why": "It is conditioned on actually receiving the payment."}], "attachments": []},
        ],
        "enrollments": [{"user_id": PAID_ID, "course_id": C_PAID, "source": "stripe", "created_at": now_iso(-3000)}],
        "payments": [{"id": str(uuid.uuid4()), "user_id": PAID_ID, "course_id": C_PAID, "amount_cents": 29900, "currency": "usd", "stripe_session_id": "cs_test_1", "stripe_payment_intent": "pi_1", "status": "paid", "created_at": now_iso(-3000)}],
        "lesson_progress": [{"user_id": PAID_ID, "lesson_id": L_PREV, "course_id": C_PAID, "completed": True, "position_sec": 0, "notes": "", "updated_at": now_iso(-100)}],
        "certificates": [{"id": str(uuid.uuid4()), "code": "LB7X2Q9KM4", "user_id": PAID_ID, "course_id": C_FREE, "student_name": "Marcus Paid", "course_title": "OSHA Safety Basics for Contractors", "issued_at": now_iso(-500)}],
        "lives": [
            {"id": LIVE_NOW, "title": "Lien Law Live Q&A", "description": "Bring your lien and bond questions.", "trade": "all", "is_free": True, "course_id": None, "starts_at": now_iso(-15), "status": "live", "provider": "embed", "room_name": "lb-now", "cover_url": None, "host_id": ADMIN_ID, "created_at": now_iso(-1000)},
            {"id": LIVE_SOON, "title": "Tennessee GC Exam Cram Night", "description": "Two hours of the most-missed topics.", "trade": "gc", "is_free": False, "course_id": C_PAID, "starts_at": now_iso(60*26), "status": "scheduled", "provider": "livekit", "room_name": "lb-soon", "cover_url": None, "host_id": ADMIN_ID, "created_at": now_iso(-1000)},
            {"id": LIVE_DONE, "title": "OSHA Fall Protection Workshop", "description": "Replay of last week's class.", "trade": "all", "is_free": True, "course_id": None, "starts_at": now_iso(-60*24*7), "status": "ended", "provider": "livekit", "room_name": "lb-done", "cover_url": None, "host_id": ADMIN_ID, "created_at": now_iso(-20000)},
        ],
        "live_private": [{"live_id": LIVE_NOW, "embed_url": "about:blank", "replay_url": None}],
        "live_ctas": [{"id": str(uuid.uuid4()), "live_id": LIVE_NOW, "kind": "course", "title": "Live-only deal: Tennessee GC Master Course", "body": "Save 20% during class.", "button_label": "Get it now", "url": None, "course_id": C_PAID, "promo_code": "LIVE20", "options": [], "active": True, "created_at": now_iso(-2)}],
        "poll_votes": [],
        "live_messages": [
            {"id": str(uuid.uuid4()), "live_id": LIVE_NOW, "user_id": ADMIN_ID, "display_name": "LuCuba Higgins", "body": "Welcome in! Drop your lien questions below.", "is_host": True, "created_at": now_iso(-10)},
            {"id": str(uuid.uuid4()), "live_id": LIVE_NOW, "user_id": FREE_ID, "display_name": "Tasha Free", "body": "Do I need a notice of commencement in Tennessee?", "is_host": False, "created_at": now_iso(-8)},
        ],
        "community_posts": [
            {"id": POST1, "user_id": FREE_ID, "display_name": "Tasha Free", "trade": "gc", "state": "Tennessee", "title": "How many questions are on the Tennessee BC-A exam?", "body": "Taking it next month. How should I split study time?", "pinned": False, "reply_count": 1, "upvotes": 3, "created_at": now_iso(-300)},
        ],
        "community_replies": [
            {"id": str(uuid.uuid4()), "post_id": POST1, "user_id": PAID_ID, "display_name": "Marcus Paid", "body": "Check the PSI candidate bulletin for the exact count. Business & Law is a separate exam.", "is_ai": False, "is_staff": False, "created_at": now_iso(-200)},
        ],
        "community_votes": [],
        "notifications": [
            {"id": str(uuid.uuid4()), "user_id": None, "title": "Live now: Lien Law Live Q&A", "body": "Join the free class.", "link": f"/live/watch/?id={LIVE_NOW}", "created_at": now_iso(-15)},
        ],
        "notification_reads": [],
        "practice_sets": [
            {"id": str(uuid.uuid4()), "title": "Tennessee GC Warm-up", "kind": "test", "topic": "", "pairs": [], "trade": "gc", "state": "Tennessee", "part": "mix", "questions": [{"t": "gc", "topic": "Safety (OSHA)", "q": "At what height does OSHA require fall protection on construction walking surfaces?", "c": ["4 ft", "6 ft", "8 ft", "10 ft"], "a": 1, "ref": "29 CFR 1926.501(b)(1)", "why": "Construction's trigger height is 6 feet."}], "is_free": True, "published": True, "created_by": ADMIN_ID, "created_at": now_iso(-50)},
            {"id": DECK1, "title": "Lien Law Lingo", "kind": "game", "topic": "Lien law", "trade": "gc", "state": None, "part": "mix", "questions": [], "pairs": [{"k": "Retainage", "v": "Part of each payment held back until the job is finished."}, {"k": "Lien waiver", "v": "A paper giving up lien rights for a payment."}, {"k": "Notice to owner", "v": "Early notice that a sub or supplier may file a lien."}, {"k": "Conditional waiver", "v": "Only takes effect once the payment actually clears."}, {"k": "Unconditional waiver", "v": "Takes effect when signed, paid or not."}, {"k": "Mechanic's lien", "v": "A claim on the property for unpaid work or materials."}, {"k": "Bond claim", "v": "Payment claim on public jobs, where liens aren't allowed."}], "is_free": True, "published": True, "created_by": ADMIN_ID, "created_at": now_iso(-40)},
        ],
        "active_sessions": [],
        "account_locations": [{"user_id": PAID_ID, "home_lat": 36.16, "home_lon": -86.78, "home_city": "Nashville", "home_region": "Tennessee", "home_country": "US", "home_set_at": now_iso(-5000), "away_lat": None, "away_lon": None, "away_city": None, "away_region": None, "away_until": None, "away_history": []}],
        "progress": [{"user_id": PAID_ID, "data": {"state": "Tennessee", "trade": "gc", "examDate": (datetime.now() + timedelta(days=40)).date().isoformat(), "stats": {"gc": {"Safety (OSHA)": {"c": 18, "a": 22}, "Contracts & liens": {"c": 6, "a": 12}, "Payroll & tax": {"c": 9, "a": 10}}}, "hist": [{"kind": "Mock exam", "detail": "78% · 39/50", "trade": "gc", "state": "Tennessee", "at": int(time.time()*1000) - 86400000}], "cards": {}, "extraPairs": [], "extraBank": [], "best": {}}, "updated_at": now_iso(-60)}],
    }
    return db

class FakeBackend:
    def __init__(self, user_id=None, location_state="home", no_admins=False):
        self.db = seed()
        self.user_id = user_id
        self.location_state = location_state  # home | away | outside
        self.calls = []  # (kind, name) for assertions
        self.no_admins = no_admins            # brand-new install: nobody is admin yet
        self.extra_admins = set()             # promoted with the admin code
        self.admin_code = {"code": "LB-TEST-CODE-2026", "enabled": True, "updated_at": now_iso(-3000)}
        self.code_fails = 0

    # ------------------------------------------------------------------ helpers
    def is_admin(self):
        if self.user_id in self.extra_admins:
            return True
        return (not self.no_admins) and self.user_id in USERS and USERS[self.user_id]["admin"]

    def has_admin(self):
        return bool(self.extra_admins) or not self.no_admins

    def enrolled(self):
        return [e["course_id"] for e in self.db["enrollments"] if e["user_id"] == self.user_id]

    def paid(self):
        return self.is_admin() or any(e["user_id"] == self.user_id and e["source"] != "free" for e in self.db["enrollments"])

    def settings(self, key):
        return next(r["value"] for r in self.db["site_settings"] if r["key"] == key)

    # ------------------------------------------------------------------ PostgREST
    def _filter(self, rows, params):
        out = rows
        for key, vals in params.items():
            if key in ("select", "order", "limit", "offset", "on_conflict", "columns"):
                continue
            for val in vals:
                if key == "or":
                    clauses = re.findall(r"([a-z_]+)\.(eq|ilike|is|neq)\.([^,()]*)", val.strip("()"))
                    def any_match(r):
                        for col, op, v in clauses:
                            if self._match(r.get(col), op, v):
                                return True
                        return False
                    out = [r for r in out if any_match(r)]
                    continue
                m = re.match(r"(not\.)?(eq|neq|in|is|gt|gte|lt|lte|ilike|like|cs|ov)\.(.*)$", val)
                if not m:
                    continue
                neg, op, v = m.groups()
                out = [r for r in out if self._match(r.get(key), op, v) != bool(neg)]
        return out

    def _match(self, cell, op, v):
        v = urllib.parse.unquote(v)
        if op in ("eq", "neq") and len(v) >= 2 and v[0] == '"' and v[-1] == '"':
            v = v[1:-1]  # PostgREST accepts quoted values
        if op == "is":
            return (cell is None) if v == "null" else (str(cell).lower() == v)
        if op == "in":
            items = [x.strip().strip('"') for x in v.strip("()").split(",")]
            return str(cell) in items
        if op in ("ilike", "like"):
            pat = re.escape(v).replace("\\*", ".*").replace("%", ".*")
            return re.fullmatch(pat, str(cell or ""), re.I) is not None
        if op == "cs":
            want = [x.strip().strip('"') for x in v.strip("{}").split(",") if x]
            return isinstance(cell, list) and all(w in cell for w in want)
        if op == "ov":
            want = [x.strip().strip('"') for x in v.strip("{}").split(",") if x]
            return isinstance(cell, list) and any(w in cell for w in want)
        def num(x):
            try:
                return float(x)
            except Exception:
                return x
        a, b = (cell if isinstance(cell, (int, float)) else str(cell)), (num(v) if isinstance(cell, (int, float)) else v)
        if isinstance(cell, bool):
            a, b = str(cell).lower(), v
        if op == "eq": return a == b
        if op == "neq": return a != b
        try:
            if op == "gt": return a > b
            if op == "gte": return a >= b
            if op == "lt": return a < b
            if op == "lte": return a <= b
        except TypeError:
            return False
        return False

    def _embed(self, table, rows, select):
        # one level of embedding: rel(cols) or alias:rel(cols) or rel!inner(cols)
        embeds = re.findall(r"(?:(\w+):)?(\w+)(?:!\w+)?\(([^()]*)\)", select or "")
        if not embeds:
            return rows
        singular = lambda t: t[:-1] if t.endswith("s") else t
        out = []
        for r in rows:
            r = dict(r)
            for alias, rel, cols in embeds:
                if rel not in self.db:
                    continue
                fk = f"{singular(rel)}_id"
                if fk in r:  # many-to-one (e.g. payments.course_id -> courses)
                    target = next((x for x in self.db[rel] if x.get("id") == r[fk]), None)
                    r[alias or rel] = target
                else:  # one-to-many (e.g. courses -> lessons)
                    back = f"{singular(table)}_id"
                    r[alias or rel] = [x for x in self.db[rel] if x.get(back) == r.get("id")]
            out.append(r)
        return out

    def rest(self, method, table, query, body, headers):
        params = urllib.parse.parse_qs(query, keep_blank_values=True)
        if table.startswith("rpc/"):
            return self.rpc(table[4:], body or {})
        if table not in self.db:
            return 404, {"message": f"relation {table} does not exist"}
        rows = self.db[table]
        prefer = headers.get("prefer", "")
        single = "vnd.pgrst.object" in headers.get("accept", "")
        if method == "GET" or method == "HEAD":
            res = self._filter(rows, params)
            if "order" in params:
                for part in reversed(params["order"][0].split(",")):
                    bits = part.split(".")
                    col = bits[0]; desc = "desc" in bits
                    res = sorted(res, key=lambda r: (r.get(col) is None, r.get(col) if not isinstance(r.get(col), (dict, list)) else str(r.get(col))), reverse=desc)
            off = int(params.get("offset", ["0"])[0])
            if "limit" in params:
                res = res[off: off + int(params["limit"][0])]
            rng = headers.get("range")
            if rng:
                a, b = [int(x) for x in rng.split("-")]
                res = res[a: b + 1]
            res = self._embed(table, res, params.get("select", [""])[0])
            if "count=exact" in prefer:
                return 200, res, {"content-range": f"0-{max(0, len(res)-1)}/{len(res)}"}
            if single:
                if not res:
                    return 406, {"message": "no rows", "code": "PGRST116"}
                return 200, res[0]
            return 200, res
        if method == "POST":
            items = body if isinstance(body, list) else [body]
            upsert = "resolution=merge-duplicates" in prefer or "resolution=ignore-duplicates" in prefer
            conflict = params.get("on_conflict", [""])[0].split(",") if params.get("on_conflict") else None
            created = []
            for it in items:
                it = dict(it)
                if "id" not in it and table not in ("site_settings", "enrollments", "lesson_progress", "notification_reads", "poll_votes", "community_votes", "progress", "lesson_content", "live_private", "user_roles", "account_locations", "active_sessions"):
                    it["id"] = str(uuid.uuid4())
                it.setdefault("created_at", now_iso())
                keys = conflict or self._pk(table)
                existing = next((r for r in rows if all(str(r.get(k)) == str(it.get(k)) for k in keys)), None) if keys else None
                if existing and upsert:
                    existing.update(it); created.append(existing)
                elif existing and keys:
                    return 409, {"message": "duplicate key value violates unique constraint", "code": "23505"}
                else:
                    if table == "community_replies":
                        for p in self.db["community_posts"]:
                            if p["id"] == it.get("post_id"):
                                p["reply_count"] += 1
                    if table == "community_votes":
                        for p in self.db["community_posts"]:
                            if p["id"] == it.get("post_id"):
                                p["upvotes"] += 1
                    rows.append(it); created.append(it)
            if "return=representation" in prefer:
                return (201, created[0]) if single else (201, created)
            return 201, None
        if method == "PATCH":
            res = self._filter(rows, params)
            for r in res:
                r.update(body or {})
            if "return=representation" in prefer:
                return (200, res[0] if res else None) if single else (200, res)
            return 204, None
        if method == "DELETE":
            res = self._filter(rows, params)
            for r in res:
                rows.remove(r)
                if table == "community_votes":
                    for p in self.db["community_posts"]:
                        if p["id"] == r.get("post_id"):
                            p["upvotes"] = max(0, p["upvotes"] - 1)
            if "return=representation" in prefer:
                return 200, res
            return 204, None
        return 405, {"message": "method not allowed"}

    def _pk(self, table):
        return {
            "site_settings": ["key"], "enrollments": ["user_id", "course_id"], "lesson_progress": ["user_id", "lesson_id"],
            "notification_reads": ["user_id"], "poll_votes": ["cta_id", "user_id"], "community_votes": ["post_id", "user_id"],
            "progress": ["user_id"], "lesson_content": ["lesson_id"], "live_private": ["live_id"], "user_roles": ["user_id"],
            "account_locations": ["user_id"], "active_sessions": ["user_id"], "profiles": ["id"],
        }.get(table, ["id"])

    # ------------------------------------------------------------------ RPC
    def rpc(self, name, args):
        self.calls.append(("rpc", name))
        if name == "my_account":
            lim = self.settings("paid_limits" if self.paid() else "free_limits")
            return 200, {"is_admin": self.is_admin(), "paid": self.paid(), "enrolled": self.enrolled(), "limits": lim}
        if name == "unread_notifications":
            return 200, len([n for n in self.db["notifications"] if n["user_id"] in (None, self.user_id)])
        if name == "verify_certificate":
            code = str(args.get("p_code", "")).strip().upper()
            return 200, [c for c in self.db["certificates"] if c["code"] == code]
        if name == "claim_certificate":
            return 200, "LBNEW12345"
        if name == "poll_results":
            votes = [v for v in self.db["poll_votes"] if v["cta_id"] == args.get("p_cta")]
            counts = {}
            for v in votes:
                counts[v["choice"]] = counts.get(v["choice"], 0) + 1
            return 200, [{"choice": k, "votes": n} for k, n in sorted(counts.items())]
        if name == "admin_stats":
            return 200, {"users": 3, "new_7d": 2, "paying": 1, "revenue_cents": 29900, "revenue_30d_cents": 29900, "online_now": 1, "ai_today": 14, "courses": 2, "enrollments": 1,
                         "signups_by_day": [{"day": (datetime.now() - timedelta(days=i)).date().isoformat(), "n": (i * 7) % 4} for i in range(29, -1, -1)],
                         "weak_topics": [{"topic": "Contracts & liens", "answered": 120, "accuracy": 54}, {"topic": "Payroll & tax", "answered": 80, "accuracy": 61}]}
        if name == "admin_list_users":
            out = []
            for uid, u in USERS.items():
                out.append({"id": uid, "email": u["email"], "full_name": u["name"], "state": "Tennessee", "trade": "gc", "created_at": now_iso(-9000), "last_sign_in_at": now_iso(-30),
                            "is_admin": u["admin"], "enrolled_count": len([e for e in self.db["enrollments"] if e["user_id"] == uid]), "paid": uid in (ADMIN_ID, PAID_ID),
                            "device": "Chrome on Windows", "device_city": "Nashville", "last_seen": now_iso(-1), "home_city": "Nashville", "home_region": "Tennessee"})
            return 200, out
        if name in ("admin_grant_course", "admin_revoke_course", "admin_reset_device", "admin_set_admin"):
            return 200, None
        if name == "admin_setup_status":
            return 200, {"has_admin": self.has_admin()}
        if name == "redeem_admin_code":
            norm = lambda x: re.sub(r"[^A-Z0-9]", "", str(x or "").upper())
            if not self.user_id:
                return 200, {"ok": False, "code": "signed_out"}
            if self.is_admin():
                return 200, {"ok": True, "already": True}
            if self.code_fails >= 5:
                return 200, {"ok": False, "code": "too_many_attempts"}
            first = not self.has_admin()
            if not first and not self.admin_code["enabled"]:
                return 200, {"ok": False, "code": "code_off"}
            given, want = norm(args.get("p_code")), norm(self.admin_code["code"])
            if len(given) < 6 or (given != want and "LB" + given != want):
                self.code_fails += 1
                return 200, {"ok": False, "code": "wrong_code", "tries_left": max(0, 5 - self.code_fails)}
            self.extra_admins.add(self.user_id)
            return 200, {"ok": True, "first_admin": first}
        if name == "admin_code_info":
            if not self.is_admin():
                return 400, {"message": "admins only"}
            admins = len([u for u in USERS.values() if u["admin"]]) + len(self.extra_admins)
            return 200, {**self.admin_code, "admins": admins}
        if name == "admin_set_code":
            if not self.is_admin():
                return 400, {"message": "admins only"}
            c = args.get("p_code")
            if c is None:
                c = "LB-" + "-".join("".join(random.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(4)) for _ in range(3))
            elif len(re.sub(r"[^A-Za-z0-9]", "", c)) < 8:
                return 400, {"message": "code_too_short"}
            self.admin_code.update({"code": c.strip(), "updated_at": now_iso()})
            return 200, self.admin_code["code"]
        if name == "admin_set_code_enabled":
            if not self.is_admin():
                return 400, {"message": "admins only"}
            self.admin_code["enabled"] = bool(args.get("p_on", True))
            return 200, None
        if name in ("is_admin",):
            return 200, self.is_admin()
        if name == "has_paid_plan":
            return 200, self.paid()
        return 404, {"message": f"function {name} not found"}

    # ------------------------------------------------------------------ Edge functions
    def location(self):
        st = self.location_state
        return {"state": st, "city": "Nashville" if st != "outside" else "Atlanta", "region": "Tennessee" if st != "outside" else "Georgia",
                "home_city": "Nashville", "home_region": "Tennessee", "away_city": None, "away_region": None, "away_until": None,
                "enforce": True, "away_passes_left": 3}

    def fn(self, name, body):
        self.calls.append(("fn", name))
        if name == "session":
            a = body.get("action")
            if a in ("claim", "heartbeat"):
                return 200, {"status": "ok", "session_id": body.get("session_id") or "sess-1", "location": self.location()}
            if a == "status":
                return 200, {"session": {"device": "Chrome on Windows", "city": "Nashville", "region": "Tennessee", "last_seen": now_iso()}, "location": self.location(), "rules": self.settings("location_rules")}
            if a in ("set_away", "set_home", "end_away"):
                self.location_state = "away" if a == "set_away" else "home"
                return 200, {"location": self.location()}
            return 200, {"status": "ok"}
        if name == "lesson":
            lid = body.get("lesson_id")
            lesson = next((l for l in self.db["lessons"] if l["id"] == lid), None)
            if not lesson:
                return 404, {"error": "Lesson not found.", "code": "not_found"}
            course = next(c for c in self.db["courses"] if c["id"] == lesson["course_id"])
            free = course["is_free"] or lesson["is_preview"]
            if not free and course["id"] not in self.enrolled() and not self.is_admin():
                return 403, {"error": "Buy this course to unlock this lesson.", "code": "not_enrolled"}
            if not free and self.location_state == "outside":
                return 403, {"error": "You're outside your home area.", "code": "outside_home", "location": self.location()}
            content = next((c for c in self.db["lesson_content"] if c["lesson_id"] == lid), {"body_md": "Lesson notes go here.", "quiz": [], "attachments": [], "video_url": None})
            video = None if lesson["kind"] == "text" else {"type": "youtube", "url": "about:blank"}
            return 200, {"lesson": lesson, "course": {k: course[k] for k in ("id", "title", "slug", "is_free")},
                         "content": {"body_md": content["body_md"], "quiz": content["quiz"], "attachments": content["attachments"], "video": video}}
        if name == "live-token":
            live = next(l for l in self.db["lives"] if l["id"] == body.get("live_id"))
            if body.get("role") == "host" and not self.is_admin():
                return 403, {"error": "Admins only.", "code": "forbidden"}
            if not live["is_free"] and not self.paid():
                return 403, {"error": "This class is for students in the course.", "code": "not_enrolled"}
            if live["status"] == "scheduled":
                return 200, {"mode": "waiting", "starts_at": live["starts_at"]}
            if live["provider"] == "embed":
                return 200, {"mode": "embed", "embed_url": "about:blank"}
            return 200, {"mode": "replay", "replay_url": "about:blank"}
        if name == "stripe-checkout":
            return 200, {"url": "about:blank#checkout"}
        if name == "generate":
            k = body.get("kind")
            if k == "admin_test":
                n = int(body.get("count", 5))
                return 200, {"questions": [{"t": "gc", "topic": "Safety (OSHA)", "q": f"Sample AI question {i+1}: guardrail top rail height?", "c": ["36 in", "39 in", "42 in ± 3 in", "48 in"], "a": 2, "ref": "29 CFR 1926.502(b)(1)", "why": "Top rails are 42 in plus or minus 3 in."} for i in range(n)]}
            if k == "admin_pairs":
                if not self.is_admin():
                    return 403, {"error": "Only admins can build game decks.", "code": "forbidden"}
                n = int(body.get("count", 6))
                avoid = {str(a).lower() for a in body.get("avoid", [])}
                start = len(avoid)
                return 200, {"pairs": [{"k": f"Deck term {start + i + 1}", "v": f"Plain-English meaning number {start + i + 1}, with the code section."} for i in range(n)]}
            if k == "lesson_quiz":
                return 200, {"quiz": [{"q": "Sample quiz question?", "c": ["A", "B", "C", "D"], "a": 0, "why": "Because."}]}
            if k == "community_answer":
                reply = {"id": str(uuid.uuid4()), "post_id": body.get("post_id"), "user_id": None, "display_name": "AI Bro", "body": "The Tennessee BC-A exam and the Business & Law exam are separate. Confirm counts in the PSI bulletin.", "is_ai": True, "is_staff": False, "created_at": now_iso()}
                self.db["community_replies"].append(reply)
                return 200, {"reply": reply}
            if k == "exam":
                if not self.paid():
                    return 402, {"error": "AI exams are part of Pro.", "code": "upgrade_required"}
                return 200, {"questions": []}
            if k == "plan":
                return 200, {"text": "Week 1: Business & Law basics."}
            if k == "pairs":
                return 200, {"pairs": [{"t": "gc", "k": "Retainage", "v": "Portion of payments held until completion", "ai": True}, {"t": "gc", "k": "Lien waiver", "v": "Gives up lien rights for a payment", "ai": True}, {"t": "gc", "k": "Change order", "v": "Written change to scope, price or time", "ai": True}]}
            if k == "health":
                if not self.is_admin():
                    return 403, {"error": "Only admins can run the setup check.", "code": "forbidden"}
                return 200, {"ai": True, "stripe": True, "stripe_live": False, "stripe_webhook": True, "livekit": False, "ipinfo": False, "site_url": "http://localhost:8833", "model": "claude-sonnet-5-5"}
            if k == "delete_account":
                return 200, {"deleted": True}
            return 400, {"error": "Unknown request.", "code": "bad_request"}
        if name == "tutor":
            return 200, "In Tennessee, a guardrail top rail sits at 42 inches, plus or minus 3 inches, above the walking surface (29 CFR 1926.502(b)(1)).\n\nTry this: What is the midrail height?\nAnswer: About 21 inches.\n\nSources:\n- OSHA 1926.502 — https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.502"
        return 404, {"error": "Unknown function", "code": "not_found"}

    # ------------------------------------------------------------------ Auth
    def auth(self, method, path, body):
        if path.startswith("settings"):
            return 200, {"external": {"email": True, "phone": False}, "disable_signup": False, "mailer_autoconfirm": False, "phone_autoconfirm": False}
        if path.startswith("user"):
            if not self.user_id:
                return 401, {"message": "not signed in"}
            u = USERS[self.user_id]
            return 200, self.user_obj()
        if path.startswith("token"):
            email = (body or {}).get("email")
            uid = next((k for k, v in USERS.items() if v["email"] == email), None)
            if not uid:
                return 400, {"error": "invalid_grant", "error_description": "Invalid login credentials"}
            self.user_id = uid
            return 200, self.session_obj()
        if path.startswith("signup"):
            if "blocked" in str((body or {}).get("email", "")):
                return 400, {"code": 400, "error_code": "email_address_not_authorized", "msg": "Email address not authorized: blocked@example.com"}
            return 200, {"user": {"id": str(uuid.uuid4()), "email": (body or {}).get("email")}, "session": None}
        if path.startswith("logout"):
            self.user_id = None
            return 204, None
        if path.startswith("otp") or path.startswith("verify") or path.startswith("recover"):
            return 200, self.session_obj() if path.startswith("verify") else {}
        return 200, {}

    def user_obj(self):
        u = USERS[self.user_id]
        return {"id": self.user_id, "aud": "authenticated", "role": "authenticated", "email": u["email"], "app_metadata": {}, "user_metadata": {"full_name": u["name"]}, "created_at": now_iso(-9000)}

    def session_obj(self):
        return {"access_token": "test-token", "token_type": "bearer", "expires_in": 3600, "expires_at": int(time.time()) + 3600, "refresh_token": "test-refresh", "user": self.user_obj()}
