import type { PagesFunction } from "../../../lib/env";
import { handleBotInvites } from "../../../lib/bot";

/** GET / POST / DELETE /api/bot/invites — the Telegram bot (Bearer BOT_SECRET). */
export const onRequest: PagesFunction = ({ request, env }) => handleBotInvites(request, env);
