"""
Subfolder check: the website as GitHub Pages serves it without a custom domain (https://you.github.io/licensing-bros/).
Build first with the subfolder baked in:
    NEXT_PUBLIC_BASE_PATH=/licensing-bros NEXT_PUBLIC_SITE_URL=http://localhost:8834/licensing-bros \
    NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=test npx next build
then: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 tests/e2e/basepath.py
Every page, script, font and image must load from under /licensing-bros/, and links must stay inside it.
"""
import os, sys, json, shutil, tempfile, threading, functools, http.server, socketserver, urllib.parse
sys.path.insert(0, os.path.dirname(__file__))
sys.argv = sys.argv[:1]  # the shared harness parses its own flags on import
import run as harness
from fakebackend import FakeBackend, ADMIN_ID, PAID_ID, C_PAID
from playwright.sync_api import sync_playwright

SUB = "/licensing-bros"
PORT = 8834
BASE = f"http://localhost:{PORT}"
RESULTS = []

def check(name, cond, detail=""):
    RESULTS.append(bool(cond))
    print(("  ✓ " if cond else "  ✗ ") + name + ("" if cond else f"  [{detail}]"), flush=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def main():
    if not os.path.exists(os.path.join(harness.OUT, "_next")):
        print("Build ./out with NEXT_PUBLIC_BASE_PATH=/licensing-bros first (see the top of this file)."); return 1
    root = tempfile.mkdtemp(prefix="lb-pages-")
    shutil.copytree(harness.OUT, os.path.join(root, SUB.strip("/")))
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=root))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    with sync_playwright() as p:
        browser = p.chromium.launch()

        def open_page(user=None, w=1280, h=900):
            fake = FakeBackend(user_id=user)
            ctx = browser.new_context(viewport={"width": w, "height": h}, is_mobile=w < 500, has_touch=w < 500)
            if user:
                ctx.add_init_script(f"try {{ localStorage.setItem('sb-example-auth-token', {json.dumps(json.dumps(fake.session_obj()))}); }} catch (e) {{}}")
            page = ctx.new_page()
            bad, errors = [], []
            page.on("response", lambda r: bad.append(f"{r.status} {urllib.parse.urlparse(r.url).path}") if r.url.startswith(BASE) and r.status >= 400 else None)
            page.on("pageerror", lambda e: errors.append(str(e)[:160]))
            harness.wire(page, fake)
            return ctx, page, bad, errors

        def go(page, path):
            page.goto(BASE + path, wait_until="domcontentloaded")
            try: page.wait_for_load_state("networkidle", timeout=8000)
            except Exception: pass
            page.wait_for_timeout(500)

        # Visitor: home page, every file from the subfolder, links stay inside it
        ctx, page, bad, errors = open_page()
        go(page, SUB + "/")
        check("home page loads from the subfolder", page.get_by_text("Contractor license", exact=False).first.is_visible())
        check("no missing scripts, fonts or images", not bad, "; ".join(bad[:4]))
        logo_ok = page.evaluate("[...document.querySelectorAll('img')].filter(i => i.src.includes('logo')).every(i => i.complete && i.naturalWidth > 0)")
        check("logo images load", logo_ok)
        hrefs = page.evaluate("[...document.querySelectorAll('a[href^=\"/\"]')].map(a => a.getAttribute('href'))")
        outside = [h for h in hrefs if not h.startswith(SUB + "/") and h != SUB]
        check("every internal link stays inside the subfolder", not outside, ", ".join(outside[:5]))
        page.locator("a[href='%s/courses/']" % SUB).first.click()
        page.wait_for_timeout(1200)
        check("clicking Courses goes to the subfolder's catalog", page.url.startswith(BASE + SUB + "/courses/"), page.url)
        go(page, f"{SUB}/course/?id={C_PAID}")
        check("course page works with its query string", page.get_by_text("$299").first.count() > 0)
        man = page.evaluate(f"fetch('{SUB}/manifest.webmanifest').then(r => r.json())")
        check("install-to-home-screen manifest points inside the subfolder", man.get("start_url", "").startswith(SUB + "/") and all(i["src"].startswith(SUB + "/") for i in man.get("icons", [])), json.dumps(man)[:200])
        check("visitor pages ran without errors", not errors, "; ".join(errors[:3]))
        ctx.close()

        # Student on a phone: study area, and sign-in "next" links don't double the subfolder
        ctx, page, bad, errors = open_page(PAID_ID, 390, 844)
        go(page, SUB + "/learn/")
        check("[phone] My Learning opens", page.get_by_text("Readiness", exact=False).first.count() > 0)
        go(page, SUB + "/login/?next=" + urllib.parse.quote(SUB + "/community/"))
        page.wait_for_timeout(1200)
        check("sign-in returns to the right page (no doubled subfolder)", urllib.parse.urlparse(page.url).path == SUB + "/community/", page.url)
        check("[phone] student pages ran without errors and nothing was missing", not errors and not bad, "; ".join((errors + bad)[:3]))
        ctx.close()

        # Admin console
        ctx, page, bad, errors = open_page(ADMIN_ID)
        go(page, SUB + "/admin/#tests")
        check("admin control center works in the subfolder", page.get_by_text("Lien Law Lingo").first.count() > 0)
        check("admin pages ran without errors", not errors and not bad, "; ".join((errors + bad)[:3]))
        ctx.close()
        browser.close()
    httpd.shutdown()
    shutil.rmtree(root, ignore_errors=True)
    print(f"\n{sum(RESULTS)} passed, {len(RESULTS) - sum(RESULTS)} failed")
    return 0 if all(RESULTS) else 1

if __name__ == "__main__":
    sys.exit(main())
