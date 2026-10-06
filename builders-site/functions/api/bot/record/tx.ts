import type { PagesFunction } from "../../../../lib/env";
import { handleBotRecordTx } from "../../../../lib/record";

/** POST /api/bot/record/tx {day, tx} — the anchor transaction, set once (Bearer RADAR_PUBLISH_SECRET). */
export const onRequest: PagesFunction = ({ request, env }) => handleBotRecordTx(request, env);
