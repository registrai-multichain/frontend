import { safeEqual } from "../../src/lib/builders-admin";
import type { Env } from "./env";
import { errorJson } from "./http";

/**
 * The radar/recorder Bearer check shared by every /api/bot/* route that uses RADAR_PUBLISH_SECRET:
 * 503 when the secret is unset or under 32 characters, 401 on a missing or wrong token, 405 for any other method.
 * Returns the refusal, or null when the call may proceed.
 */
export function botGuard(req: Request, env: Env, method: "GET" | "POST", what: string): Response | null {
  const secret = env.RADAR_PUBLISH_SECRET ?? "";
  if (secret.length < 32) return errorJson(503, `${what} is not configured`);
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !safeEqual(token, secret)) return errorJson(401, "unauthorized");
  if (req.method.toUpperCase() !== method) return errorJson(405, "method not allowed");
  return null;
}
