import type { PagesFunction } from "../../lib/env";
import { handleProof } from "../../lib/proof";

/** GET /api/proof?source= — a project's proof file, read server-side (see lib/proof.ts). */
export const onRequestGet: PagesFunction = (ctx) => handleProof(ctx.request, { waitUntil: (p) => ctx.waitUntil(p) });
