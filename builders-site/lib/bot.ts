/**
 * /api/bot/invites — the Telegram bot's narrow door to the invites (the watchdog
 * Worker, on the owner's linked chat only). Authorization: `Bearer <BOT_SECRET>`
 * (a Pages secret, never in wrangler.toml; unset = every call fails closed, 503).
 * The bot may list, create and remove invites — exactly /admin's logic, so
 * normalisation, duplicates and the claim link are identical — and nothing else:
 * no edits, no onboarding, no badges, nothing on-chain.
 */
import { safeEqual } from "../../src/lib/builders-admin";
import type { Env } from "./env";
import { errorJson } from "./http";
import { handleAdminInvites } from "./invites";

export const BOT_ACTOR = "telegram-bot";

export async function handleBotInvites(req: Request, env: Env, nowMs = Date.now()): Promise<Response> {
  const secret = env.BOT_SECRET ?? "";
  if (secret.length < 32) return errorJson(503, "bot access is not configured");
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !safeEqual(token, secret)) return errorJson(401, "unauthorized");
  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "POST" && method !== "DELETE") return errorJson(405, "method not allowed");
  return handleAdminInvites(req, env, BOT_ACTOR, nowMs);
}
