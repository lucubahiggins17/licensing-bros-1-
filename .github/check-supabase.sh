#!/usr/bin/env bash
# Cleans and checks the SUPABASE_URL / SUPABASE_ANON_KEY repository variables before a build, then exports the
# cleaned values as NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY for the next steps.
# Fixes common copy-paste slips (spaces, line breaks, quotes, a path, missing https://, the bare project ID or the
# dashboard link) and shows what it found on the run's summary page. Fails only when the settings can't work.
set -uo pipefail

raw_url="${SUPABASE_URL:-}"
raw_key="${SUPABASE_ANON_KEY:-}"
if [ -z "$raw_url" ] || [ -z "$raw_key" ]; then
  echo "::error title=Supabase settings missing::Add repository variables SUPABASE_URL and SUPABASE_ANON_KEY (Settings > Secrets and variables > Actions > Variables tab)."
  exit 1
fi

url="$(printf '%s' "$raw_url" | tr -d '[:space:]"'"'")"
if [[ "$url" =~ supabase\.com/dashboard/project/([a-zA-Z0-9]+) ]]; then
  url="https://${BASH_REMATCH[1]}.supabase.co"
  echo "::warning title=SUPABASE_URL::That's the dashboard link. Using the Project URL ${url} instead; update the variable to it."
elif [[ "$url" =~ ^[a-zA-Z0-9]{20}$ ]]; then
  url="https://${url}.supabase.co"
fi
[[ "$url" =~ ^https?:// ]] || url="https://${url}"
url="$(printf '%s' "$url" | sed -E 's#^(https?://[^/?#]+).*#\1#' | tr '[:upper:]' '[:lower:]')"
key="$(printf '%s' "$raw_key" | tr -d '[:space:]"'"'")"

if [ "$url" != "$(printf '%s' "$raw_url" | sed -E 's#/+$##')" ]; then
  echo "::warning title=SUPABASE_URL tidied::The variable had extra characters or a path. Using ${url}. Set the variable to exactly that."
fi
if [ "$key" != "$raw_key" ]; then
  echo "::warning title=SUPABASE_ANON_KEY tidied::The key had spaces, line breaks or quotes. They were removed; paste it again on one line to keep it clean."
fi

kind="unknown"
case "$key" in
  sb_publishable_*) kind="publishable key" ;;
  sb_secret_*) kind="SECRET key" ;;
  eyJ*)
    payload="$(printf '%s' "$key" | cut -d. -f2 | tr '_-' '/+')"
    while [ $(( ${#payload} % 4 )) -ne 0 ]; do payload="${payload}="; done
    role="$(printf '%s' "$payload" | base64 -d 2>/dev/null | grep -o '"role":"[a-z_]*"' | cut -d'"' -f4)"
    case "$role" in anon) kind="legacy anon key" ;; service_role) kind="SECRET key" ;; esac
    ;;
esac
if [ "$kind" = "SECRET key" ]; then
  echo "::error title=SUPABASE_ANON_KEY is a secret key::Never put a secret/service_role key in the website. Use the publishable key (sb_publishable_...) from Supabase > Connect, then create a new secret key in Supabase and delete this one."
  exit 1
fi

code="$(curl -s -o /dev/null -m 20 -w '%{http_code}' -H "apikey: ${key}" "${url}/auth/v1/settings" || true)"
case "$code" in
  200) echo "::notice title=Supabase settings OK::Project ${url} answered and accepted the ${kind}." ;;
  401|403) echo "::error title=Supabase rejected the key::${url} answered, but the SUPABASE_ANON_KEY variable isn't a key for this project. Copy the publishable key from Supabase > Connect."; exit 1 ;;
  000) echo "::error title=Supabase not reachable::Couldn't reach ${url}. Set SUPABASE_URL to the Project URL from Supabase > Connect (https://xxxx.supabase.co), and make sure the project isn't paused."; exit 1 ;;
  *) echo "::warning title=Supabase answered ${code}::${url} answered with HTTP ${code}. Check the project in the Supabase dashboard." ;;
esac

{
  echo "NEXT_PUBLIC_SUPABASE_URL=${url}"
  echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=${key}"
} >> "${GITHUB_ENV:-/dev/null}"
