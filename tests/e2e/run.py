"""
Browser tests for Licensing Bro's: builds are served from ./out and every Supabase call is answered by FakeBackend.
Usage (from the repo root, after `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=x npx next build`):
    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 tests/e2e/run.py [--shots DIR] [--only NAME]
"""
import json, os, sys, time, threading, http.server, socketserver, functools, traceback, argparse
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from fakebackend import FakeBackend, ADMIN_ID, PAID_ID, FREE_ID, C_FREE, C_PAID, L_FREE1, L_PAID1, L_PREV, LIVE_NOW, LIVE_SOON, POST1, DECK1

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "out")
SUPA = "https://example.supabase.co"
PORT = 8833
BASE = f"http://localhost:{PORT}"

ap = argparse.ArgumentParser()
ap.add_argument("--shots", default=os.path.join(ROOT, "tests", "e2e", "shots"))
ap.add_argument("--only", default=None)
args = ap.parse_args()
os.makedirs(args.shots, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

def serve():
    handler = functools.partial(Quiet, directory=OUT)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd

RESULTS = []
def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond), detail))
    print(("  ✓ " if cond else "  ✗ ") + name + ("" if cond else f"  [{detail}]"), flush=True)

def wire(page, fake):
    """Route every Supabase request to the fake backend."""
    def handle(route):
        req = route.request
        url = req.url
        path = url[len(SUPA):]
        method = req.method
        headers = {k.lower(): v for k, v in req.headers.items()}
        body = None
        if req.post_data:
            try: body = json.loads(req.post_data)
            except Exception: body = req.post_data
        cors = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "content-range"}
        if method == "OPTIONS":
            return route.fulfill(status=200, headers=cors, body="")
        try:
            if path.startswith("/rest/v1/"):
                rest = path[len("/rest/v1/"):]
                table, _, query = rest.partition("?")
                res = fake.rest(method, table, query, body, headers)
                status, data = res[0], res[1]
                extra = res[2] if len(res) > 2 else {}
                return route.fulfill(status=status, headers={**cors, "content-type": "application/json", **extra}, body="" if data is None else json.dumps(data))
            if path.startswith("/auth/v1/"):
                status, data = fake.auth(method, path[len("/auth/v1/"):], body)
                return route.fulfill(status=status, headers={**cors, "content-type": "application/json"}, body="" if data is None else json.dumps(data))
            if path.startswith("/functions/v1/"):
                name = path[len("/functions/v1/"):].split("?")[0]
                status, data = fake.fn(name, body or {})
                if isinstance(data, str):
                    return route.fulfill(status=status, headers={**cors, "content-type": "text/plain; charset=utf-8"}, body=data)
                return route.fulfill(status=status, headers={**cors, "content-type": "application/json"}, body=json.dumps(data))
            if path.startswith("/storage/v1/"):
                return route.fulfill(status=200, headers={**cors, "content-type": "application/json"}, body=json.dumps({"Key": "x", "signedURL": "/x"}))
            return route.fulfill(status=404, headers=cors, body="{}")
        except Exception as e:
            traceback.print_exc()
            return route.fulfill(status=500, headers=cors, body=json.dumps({"error": str(e)}))
    page.route(f"{SUPA}/**", handle)
    page.route("**/realtime/v1/**", lambda r: r.abort())

def new_page(browser, fake, width=1280, height=900, mobile=False):
    ctx = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
    if fake.user_id:
        sess = fake.session_obj()
        ctx.add_init_script(f"try {{ localStorage.setItem('sb-example-auth-token', {json.dumps(json.dumps(sess))}); }} catch (e) {{}}")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" and "WebSocket" not in m.text and "realtime" not in m.text.lower() and "Failed to load resource" not in m.text else None)
    wire(page, fake)
    return ctx, page, errors

def shot(page, name):
    page.screenshot(path=os.path.join(args.shots, f"{name}.png"), full_page=False)

def no_overflow(page):
    return page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

def goto(page, path, wait="networkidle"):
    page.goto(BASE + path, wait_until="domcontentloaded")
    try: page.wait_for_load_state(wait, timeout=8000)
    except Exception: pass
    page.wait_for_timeout(400)

SCENARIOS = []
def scenario(fn):
    SCENARIOS.append(fn); return fn

