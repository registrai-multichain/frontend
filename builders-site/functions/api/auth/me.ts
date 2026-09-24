import { handleMe } from "../../../lib/auth";
import type { PagesFunction } from "../../../lib/env";

export const onRequestGet: PagesFunction = ({ request, env }) => handleMe(request, env);
