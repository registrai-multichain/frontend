import type { PagesFunction } from "../../lib/env";
import { handleIcon } from "../../lib/icon";

/** GET /api/icon?source=domain:<host> — the project's own site icon for the gallery (see lib/icon.ts). */
export const onRequestGet: PagesFunction = (ctx) => handleIcon(ctx.request, { waitUntil: (p) => ctx.waitUntil(p) });
