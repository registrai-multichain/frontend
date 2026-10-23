import { handleLogout } from "../../../lib/auth";
import type { PagesFunction } from "../../../lib/env";

export const onRequestPost: PagesFunction = ({ request, env }) => handleLogout(request, env);
