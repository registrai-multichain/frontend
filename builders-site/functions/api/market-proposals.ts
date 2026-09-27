import type { PagesFunction } from "../../lib/env";
import { handlePreflight, handleSubmit } from "../../lib/market-proposals";

/** POST /api/market-proposals — app.registrai.cc's public propose form (CORS, rate-limited). */
export const onRequestPost: PagesFunction = ({ request, env }) => handleSubmit(request, env);
export const onRequestOptions: PagesFunction = ({ env }) => handlePreflight(env);