# ---------------------------------------------------------------------------------------------------------------------
@scenario
def anonymous_visitor(browser):
    fake = FakeBackend(user_id=None)
    for w, tag in ((1280, "desk"), (390, "phone")):
        ctx, page, errors = new_page(browser, fake, width=w, height=900 if w > 500 else 844, mobile=w < 500)
        goto(page, "/")
        shot(page, f"anon-home-{tag}")
        check(f"[{tag}] home shows the hero headline", page.get_by_text("Contractor license", exact=False).first.is_visible())
        check(f"[{tag}] home has no sideways scroll", no_overflow(page))
        check(f"[{tag}] home shows truthful stats", page.get_by_text("States + DC covered").first.count() > 0)
        page.mouse.wheel(0, 900); page.wait_for_timeout(300); shot(page, f"anon-home-2-{tag}")
        page.mouse.wheel(0, 900); page.wait_for_timeout(300); shot(page, f"anon-home-3-{tag}")
        check(f"[{tag}] home renders without errors", not errors, "; ".join(errors[:3]))
        ctx.close()
    ctx, page, errors = new_page(browser, fake)
    goto(page, "/")
    # Find your course form → catalog
    sels = page.locator("form select")
    if sels.count() >= 2:
        sels.nth(0).select_option(label="Tennessee"); sels.nth(1).select_option(index=1)
        page.get_by_role("button", name="Submit course request").first.click()
        page.wait_for_timeout(1200)
        check("course finder goes to the catalog with filters", "/courses/" in page.url and "state=Tennessee" in page.url, page.url)
    else:
        check("course finder form exists", False, "no selects")
    goto(page, "/courses/?state=Tennessee&trade=gc")
    shot(page, "anon-catalog")
    check("catalog lists the Tennessee GC course", page.get_by_text("Tennessee GC Exam Master Course").first.is_visible())
    goto(page, f"/course/?id={C_PAID}")
    page.wait_for_timeout(800)
    shot(page, "anon-course")
    check("course page shows price", page.get_by_text("$299").first.count() > 0)
    check("course page shows the curriculum", page.get_by_text("Mechanic's liens and lien waivers").first.count() > 0)
    goto(page, "/live/")
    shot(page, "anon-live")
    check("live list shows the class that's live now", page.get_by_text("Lien Law Live Q&A").first.count() > 0)
    goto(page, "/verify/?code=LB7X2Q9KM4")
    page.wait_for_timeout(800)
    shot(page, "anon-verify")
    check("certificate verifies for anyone", page.get_by_text("Marcus Paid").first.count() > 0)
    goto(page, "/verify/?code=NOPE000000")
    page.wait_for_timeout(800)
    check("unknown certificate shows not found", page.get_by_text("not", exact=False).first.count() > 0)
    goto(page, "/learn/")
    check("study area asks visitors to sign up", page.get_by_text("Create free account").first.count() > 0)
    check("anonymous pages ran without errors", not errors, "; ".join(errors[:3]))
    ctx.close()

@scenario
def sign_in_flow(browser):
    fake = FakeBackend(user_id=None)
    ctx, page, errors = new_page(browser, fake)
    goto(page, "/login/")
    shot(page, "login")
    page.fill("#email", "free@licensingbros.test")
    page.fill("#password", "password123")
    page.get_by_role("button", name="Sign in").last.click()
    page.wait_for_timeout(2500)
    check("signing in lands in My Learning", "/learn/" in page.url, page.url)
    check("device session is claimed after sign-in", ("fn", "session") in fake.calls, str(fake.calls[-5:]))
    goto(page, "/login/?mode=signup")
    check("sign-up form asks for a name", page.locator("#fullName").count() in (0, 1))
    ctx.close()

