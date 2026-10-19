// The Supabase address and key baked into this build, cleaned up so common copy-paste slips still work:
// spaces or line breaks, quotes, a trailing slash or path, a missing https://, the bare project ID, or the
// dashboard link (supabase.com/dashboard/project/<id>) instead of the Project URL.
export const RAW_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const RAW_SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export function cleanSupabaseUrl(raw: string): string {
  let u = (raw || "").replace(/\s+/g, "").replace(/^["']+|["']+$/g, "");
  if (!u) return "";
  const dash = /supabase\.com\/dashboard\/project\/([a-z0-9]{15,40})/i.exec(u);
  if (dash) return `https://${dash[1].toLowerCase()}.supabase.co`;
  if (/^[a-z0-9]{20}$/i.test(u)) return `https://${u.toLowerCase()}.supabase.co`;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const p = new URL(u);
    return `${p.protocol}//${p.host}`.toLowerCase();
  } catch {
    return u.replace(/\/+$/, "");
  }
}

export const cleanSupabaseKey = (raw: string) => (raw || "").replace(/\s+/g, "").replace(/^["']+|["']+$/g, "");

export const SUPABASE_URL = cleanSupabaseUrl(RAW_SUPABASE_URL);
export const SUPABASE_KEY = cleanSupabaseKey(RAW_SUPABASE_KEY);
