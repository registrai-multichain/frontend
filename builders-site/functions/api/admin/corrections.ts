import type { Role } from "../../../lib/auth";
import type { PagesFunction } from "../../../lib/env";
import { handleAdminCorrections } from "../../../lib/corrections";

/** GET / POST /api/admin/corrections (the middleware has checked the session and, for POST, CSRF). */
export const onRequest: PagesFunction<{ admin?: string; role?: Role }> = ({ request, env, data }) =>
  handleAdminCorrections(request, env, { address: data.admin ?? "", role: data.role ?? "onboarder" });
