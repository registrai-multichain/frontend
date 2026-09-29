import type { PagesFunction } from "../../../lib/env";
import { PROPOSALS_CLOSED, handleClosed, handlePreflight, handleSubmit } from "../../../lib/market-proposals";

/** POST /api/market-proposals — app.registrai.cc's public propose form (CORS, rate-limited).
 *  Closed while markets are frozen: answers 410. */
export const onRequestPost: PagesFunction = ({ request, env }) => (PROPOSALS_CLOSED ? handleClosed(env) : handleSubmit(request, env));
export const onRequestOptions: PagesFunction = ({ env }) => handlePreflight(env);
