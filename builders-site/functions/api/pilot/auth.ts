import type { PagesFunction } from "../../../lib/env";
import { errorJson } from "../../../lib/http";
import { handlePilotLogin, handlePilotLogout, handlePilotNonce } from "../../../lib/pilot-auth";

/** /api/pilot/auth: GET a sign-in nonce, POST { message, signature } to sign in, DELETE to sign out (ends every session of the wallet). */
export const onRequest: PagesFunction = ({ request, env }) => {
  const m = request.method.toUpperCase();
  if (m === "GET") return handlePilotNonce(env);
  if (m === "POST") return handlePilotLogin(request, env);
  if (m === "DELETE") return handlePilotLogout(request, env);
  return errorJson(405, "method not allowed");
};
