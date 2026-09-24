import type { PagesFunction } from "../../../lib/env";
import { handleInviteOpen } from "../../../lib/invites";

/** POST /api/invites/open — /verify calls it once per load of a claim link. */
export const onRequestPost: PagesFunction = ({ request, env }) => handleInviteOpen(request, env);
