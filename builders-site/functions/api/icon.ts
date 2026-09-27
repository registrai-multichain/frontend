import type { PagesFunction } from "../../lib/env";
import { handleIcon } from "../../lib/icon";
import { getInvite } from "../../lib/invites";

/** GET /api/icon?source=domain:<host> — the project's own site icon for the gallery, else its X picture (see lib/icon.ts). */
export const onRequestGet: PagesFunction = (ctx) =>
  handleIcon(ctx.request, {
    waitUntil: (p) => ctx.waitUntil(p),
    xHandleOf: async (source) => (await getInvite(ctx.env.INVITES, source))?.x ?? null,
  });