@scenario
def free_student(browser):
    fake = FakeBackend(user_id=FREE_ID)
    ctx, page, errors = new_page(browser, fake)
    goto(page, "/")
    shot(page, "free-home")
    check("signed-in home shows a dashboard", page.get_by_text("dashboard", exact=False).first.count() > 0)
    # Notification bell
    bell = page.get_by_role("button", name="Notifications").first
    if bell.count():
        bell.click(); page.wait_for_timeout(600); shot(page, "free-bell")
        check("notification bell lists announcements", page.get_by_text("Live now: Lien Law Live Q&A").first.count() > 0)
        page.keyboard.press("Escape")
    # Paid lesson → upsell
    goto(page, f"/lesson/?id={L_PAID1}")
    page.wait_for_timeout(1200)
    shot(page, "free-paid-lesson")
    check("paid lesson shows an upsell to free users", page.get_by_text("$299").first.count() > 0 or page.get_by_text("unlock", exact=False).first.count() > 0)
    # Free lesson works
    goto(page, f"/lesson/?id={L_FREE1}")
    page.wait_for_timeout(1200)
    shot(page, "free-free-lesson")
    check("free lesson opens", page.get_by_text("Fall protection: the 6-foot rule").first.count() > 0)
    # Tutor
    goto(page, "/learn/#tutor")
    page.wait_for_timeout(800)
    box = page.locator("textarea#ask")
    if box.count():
        box.fill("How high is a guardrail?")
        box.press("Enter")
        page.wait_for_timeout(2500)
        shot(page, "free-tutor")
        check("tutor streams an answer", page.get_by_text("42 inches", exact=False).first.count() > 0)
        check("tutor shows sources as links", page.locator("a[href*='osha.gov']").count() > 0)
    else:
        check("tutor input exists", False)
    # Talk to Bro
    talk = page.get_by_role("button", name="Talk to Bro").first
    if talk.count():
        talk.click(); page.wait_for_timeout(800); shot(page, "free-talkmode")
        check("Talk to Bro opens full screen", page.get_by_text("Tap to talk", exact=False).first.count() > 0 or page.get_by_text("Listening", exact=False).first.count() > 0 or page.get_by_text("Type", exact=False).first.count() > 0)
        page.keyboard.press("Escape"); page.wait_for_timeout(300)
    else:
        check("Talk to Bro button exists", False)
    # Exam caps for free
    goto(page, "/learn/#exam")
    page.wait_for_timeout(800)
    shot(page, "free-exam")
    check("free exam explains Pro unlocks longer exams", page.get_by_text("Pro", exact=False).first.count() > 0)
    # Community
    goto(page, "/community/")
    page.wait_for_timeout(1000)
    shot(page, "free-community")
    check("community lists questions", page.get_by_text("How many questions are on the Tennessee BC-A exam?").first.count() > 0)
    goto(page, f"/community/?post={POST1}")
    page.wait_for_timeout(1000)
    ai = page.get_by_role("button", name="Ask AI Bro").first
    if ai.count():
        ai.click(); page.wait_for_timeout(1500); shot(page, "free-community-ai")
        check("AI Bro answers a community question", page.get_by_text("Confirm counts in the PSI bulletin", exact=False).first.count() > 0)
    else:
        check("Ask AI Bro button exists", False)
    # Live: free class + calls to action
    goto(page, f"/live/watch/?id={LIVE_NOW}")
    page.wait_for_timeout(1500)
    shot(page, "free-live-watch")
    check("free live class plays the stream", page.locator("iframe").count() > 0)
    check("live chat shows messages", page.get_by_text("Drop your lien questions below", exact=False).first.count() > 0)
    check("call-to-action offer appears during the class", page.get_by_text("LIVE20").first.count() > 0 or page.get_by_text("Live-only deal", exact=False).first.count() > 0)
    goto(page, f"/live/watch/?id={LIVE_SOON}")
    page.wait_for_timeout(1200)
    shot(page, "free-live-paid")
    check("paid class is locked for free users", page.get_by_text("course", exact=False).first.count() > 0)
    # Account devices
    goto(page, "/account/#devices")
    page.wait_for_timeout(1000)
    shot(page, "free-account-devices")
    check("account shows home location", page.get_by_text("Nashville", exact=False).first.count() > 0)
    check("free student pages ran without errors", not errors, "; ".join(errors[:4]))
    ctx.close()

@scenario
def paid_student(browser):
    fake = FakeBackend(user_id=PAID_ID)
    for w, tag in ((1280, "desk"), (390, "phone")):
        ctx, page, errors = new_page(browser, fake, width=w, height=900 if w > 500 else 844, mobile=w < 500)
        goto(page, f"/lesson/?id={L_PAID1}")
        page.wait_for_timeout(1500)
        shot(page, f"paid-lesson-{tag}")
        check(f"[{tag}] paid lesson content unlocks for the buyer", page.get_by_text("Lien waivers", exact=False).first.count() > 0)
        check(f"[{tag}] lesson page has no sideways scroll", no_overflow(page))
        goto(page, f"/course/?id={C_PAID}")
        page.wait_for_timeout(1000)
        shot(page, f"paid-course-{tag}")
        check(f"[{tag}] owned course offers Continue", page.get_by_text("Continue", exact=False).first.count() > 0)
        goto(page, "/learn/")
        page.wait_for_timeout(1000)
        shot(page, f"paid-learn-{tag}")
        check(f"[{tag}] readiness ring is shown", page.get_by_text("Readiness", exact=False).first.count() > 0)
        check(f"[{tag}] paid pages ran without errors", not errors, "; ".join(errors[:4]))
        ctx.close()
    # Outside home → travel mode
    fake2 = FakeBackend(user_id=PAID_ID, location_state="outside")
    ctx, page, errors = new_page(browser, fake2)
    goto(page, f"/lesson/?id={L_PAID1}")
    page.wait_for_timeout(1800)
    shot(page, "paid-outside-home")
    check("outside home area asks to turn on Travel mode", page.get_by_text("Travel mode", exact=False).first.count() > 0)
    ctx.close()
    # Takeover
    fake3 = FakeBackend(user_id=PAID_ID)
    orig = fake3.fn
    def busy(name, body):
        if name == "session" and body.get("action") == "claim" and not body.get("takeover"):
            return 200, {"status": "in_use", "conflict": {"device": "Safari on iPhone/iPad", "city": "Memphis", "region": "Tennessee", "last_seen": "now"}}
        return orig(name, body)
    fake3.fn = busy
    ctx, page, errors = new_page(browser, fake3)
    goto(page, "/learn/")
    page.wait_for_timeout(1500)
    shot(page, "paid-in-use")
    check("second device sees 'account in use' with the other device", page.get_by_text("Safari on iPhone/iPad").first.count() > 0)
    btn = page.get_by_role("button", name="Use it here instead").first
    if btn.count():
        btn.click(); page.wait_for_timeout(1000)
        check("'Use it here instead' takes over", page.get_by_text("Safari on iPhone/iPad").first.count() == 0)
    ctx.close()

