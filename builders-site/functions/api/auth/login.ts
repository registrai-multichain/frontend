import { handleLogin } from "../../../lib/auth";
import type { PagesFunction } from "../../../lib/env";

export const onRequestPost: PagesFunction = ({ request, env }) => handleLogin(request, env);
