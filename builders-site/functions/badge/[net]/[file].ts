import { handleBadge } from "../../../lib/badge";
import type { PagesFunction } from "../../../lib/env";

/** /badge/<net>/<file>: the static art, or the generic picture for a serial not rendered yet (lib/badge.ts). */
export const onRequestGet: PagesFunction = ({ request, env }) => handleBadge(request, env);
export const onRequestHead: PagesFunction = ({ request, env }) => handleBadge(request, env);