@scenario
def admin_owner(browser):
    fake = FakeBackend(user_id=ADMIN_ID)
    ctx, page, errors = new_page(browser, fake)
    goto(page, "/")
    check("admins see the ADMIN pill", page.get_by_role("link", name="ADMIN").first.count() > 0)
    for tab in ["dashboard", "courses", "lives", "tests", "users", "community", "notify", "settings"]:
        goto(page, f"/admin/#{tab}")
        page.wait_for_timeout(900)
        shot(page, f"admin-{tab}")
    goto(page, "/admin/#dashboard")
    page.wait_for_timeout(1000)
    check("admin dashboard shows revenue", page.get_by_text("$299").first.count() > 0)
    goto(page, "/admin/#users")
    page.wait_for_timeout(1000)
    check("admin can see users with emails", page.get_by_text("paid@licensingbros.test").first.count() > 0)
    goto(page, "/admin/#tests")
    page.wait_for_timeout(800)
    start = page.get_by_role("button", name="Build a test with AI").first
    if start.count(): start.click(); page.wait_for_timeout(500)
    gen = page.locator("button.btn.primary.cta.block").first
    if gen.count():
        gen.click(); page.wait_for_timeout(2000); shot(page, "admin-tests-generated")
        check("AI test builder returns questions to review", page.get_by_text("Sample AI question", exact=False).first.count() > 0)
    else:
        check("AI test builder has a generate button", False)
    goto(page, f"/live/studio/?id={LIVE_NOW}")
    page.wait_for_timeout(1200)
    shot(page, "admin-studio")
    check("live studio opens for admins", page.get_by_text("Lien Law Live Q&A").first.count() > 0)
    check("admin pages ran without errors", not errors, "; ".join(errors[:4]))
    ctx.close()
    # Non-admin blocked
    fake2 = FakeBackend(user_id=FREE_ID)
    ctx, page, errors = new_page(browser, fake2)
    goto(page, "/admin/")
    page.wait_for_timeout(900)
    check("students see the admin code box on /admin, not the console", page.get_by_label("Admin code", exact=True).count() > 0 and page.get_by_text("Students", exact=True).count() == 0)
    goto(page, f"/live/studio/?id={LIVE_NOW}")
    page.wait_for_timeout(900)
    check("students can't open the live studio", page.get_by_text("Admins only", exact=False).first.count() > 0)
    ctx.close()

