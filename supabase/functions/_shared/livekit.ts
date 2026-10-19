// LiveKit access tokens (HS256 JWT signed with the project's API secret).
import { SignJWT } from "npm:jose@6.2.12";

export type LiveKitTokenOptions = {
  apiKey: string;
  apiSecret: string;
  identity: string;
  name: string;
  room: string;
  canPublish: boolean;
  ttlSeconds?: number;
  metadata?: string;
  now?: number; // ms, for tests
};

export const LIVEKIT_TTL_SECONDS = 6 * 60 * 60;

/**
 * Viewer: subscribe + data, no publish. Host: publish + subscribe + data.
 * Claims: iss = API key, sub = identity, name, nbf, exp (6 h), video grant.
 */
export async function signLiveKitToken(o: LiveKitTokenOptions): Promise<string> {
  const now = Math.floor((o.now ?? Date.now()) / 1000);
  const claims: Record<string, unknown> = {
    name: o.name,
    video: { room: o.room, roomJoin: true, canPublish: o.canPublish, canSubscribe: true, canPublishData: true }
  };
  if (o.metadata) claims.metadata = o.metadata;
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(o.apiKey)
    .setSubject(o.identity)
    .setJti(`${o.identity}-${now}`)
    .setNotBefore(now - 10) // small allowance for clock skew between servers
    .setExpirationTime(now + (o.ttlSeconds ?? LIVEKIT_TTL_SECONDS))
    .sign(new TextEncoder().encode(o.apiSecret));
}

export function livekitEnv(): { url: string; apiKey: string; apiSecret: string } | null {
  const url = Deno.env.get("LIVEKIT_URL") || "";
  const apiKey = Deno.env.get("LIVEKIT_API_KEY") || "";
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET") || "";
  return url && apiKey && apiSecret ? { url, apiKey, apiSecret } : null;
}
