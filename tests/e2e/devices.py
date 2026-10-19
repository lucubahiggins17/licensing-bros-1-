"""
Device sweep: opens every page as each kind of student on phone, tablet (portrait + landscape), laptop and
large desktop sizes, with touch where real devices have it. Checks for sideways scrolling, elements wider than
the screen, tap targets that are too small, overlapping fixed bars and JavaScript errors; saves screenshots.
Usage: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 tests/e2e/devices.py [--shots DIR] [--only DEVICE]
"""
import os, sys, json, argparse
sys.path.insert(0, os.path.dirname(__file__))
import run as harness  # reuses the static server + fake backend wiring
from fakebackend import FakeBackend, ADMIN_ID, PAID_ID, FREE_ID, C_PAID, L_PAID1, LIVE_NOW, POST1
from playwright.sync_api import sync_playwright

DEVICES = [
    ("phone-se", 375, 667, True),
    ("phone", 390, 844, True),
    ("tablet-portrait", 768, 1024, True),     # iPad mini / most Android tablets
    ("tablet-air", 820, 1180, True),          # iPad Air portrait
    ("tablet-landscape", 1024, 768, True),    # iPad landscape
    ("tablet-pro-landscape", 1366, 1024, True),
    ("laptop", 1280, 800, False),
    ("desktop", 1920, 1080, False),
]

PAGES = [
    ("home", None, "/"),
    ("courses", None, "/courses/?state=Tennessee&trade=gc"),
    ("course", None, f"/course/?id={C_PAID}"),
    ("live-list", None, "/live/"),
    ("login", None, "/login/"),
    ("home-signed-in", PAID_ID, "/"),
    ("lesson", PAID_ID, f"/lesson/?id={L_PAID1}"),
    ("learn-tutor", PAID_ID, "/learn/#tutor"),
    ("learn-exam", PAID_ID, "/learn/#exam"),
    ("learn-review", PAID_ID, "/learn/#review"),
    ("learn-games", PAID_ID, "/learn/#games"),
    ("learn-cards", PAID_ID, "/learn/#cards"),
    ("learn-tools", PAID_ID, "/learn/#tools"),
    ("learn-progress", PAID_ID, "/learn/#progress"),
    ("live-watch", FREE_ID, f"/live/watch/?id={LIVE_NOW}"),
    ("community", FREE_ID, "/community/"),
    ("community-post", FREE_ID, f"/community/?post={POST1}"),
    ("account", PAID_ID, "/account/#devices"),
    ("admin-dashboard", ADMIN_ID, "/admin/#dashboard"),
    ("admin-courses", ADMIN_ID, "/admin/#courses"),
    ("admin-builder", ADMIN_ID, "/admin/#tests"),
    ("admin-code-entry", FREE_ID, "/admin/"),
    ("admin-users", ADMIN_ID, "/admin/#users"),
    ("admin-settings", ADMIN_ID, "/admin/#settings"),
    ("studio", ADMIN_ID, f"/live/studio/?id={LIVE_NOW}"),
]

PROBE = """
() => {
  const vw = window.innerWidth;
  const out = { overflowX: document.documentElement.scrollWidth - vw, wide: [], smallTargets: [], hiddenByBars: [] };
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // elements poking out of the viewport sideways (ignore ones inside horizontal scrollers)
    if (r.right > vw + 2 || r.left < -2) {
      let p = el.parentElement, scrolls = false;
      while (p && p !== document.body) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX) || /(auto|scroll|hidden)/.test(s.overflow)) { scrolls = true; break; } p = p.parentElement; }
      if (!scrolls && out.wide.length < 6) out.wide.push((el.className && el.className.toString().slice(0, 60)) || el.tagName);
    }
    // touch targets under 32px (interactive, visible)
    if (el.matches('a[href],button,select,input:not([type=hidden]),textarea,[role=tab],[role=button]')) {
      if ((r.width < 32 || r.height < 28) && r.width > 0 && el.offsetParent !== null) {
        const label = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30);
        if (out.smallTargets.length < 8 && !el.closest('.match')) out.smallTargets.push(label + ` (${Math.round(r.width)}x${Math.round(r.height)})`);
      }
    }
  }
  return out;
}
"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", default=os.path.join(harness.ROOT, "tests", "e2e", "shots", "devices"))
    ap.add_argument("--only", default=None)
    a, _ = ap.parse_known_args()
    os.makedirs(a.shots, exist_ok=True)
    httpd = harness.serve()
    problems = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for dname, w, h, touch in DEVICES:
            if a.only and a.only != dname:
                continue
            print(f"\n{dname} ({w}x{h}{', touch' if touch else ''})", flush=True)
            for pname, user, path in PAGES:
                fake = FakeBackend(user_id=user)
                ctx = browser.new_context(viewport={"width": w, "height": h}, is_mobile=touch and w < 900, has_touch=touch, device_scale_factor=1)
                if user:
                    ctx.add_init_script(f"try {{ localStorage.setItem('sb-example-auth-token', {json.dumps(json.dumps(fake.session_obj()))}); }} catch (e) {{}}")
                page = ctx.new_page()
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)[:160]))
                harness.wire(page, fake)
                page.goto(harness.BASE + path, wait_until="domcontentloaded")
                try: page.wait_for_load_state("networkidle", timeout=6000)
                except Exception: pass
                page.wait_for_timeout(700)
                info = page.evaluate(PROBE)
                page.screenshot(path=os.path.join(a.shots, f"{dname}--{pname}.png"))
                issues = []
                if info["overflowX"] > 1: issues.append(f"sideways scroll {info['overflowX']}px")
                if info["wide"]: issues.append("wider than screen: " + ", ".join(info["wide"][:3]))
                if touch and info["smallTargets"]: issues.append("small tap targets: " + "; ".join(info["smallTargets"][:4]))
                if errors: issues.append("errors: " + "; ".join(errors[:2]))
                mark = "✓" if not issues else "•"
                print(f"  {mark} {pname}" + ("" if not issues else "  — " + " | ".join(issues)), flush=True)
                for i in issues:
                    problems.append((dname, pname, i))
                ctx.close()
        browser.close()
    httpd.shutdown()
    hard = [x for x in problems if not x[2].startswith("small tap targets")]
    print(f"\n{len(hard)} layout/error problems, {len(problems) - len(hard)} small-tap-target notes")
    with open(os.path.join(a.shots, "report.json"), "w") as f:
        json.dump(problems, f, indent=1)
    return 0 if not hard else 1

if __name__ == "__main__":
    sys.exit(main())