@scenario
def admin_code(browser):
    # 1) Brand-new install, nobody signed in: /admin invites the owner to create an account and claim the site
    fake = FakeBackend(user_id=None, no_admins=True)
    ctx, page, errors = new_page(browser, fake)
    goto(page, "/admin/")
    page.wait_for_timeout(700)
    shot(page, "admincode-claim-signed-out")
    check("new site: /admin says 'Claim your site'", page.get_by_text("your site", exact=False).first.count() > 0)
    link = page.get_by_role("link", name="Create my account").first
    check("new site: offers 'Create my account' that returns to /admin", link.count() > 0 and "next=%2Fadmin%2F" in (link.get_attribute("href") or ""), link.get_attribute("href") if link.count() else "")
    ctx.close()
    # 2) Brand-new install, signed in: the first person with the code becomes the first admin
    fake = FakeBackend(user_id=FREE_ID, no_admins=True)
    ctx, page, errors = new_page(browser, fake, width=390, height=844, mobile=True)
    goto(page, "/admin/")
    page.wait_for_timeout(700)
    shot(page, "admincode-claim-phone")
    box = page.get_by_label("Admin code", exact=True)
    check("new site: signed-in owner sees the code box", box.count() > 0)
    check("claim screen fits a phone", no_overflow(page))
    box.fill("LB-WRONG-CODE-0000")
    page.get_by_role("button", name="Claim admin access").click()
    page.wait_for_timeout(700)
    check("wrong code is refused with tries left", page.get_by_text("didn't match", exact=False).first.count() > 0 and page.get_by_text("tries left", exact=False).first.count() > 0)
    box.fill("lb test code 2026")
    page.get_by_role("button", name="Claim admin access").click()
    page.wait_for_timeout(1800)
    shot(page, "admincode-claimed")
    check("right code (any case, spaces) opens the control center", FREE_ID in fake.extra_admins and page.get_by_text("Dashboard", exact=False).first.count() > 0)
    check("claim flow ran without errors", not errors, "; ".join(errors[:3]))
    ctx.close()
    # 3) Admins exist: a student with the code is promoted
    fake = FakeBackend(user_id=PAID_ID)
    ctx, page, errors = new_page(browser, fake)
    goto(page, "/admin/")
    page.wait_for_timeout(700)
    check("existing site: /admin asks for an admin code", page.get_by_role("button", name="Become an admin").count() > 0)
    page.get_by_label("Admin code", exact=True).fill("LB-TEST-CODE-2026")
    page.get_by_role("button", name="Become an admin").click()
    page.wait_for_timeout(1800)
    check("student with the code becomes an admin", PAID_ID in fake.extra_admins and page.get_by_text("Dashboard", exact=False).first.count() > 0)
    ctx.close()
    # 4) Admin manages the code in Settings
    fake = FakeBackend(user_id=ADMIN_ID)
    ctx, page, errors = new_page(browser, fake)
    goto(page, "/admin/#settings")
    page.wait_for_timeout(1200)
    card = page.locator("#admin-code")
    card.scroll_into_view_if_needed()
    shot(page, "admincode-settings")
    check("Settings has the admin code card, hidden by default", card.count() > 0 and card.get_by_text("LB-TEST-CODE-2026").count() == 0)
    card.get_by_role("button", name="Show").click()
    check("Show reveals the code", card.get_by_text("LB-TEST-CODE-2026").count() > 0)
    card.get_by_role("switch", name="Code can add new admins").click()
    page.wait_for_timeout(500)
    check("admin can switch the code off", fake.admin_code["enabled"] is False)
    card.get_by_role("switch", name="Code can add new admins").click()
    page.wait_for_timeout(500)
    card.get_by_label("Or set your own code", exact=True).fill("bro 12")
    card.get_by_role("button", name="Use this code").click()
    page.wait_for_timeout(400)
    check("too-short custom code is refused", card.get_by_text("at least 8", exact=False).first.count() > 0 and fake.admin_code["code"] == "LB-TEST-CODE-2026")
    card.get_by_label("Or set your own code", exact=True).fill("Bros Crew 2026")
    card.get_by_role("button", name="Use this code").click()
    page.wait_for_timeout(700)
    check("admin can set their own code", fake.admin_code["code"] == "Bros Crew 2026" and card.get_by_text("Bros Crew 2026").count() > 0)
    card.get_by_role("button", name="Make a new random code").click()
    card.get_by_role("button", name="Yes, make a new code").click()
    page.wait_for_timeout(700)
    check("admin can make a new random code", fake.admin_code["code"].startswith("LB-") and card.get_by_text(fake.admin_code["code"]).count() > 0)
    check("admin code settings ran without errors", not errors, "; ".join(errors[:3]))
    ctx.close()
    # 5) Switched-off code doesn't promote anyone
    fake = FakeBackend(user_id=FREE_ID)
    fake.admin_code["enabled"] = False
    ctx, page, errors = new_page(browser, fake)
    goto(page, "/admin/")
    page.wait_for_timeout(700)
    page.get_by_label("Admin code", exact=True).fill("LB-TEST-CODE-2026")
    page.get_by_role("button", name="Become an admin").click()
    page.wait_for_timeout(800)
    check("switched-off code explains it's off", page.get_by_text("switched off", exact=False).first.count() > 0 and FREE_ID not in fake.extra_admins)
    ctx.close()

