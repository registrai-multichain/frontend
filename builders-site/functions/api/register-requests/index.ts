import type { PagesFunction } from "../../../lib/env";
import { handleRegisterRequest } from "../../../lib/register-requests";

/** POST /api/register-requests — /verify's "register it for me" (no gas on the builders network). */
export const onRequestPost: PagesFunction = ({ request, env }) => handleRegisterRequest(request, env);
