// Turns Supabase Auth errors into plain words for students, plus a hint for the site owner when the cause is a
// setup problem (email sender, keys, database). The owner hint points to /status/, which checks the whole setup.

export type FriendlyError = { text: string; owner?: string };

export function friendlyAuthError(err: unknown): FriendlyError {
  const e = err as { message?: string; code?: string; status?: number } | null;
  const m = String(e?.message || "").trim();
  const code = String(e?.code || "");
  const has = (re: RegExp) => re.test(m) || re.test(code);

  if (has(/email address not authorized|email_address_not_authorized/i)) {
    return {
      text: "This site can't send sign-up emails yet, so new accounts can't be confirmed.",
      owner: "Supabase is still using its built-in email sender, which only emails members of your Supabase team. Connect an email sender in Supabase (Authentication → Email → SMTP Settings), or turn off \"Confirm email\" while you test."
    };
  }
  if (has(/error sending .*email|sending (confirmation|recovery|magic link) email|smtp/i)) {
    return {
      text: "The confirmation email couldn't be sent. Try again in a few minutes.",
      owner: "Supabase couldn't send through your email sender. Check the SMTP host, port, username and password in Supabase (Authentication → Email → SMTP Settings), and that your sending domain is verified."
    };
  }
  if (has(/rate limit|over_email_send_rate_limit|too many requests/i) || e?.status === 429) {
    return {
      text: "Too many emails were sent from this site in the last hour. Wait a little while and try again.",
      owner: "Supabase's built-in sender allows only about 2 emails an hour. Connect your own email sender, then raise the limit under Authentication → Rate Limits."
    };
  }
  if (has(/invalid api key|no api key|apikey|invalid jwt/i)) {
    return {
      text: "The site isn't connected to its server correctly.",
      owner: "The SUPABASE_ANON_KEY variable doesn't match your project. Copy the publishable key again from Supabase → Connect, update the GitHub variable, and rerun Publish website."
    };
  }
  if (has(/invalid value|invalid header|failed to execute 'fetch'|is not a valid http header/i)) {
    return {
      text: "The site isn't connected to its server correctly.",
      owner: "The SUPABASE_ANON_KEY variable contains characters that can't be sent (often a line break or space). Paste the publishable key again on one line, then rerun Publish website."
    };
  }
  if (has(/failed to fetch|networkerror|load failed|network request failed/i)) {
    return {
      text: "Couldn't reach the server. Check your internet connection and try again.",
      owner: "If your internet works, the SUPABASE_URL variable may be wrong or the Supabase project may be paused."
    };
  }
  if (has(/database error saving new user|unexpected_failure/i)) {
    return {
      text: "Your account couldn't be set up on the server.",
      owner: "The database isn't fully set up. Run supabase/schema.sql in Supabase's SQL Editor, then try again."
    };
  }
  if (has(/signups? not allowed|signup_disabled|signup is disabled/i)) {
    return { text: "New sign-ups are turned off right now.", owner: "Turn on \"Allow new users to sign up\" in Supabase (Authentication → Sign In / Providers)." };
  }
  if (has(/email provider is disabled|email_provider_disabled/i)) {
    return { text: "Email sign-in is turned off right now.", owner: "Turn on the Email provider in Supabase (Authentication → Sign In / Providers)." };
  }
  if (has(/user already registered|user_already_exists|already been registered/i)) {
    return { text: "There's already an account with that email. Sign in instead, or use Forgot password." };
  }
  if (has(/invalid login credentials|invalid_credentials/i)) return { text: "That email and password don't match. Check them and try again." };
  if (has(/email not confirmed|email_not_confirmed/i)) return { text: "Confirm your email first: open the link we sent you, then sign in." };
  if (has(/token has expired|otp_expired|invalid token|otp/i)) return { text: "That code is wrong or has expired. Ask for a new one." };
  if (has(/password should be at least|weak_password|weak password/i)) return { text: "Pick a longer password: at least 8 characters, mixing letters and numbers." };
  if (has(/unable to validate email|invalid format|email_address_invalid|invalid email/i)) return { text: "That email address doesn't look right. Check it and try again." };
  return { text: m || "That didn't work. Try again." };
}