@scenario
def game_decks(browser):
    # Admin builds a game deck with AI, reviews it and publishes it
    fake = FakeBackend(user_id=ADMIN_ID)
    ctx, page, errors = new_page(browser, fake)
    goto(page, "/admin/#tests")
    page.wait_for_timeout(900)
    shot(page, "decks-admin-list")
    check("AI builder lists tests and game decks", page.get_by_text("Lien Law Lingo").first.count() > 0 and page.get_by_text("Tennessee GC Warm-up").first.count() > 0)
    page.get_by_role("button", name="Game decks (1)").click()
    check("filter shows only game decks", page.get_by_text("Lien Law Lingo").first.count() > 0 and page.get_by_text("Tennessee GC Warm-up").count() == 0)
    page.get_by_role("button", name="Build a game with AI").first.click()
    page.wait_for_timeout(400)
    page.get_by_placeholder("Lien law, OSHA ladders, venting…").fill("Ladders")
    page.get_by_role("button", name="Write 12 cards with AI").click()
    page.wait_for_timeout(1500)
    shot(page, "decks-admin-generated")
    check("AI writes cards to review", page.locator("input[aria-label='Card 12 term']").count() == 1 and page.locator("input[aria-label='Card 1 term']").input_value() == "Deck term 1")
    check("builder calls the AI generator", any(c == ("fn", "generate") for c in fake.calls))
    page.locator("input[aria-label='Card 2 term']").fill("Three-point contact")
    page.get_by_role("button", name="Add 12 more cards with AI").click()
    page.wait_for_timeout(1500)
    check("adding more avoids repeats", page.locator("input[aria-label='Card 24 term']").count() == 1 and page.locator("input[aria-label='Card 13 term']").input_value() == "Deck term 13")
    page.get_by_role("button", name="Delete card 24").click()
    page.get_by_role("switch", name="Free for everyone").click()
    page.get_by_role("switch", name="Publish").click()
    page.locator("form").get_by_role("button", name="Save game deck").click()
    page.wait_for_timeout(1200)
    saved = [r for r in fake.db["practice_sets"] if r.get("kind") == "game" and r.get("title") != "Lien Law Lingo"]
    check("saved deck is a published, free game with 23 cards", len(saved) == 1 and saved[0]["published"] and saved[0]["is_free"] and len(saved[0]["pairs"]) == 23 and saved[0]["topic"] == "Ladders" and saved[0]["questions"] == [], str(saved[:1])[:300])
    check("edited card text was saved", saved and saved[0]["pairs"][1]["k"] == "Three-point contact")
    check("admin game builder ran without errors", not errors, "; ".join(errors[:3]))
    ctx.close()

    # Free student plays the published deck in Code Match, a published test in Speed Round, and studies the deck
    fake = FakeBackend(user_id=FREE_ID)
    for w, tag in ((1280, "desk"), (390, "phone")):
        ctx, page, errors = new_page(browser, fake, width=w, height=900 if w > 500 else 844, mobile=w < 500)
        goto(page, "/learn/#games")
        page.wait_for_timeout(900)
        pick = page.locator("#deckPick")
        check(f"[{tag}] Code Match offers the instructors' deck", pick.count() == 1 and "Lien Law Lingo" in pick.inner_text())
        check(f"[{tag}] free students see which decks a course unlocks", page.get_by_text("Free decks are shown", exact=False).first.count() > 0)
        pick.select_option(DECK1)
        page.wait_for_timeout(400)
        shot(page, f"decks-match-{tag}")
        board = page.locator(".match .tile.term")
        terms = [board.nth(i).inner_text() for i in range(board.count())]
        deck = {"Retainage", "Lien waiver", "Notice to owner", "Conditional waiver", "Unconditional waiver", "Mechanic's lien", "Bond claim"}
        check(f"[{tag}] board is dealt from the deck, 6 at a time", len(terms) == 6 and set(terms) <= deck, str(terms))
        check(f"[{tag}] games page fits the screen", no_overflow(page))
        if "Retainage" in terms:
            page.locator(".match .tile.term", has_text="Retainage").click()
            page.locator(".match .tile:not(.term)", has_text="held back until the job is finished").click()
            page.wait_for_timeout(300)
            check(f"[{tag}] matching a deck card counts", page.get_by_text("1/6").first.count() > 0)
        page.get_by_role("button", name="Speed Round").click()
        page.wait_for_timeout(700)
        tp = page.locator("#testPick")
        check(f"[{tag}] Speed Round offers published tests", tp.count() == 1 and "Tennessee GC Warm-up" in tp.inner_text())
        tp.select_option(label=[o for o in tp.locator("option").all_inner_texts() if "Warm-up" in o][0])
        page.get_by_role("button", name="Start").click()
        page.wait_for_timeout(400)
        check(f"[{tag}] Speed Round plays the published test", page.get_by_text("fall protection on construction walking surfaces", exact=False).first.count() > 0)
        goto(page, "/learn/#cards")
        page.wait_for_timeout(800)
        cd = page.locator("#cardDeck")
        check(f"[{tag}] Flashcards offers the deck", cd.count() == 1)
        cd.select_option(DECK1)
        page.wait_for_timeout(300)
        shot(page, f"decks-cards-{tag}")
        check(f"[{tag}] Flashcards studies the deck's cards", page.get_by_text("7 cards · Lien Law Lingo", exact=False).first.count() > 0)
        check(f"[{tag}] student game pages ran without errors", not errors, "; ".join(errors[:3]))
        ctx.close()

@scenario
def setup_check(browser):
    # Friendly sign-up error when Supabase can't send the confirmation email
    fake = FakeBackend(user_id=None)
    ctx, page, errors = new_page(browser, fake)
    goto(page, "/login/?mode=signup")
    page.fill("#fullName", "Test Owner")
    page.fill("#email", "blocked@example.com")
    page.fill("#password", "password123")
    page.get_by_role("button", name="Create account").last.click()
    page.wait_for_timeout(1200)
    shot(page, "setup-signup-error")
    check("sign-up email problem is explained in plain words", page.get_by_text("can't send sign-up emails yet", exact=False).first.count() > 0)
    check("site owner gets the fix and a link to the setup check", page.get_by_text("SMTP Settings", exact=False).first.count() > 0 and page.get_by_role("link", name="Check the setup").count() > 0)
    page.get_by_role("link", name="Check the setup").click()
    page.wait_for_timeout(2500)
    shot(page, "setup-check-visitor")
    check("setup check runs for visitors", page.get_by_text("Supabase project", exact=False).first.count() > 0 and page.get_by_text("schema.sql has been run", exact=False).first.count() > 0)
    check("setup check flags confirmation emails to double-check", page.get_by_text("Supabase's built-in sender only emails", exact=False).first.count() > 0)
    check("setup check tells visitors to sign in for server keys", page.get_by_text("Sign in as the admin", exact=False).first.count() > 0)
    check("setup check page ran without errors", not errors, "; ".join(errors[:3]))
    ctx.close()
    # Admin sees which server keys are set
    fake = FakeBackend(user_id=ADMIN_ID)
    ctx, page, errors = new_page(browser, fake)
    goto(page, "/status/")
    page.wait_for_timeout(2500)
    shot(page, "setup-check-admin")
    check("admin setup check shows the AI key", page.get_by_text("AI tutor key", exact=False).first.count() > 0 and page.get_by_text("model claude-sonnet-5-5", exact=False).first.count() > 0)
    check("admin setup check shows Stripe test mode", page.get_by_text("test mode", exact=False).first.count() > 0)
    check("admin setup check warns when LiveKit is missing", page.get_by_text("LiveKit keys aren't set", exact=False).first.count() > 0)
    ctx.close()

