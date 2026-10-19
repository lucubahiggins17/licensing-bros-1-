"""
Android app build: the first launch shows a launch screen and swipeable onboarding instead of the website landing page,
the trade/state/exam date picked there carry into a new account, and signed-in students get an app home screen.
Build first with the app target:
    NEXT_PUBLIC_TARGET=app NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=x npx next build
then: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 tests/e2e/appbuild.py
"""
import os, sys, json, threading, functools, http.server, socketserver
from datetime import date, timedelta
sys.path.insert(0, os.path.dirname(__file__))
sys.argv = sys.argv[:1]  # the shared harness parses its own flags on import
import run as harness
from fakebackend import FakeBackend, PAID_ID
from playwright.sync_api import sync_playwright

PORT = 8835
BASE = f"http://localhost:{PORT}"
RESULTS = []
SHOTS = os.path.join(harness.ROOT, "tests", "e2e", "shots")

def check(name, cond, detail=""):
    RESULTS.append(bool(cond))
    print(("  ✓ " if cond else "  ✗ ") + name + ("" if cond else f"  [{detail}]"), flush=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def main():
    if not os.path.exists(os.path.join(harness.OUT, "_next")):
        print("Build ./out with NEXT_PUBLIC_TARGET=app first (see the top of this file)."); return 1
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=harness.OUT))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    os.makedirs(SHOTS, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()

        def phone(user=None, storage=None):
            fake = FakeBackend(user_id=user)
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
            if user:
                ctx.add_init_script(f"try {{ localStorage.setItem('sb-example-auth-token', {json.dumps(json.dumps(fake.session_obj()))}); }} catch (e) {{}}")
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)[:200]))
            page.on("console", lambda m: errors.append(m.text[:200]) if m.type == "error" and "Failed to load resource" not in m.text and "WebSocket" not in m.text and "realtime" not in m.text.lower() else None)
            harness.wire(page, fake)
            return ctx, page, fake, errors

        def go(page, path):
            page.goto(BASE + path, wait_until="domcontentloaded")
            try: page.wait_for_load_state("networkidle", timeout=8000)
            except Exception: pass
            page.wait_for_timeout(600)

        def overflow(page):
            return page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")

        # --- First launch: launch screen in the static HTML, then onboarding (no website hero) ---
        print("\nfirst launch")
        ctx, page, fake, errors = phone()
        page.goto(BASE + "/", wait_until="commit")
        html = page.content()
        check("the static page paints the launch screen before any script runs", "Loading Licensing Bro" in html or page.locator("[role=status][aria-label*='Loading']").count() > 0)
        go(page, "/")
        dlg = page.get_by_role("dialog", name="Welcome to Licensing Bro's")
        check("onboarding opens on first launch", dlg.count() == 1)
        check("no website landing hero behind it", page.locator("#hero-title").count() == 0)
        check("first slide sells the app", page.get_by_text("the first time", exact=False).first.is_visible())
        page.screenshot(path=os.path.join(SHOTS, "app-onboard-1.png"))
        page.get_by_role("button", name="Next").click(); page.wait_for_timeout(700)
        check("Next swipes to Meet Bro", page.get_by_role("region", name="Meet Bro").locator("h1").is_visible())
        page.screenshot(path=os.path.join(SHOTS, "app-onboard-2.png"))
        page.get_by_role("button", name="Back").click(); page.wait_for_timeout(700)
        check("Back returns to the first slide", page.evaluate("document.querySelector('[class*=track]').scrollLeft") < 20)
        page.get_by_role("button", name="Skip").click(); page.wait_for_timeout(800)
        cont = page.get_by_role("button", name="Pick your trade")
        check("setup asks for a trade before going on", cont.count() == 1 and cont.is_disabled())
        page.get_by_role("radio", name="Electrical").click()
        page.locator("select").select_option("California")
        exam = (date.today() + timedelta(days=45)).isoformat()
        page.locator("input[type=date]").fill(exam)
        page.screenshot(path=os.path.join(SHOTS, "app-onboard-setup.png"))
        page.get_by_role("button", name="Continue").click(); page.wait_for_timeout(900)
        check("summary shows the picks", page.get_by_text("Electrical · California", exact=False).first.is_visible())
        saved = page.evaluate("JSON.parse(localStorage.getItem('lb.onboard.choice') || 'null')")
        check("picks are saved on the device", saved == {"trade": "elec", "state": "California", "examDate": exam}, str(saved))
        signup = page.get_by_role("link", name="Create free account")
        check("account step links to sign-up and then the study app", "mode=signup" in (signup.get_attribute("href") or "") and "learn" in (signup.get_attribute("href") or ""))
        page.screenshot(path=os.path.join(SHOTS, "app-onboard-done.png"))
        check("onboarding never scrolls sideways", not overflow(page))
        page.get_by_role("button", name="Look around first").click(); page.wait_for_timeout(800)

        # --- Signed-out app home ---
        check("app welcome screen replaces the landing page", page.get_by_role("heading", name="Let’s get you licensed").count() + page.get_by_role("heading", name="Let's get you licensed").count() >= 1)
        check("welcome uses the onboarding picks", page.get_by_text("California · Electrical", exact=False).first.is_visible())
        check("no website marketing sections (plans, FAQ)", page.get_by_text("Frequently asked", exact=False).count() == 0 and page.locator("#hero-title").count() == 0)
        page.wait_for_selector("[class*=tryBody]", timeout=8000)
        page.locator("button[class*=choice]").first.click(); page.wait_for_timeout(500)
        check("sample question shows right/wrong with the explanation", page.locator("[class*=why]").count() == 1)
        for _ in range(2):
            page.locator("[class*=nextBtn]").click(); page.wait_for_timeout(500)
            page.locator("button[class*=choice]").first.click(); page.wait_for_timeout(400)
        page.locator("[class*=nextBtn]").click(); page.wait_for_timeout(500)
        check("after three questions it shows a score and a sign-up button", page.locator("[class*=score]").first.is_visible() and page.get_by_role("link", name="Keep practicing free").count() == 1)
        page.screenshot(path=os.path.join(SHOTS, "app-welcome.png"), full_page=True)
        check("welcome screen never scrolls sideways", not overflow(page))
        go(page, "/")
        check("onboarding is not shown again on the next launch", page.get_by_role("dialog", name="Welcome to Licensing Bro's").count() == 0)
        page.get_by_role("button", name="Replay the intro").click(); page.wait_for_timeout(600)
        check("Replay the intro opens onboarding again", page.get_by_role("dialog", name="Welcome to Licensing Bro's").count() == 1)

        # --- Sign-up carries the picks into the new account ---
        go(page, "/login/?mode=signup&next=/learn/")
        page.locator("#fullName").fill("Marco Ruiz")
        page.locator("#email").fill("marco@example.com")
        page.locator("#password").fill("hunter22-long")
        page.locator("button.btn.primary", has_text="Create account").click(); page.wait_for_timeout(1200)
        body = next((b for k, b in fake.calls if k == "signup"), None) or {}
        meta = body.get("data") or body.get("options", {}).get("data") or {}
        check("sign-up sends the trade, state and exam date from onboarding", meta.get("trade") == "elec" and meta.get("state") == "California" and meta.get("exam_date") == exam, json.dumps(meta))
        check("first launch ran without errors", not errors, "; ".join(errors[:3]))
        ctx.close()

        # --- Signed-in student: app home, no onboarding, no marketing ---
        print("\nsigned-in student")
        ctx, page, fake, errors = phone(user=PAID_ID)
        go(page, "/")
        page.wait_for_timeout(800)
        check("signed-in student skips onboarding", page.get_by_role("dialog", name="Welcome to Licensing Bro's").count() == 0)
        check("dashboard is the home screen", page.locator("#dash-title").count() == 1)
        check("today's plan coaches the next steps", page.locator("#plan-title").count() == 1 and page.get_by_text("Drill Contracts & liens", exact=False).count() == 1)
        check("no landing hero or plans in the app home", page.locator("#hero-title").count() == 0 and page.get_by_text("Frequently asked", exact=False).count() == 0)
        check("bottom tabs are there", page.locator("nav.bottomtabs").is_visible())
        plan = page.locator("#plan-title").locator("xpath=ancestor::section[1]")
        plan.scroll_into_view_if_needed(); page.wait_for_timeout(1000)
        check("today's plan fades in when it scrolls into view", page.evaluate("getComputedStyle(document.querySelector('#plan-title').closest('section')).opacity") == "1")
        plan.screenshot(path=os.path.join(SHOTS, "app-today-plan.png"))
        page.screenshot(path=os.path.join(SHOTS, "app-home-student.png"), full_page=True)
        check("app home never scrolls sideways", not overflow(page))
        check("app home ran without errors", not errors, "; ".join(errors[:3]))
        ctx.close()
        browser.close()
    httpd.shutdown()
    print(f"\n{sum(RESULTS)} passed, {len(RESULTS) - sum(RESULTS)} failed")
    return 0 if all(RESULTS) else 1

if __name__ == "__main__":
    sys.exit(main())
