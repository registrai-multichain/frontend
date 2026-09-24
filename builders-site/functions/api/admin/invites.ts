import type { PagesFunction } from "../../../lib/env";
import { handleAdminInvites } from "../../../lib/invites";

/** GET / POST / PATCH / DELETE /api/admin/invites (the middleware has checked the session). */
export const onRequest: PagesFunction<{ admin?: string }> = ({ request, env, data }) =>
  handleAdminInvites(request, env, data.admin!);