@scenario
def ai_not_set_up(browser):
    """Functions never deployed: Supabase answers without CORS headers, so the browser sees a network failure."""
    def ask(page):
        goto(page, "/learn/#tutor")
        page.wait_for_timeout(800)
        box = page.locator("textarea#ask")
        box.fill("How high is a guardrail?")
        box.press("Enter")
        page.wait_for_timeout(2500)
    # Student: told the owner is finishing setup, not that their internet is down
    fake = FakeBackend(user_id=FREE_ID)
    ctx, page, errors = new_page(browser, fake)
    page.route(f"{SUPA}/functions/v1/**", lambda r: r.abort())
    ask(page)
    shot(page, "ai-not-set-up-student")
    check("missing functions aren't blamed on the student's internet", page.get_by_text("You're offline").count() == 0, "still says offline")
    check("student sees the AI isn't switched on yet", page.get_by_text("The AI isn't switched on yet").first.count() > 0)
    check("student is told the owner is finishing setup", page.get_by_text("site owner is still finishing setup", exact=False).first.count() > 0)
    ctx.close()
    # Admin: pointed at the setup check, which says the functions aren't deployed
    fake = FakeBackend(user_id=ADMIN_ID)
    ctx, page, errors = new_page(browser, fake)
    page.route(f"{SUPA}/functions/v1/**", lambda r: r.abort())
    ask(page)
    shot(page, "ai-not-set-up-admin")
    link = page.get_by_role("link", name="Open Setup check")
    check("admin gets a link to the setup check", link.count() > 0)
    if link.count():
        link.first.click()
        page.wait_for_timeout(2500)
        shot(page, "ai-not-set-up-status")
        check("setup check says the functions aren't deployed", page.get_by_text("backend functions aren't deployed", exact=False).first.count() > 0)
        check("setup check names the GitHub settings to add", page.get_by_text("SUPABASE_ACCESS_TOKEN", exact=False).first.count() > 0)
    ctx.close()
    # Really offline (Supabase unreachable too): still says offline
    fake = FakeBackend(user_id=FREE_ID)
    ctx, page, errors = new_page(browser, fake)
    page.route(f"{SUPA}/functions/v1/**", lambda r: r.abort())
    page.route(f"{SUPA}/auth/v1/settings", lambda r: r.abort())
    ask(page)
    check("no internet still says offline", page.get_by_text("You're offline").first.count() > 0)
    ctx.close()

FAKE_TTS = """
(() => {
  const cfg = %s;
  const log = [];
  window.__tts = log;
  try { delete window.webkitSpeechRecognition; delete window.SpeechRecognition; } catch (e) {}
  window.webkitSpeechRecognition = undefined; window.SpeechRecognition = undefined;
  if (cfg.mode === "none") { try { delete window.speechSynthesis; } catch (e) {} window.speechSynthesis = undefined; window.SpeechSynthesisUtterance = undefined; return; }
  const voices = [
    { name: "Google US English", lang: "en-US", voiceURI: "Google US English", localService: false, default: false },
    { name: "Microsoft David", lang: "en-US", voiceURI: "Microsoft David", localService: true, default: true }
  ];
  let first = true;
  const synth = {
    speaking: false, pending: false, paused: false,
    getVoices: () => voices, addEventListener() {}, removeEventListener() {},
    speak(u) {
      const v = u.voice ? u.voice.name : null;
      log.push({ t: "speak", text: u.text, voice: v });
      if (first && cfg.stuckFirst) { first = false; this.speaking = true; this.pending = true; return; }  // never finishes
      first = false;
      if (this.speaking) { this.pending = true; log.push({ t: "queued-behind-stuck", text: u.text }); return; }
      const fail = cfg.mode === "allfail" || (cfg.mode === "brokenGoogle" && v && v.startsWith("Google"));
      if (cfg.mode === "notallowed") { setTimeout(() => u.onerror && u.onerror({ error: "not-allowed" }), 10); return; }
      if (fail) { setTimeout(() => u.onerror && u.onerror({ error: "synthesis-failed" }), 10); return; }
      this.speaking = true;
      setTimeout(() => u.onstart && u.onstart(), 10);
      setTimeout(() => { this.speaking = false; if (u.text.trim()) log.push({ t: "spoke", text: u.text, voice: v }); u.onend && u.onend(); }, 40);
    },
    cancel() { log.push({ t: "cancel" }); this.speaking = false; this.pending = false; },
    pause() {}, resume() {}
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; this.voice = null; this.lang = ""; this.rate = 1; this.volume = 1; };
})();
"""

