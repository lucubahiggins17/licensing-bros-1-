#!/usr/bin/env bash
# Runs every automated check: database security (PGlite), backend logic (Deno), web build, browser flows (Playwright),
# phone/tablet/desktop layouts, the GitHub Pages subfolder build, and the Android app build's onboarding.
# Usage: bash tests/run-all.sh      (needs node, deno on PATH or $DENO, python3 + playwright for the browser part)
set -euo pipefail
cd "$(dirname "$0")/.."
DENO_BIN="${DENO:-deno}"
echo "== 1/7 Database security tests"
(cd tests && npm install --silent --no-audit --no-fund && node sql/run.mjs | tail -3)
echo "== 2/7 Backend tests"
TMP="$(mktemp -d)"; mkdir -p "$TMP/supabase" "$TMP/tests"
cp -r supabase/functions "$TMP/supabase/"; cp -r tests/functions "$TMP/tests/"; echo '{}' > "$TMP/deno.json"
(cd "$TMP" && "$DENO_BIN" check supabase/functions/*/index.ts && "$DENO_BIN" test -A tests/functions/ | tail -3)
echo "== 3/7 Web build"
NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=test npx next build | tail -3
echo "== 4/7 Browser flows"
python3 tests/e2e/run.py | tail -3
echo "== 5/7 Device sweep (phones, tablets portrait/landscape, laptop, desktop)"
python3 tests/e2e/devices.py | tail -2
echo "== 6/7 GitHub Pages subfolder (you.github.io/licensing-bros)"
NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_BASE_PATH=/licensing-bros NEXT_PUBLIC_SITE_URL=http://localhost:8834/licensing-bros NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=test npx next build | tail -1
python3 tests/e2e/basepath.py | tail -1
echo "== 7/7 Android app build (launch screen, onboarding, app home)"
NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_TARGET=app NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=test npx next build | tail -1
python3 tests/e2e/appbuild.py | tail -1
