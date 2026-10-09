import { safeEqual } from "../../src/lib/builders-admin";
import type { Env } from "./env";
import { errorJson } from "./http";

/**
 * A Bearer check against one secret: 503 when it is unset or under 32 characters, 401 on a
 * missing or wrong token (constant-time compare), 405 for any other method.
 * Returns the refusal, or null when the call may proceed.
 */
export function bearerGuard(req: Request, secret: string | undefined, method: "GET" | "POST", what: string): Response | null {
  const s = secret ?? "";
  if (s.length < 32) return errorJson(503, `${what} is not configured`);
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !safeEqual(token, s)) return errorJson(401, "unauthorized");
  if (req.method.toUpperCase() !== method) return errorJson(405, "method not allowed");
  return null;
}

/** The radar/recorder check shared by every /api/bot/* route that uses RADAR_PUBLISH_SECRET. */
export function botGuard(req: Request, env: Env, method: "GET" | "POST", what: string): Response | null {
  return bearerGuard(req, env.RADAR_PUBLISH_SECRET, method, what);
}