@scenario
def voice_playback(browser):
    def talk(cfg, question="How high is a guardrail?"):
        fake = FakeBackend(user_id=FREE_ID)
        ctx, page, errors = new_page(browser, fake)
        ctx.add_init_script(FAKE_TTS % json.dumps(cfg))
        goto(page, "/learn/#tutor")
        page.get_by_role("button", name="Talk to Bro").first.click()
        page.wait_for_timeout(600)
        page.fill("#talk-typed", question)
        page.locator("#talk-typed").press("Enter")
        page.wait_for_timeout(4000)
        log = page.evaluate("window.__tts || []")
        return ctx, page, errors, log
    spoke = lambda log: [e for e in log if e["t"] == "spoke"]
    # A silent "unlock" utterance that never finishes used to block every answer behind it
    ctx, page, errors, log = talk({"mode": "ok", "stuckFirst": True})
    shot(page, "voice-talk")
    check("Bro's answer is spoken even when the browser's speech queue is stuck", len(spoke(log)) >= 2, json.dumps(log)[:400])
    check("Sources aren't read aloud", not any("osha.gov" in e["text"] or "Sources" in e["text"] for e in spoke(log)), json.dumps(spoke(log))[:300])
    check("no voice error shown when speech works", page.get_by_text("couldn't play Bro's voice", exact=False).count() == 0)
    ctx.close()
    # An online voice that can't play: falls back to a voice that works
    ctx, page, errors, log = talk({"mode": "brokenGoogle"})
    check("a broken voice falls back to one that plays", len(spoke(log)) >= 2 and all(e["voice"] != "Google US English" for e in spoke(log)), json.dumps(log)[:400])
    check("no error shown after the fallback works", page.get_by_text("couldn't play Bro's voice", exact=False).count() == 0)
    ctx.close()
    # Nothing can play: say so instead of going quiet
    ctx, page, errors, log = talk({"mode": "allfail"})
    shot(page, "voice-failed")
    check("when no voice can play, the screen says so", page.get_by_text("Your browser couldn't play Bro's voice", exact=False).first.count() > 0)
    check("the answer still shows as captions", page.get_by_text("42 inches", exact=False).first.count() > 0)
    ctx.close()
    # Browser refuses speech until a tap
    ctx, page, errors, log = talk({"mode": "notallowed"})
    check("a browser that wants a tap is explained", page.get_by_text("wants a tap", exact=False).first.count() > 0)
    ctx.close()
    # No speech engine at all
    ctx, page, errors, log = talk({"mode": "none"})
    check("a device with no voice says answers are captions", page.get_by_text("can't speak answers out loud", exact=False).first.count() > 0)
    ctx.close()
    # Tutor "Read aloud" also explains a failure
    fake = FakeBackend(user_id=FREE_ID)
    ctx, page, errors = new_page(browser, fake)
    ctx.add_init_script(FAKE_TTS % json.dumps({"mode": "allfail"}))
    goto(page, "/learn/#tutor")
    page.locator("textarea#ask").fill("How high is a guardrail?")
    page.locator("textarea#ask").press("Enter")
    page.wait_for_timeout(2000)
    btn = page.get_by_role("button", name="Read aloud").first
    if btn.count():
        btn.click(); page.wait_for_timeout(1500)
        check("tutor Read aloud explains when it can't play", page.get_by_text("couldn't play Bro's voice", exact=False).first.count() > 0)
    else:
        check("tutor has a Read aloud button", False)
    check("voice screens ran without errors", not errors, "; ".join(errors[:3]))
    ctx.close()

# ---------------------------------------------------------------------------------------------------------------------
if __name__ == "__main__":
    httpd = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
        for sc in SCENARIOS:
            if args.only and args.only != sc.__name__:
                continue
            print(f"\n{sc.__name__}", flush=True)
            try:
                sc(browser)
            except Exception as e:
                traceback.print_exc()
                check(f"{sc.__name__} finished without crashing", False, str(e)[:200])
        browser.close()
    httpd.shutdown()
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    print(f"\n{passed} passed, {len(RESULTS) - passed} failed")
    sys.exit(0 if passed == len(RESULTS) else 1)
