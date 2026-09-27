import type { PagesFunction } from "../../../../lib/env";
import { handleAdminRebuild } from "../../../../lib/market-proposals";

/** POST /api/admin/market-proposals/rebuild — rebuild the agent's feed docs and the records'
 *  metadata (idempotent; admins only, like every admin mutation). */
export const onRequestPost: PagesFunction = ({ env }) => handleAdminRebuild(env);
