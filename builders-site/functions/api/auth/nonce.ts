import { handleNonce } from "../../../lib/auth";
import type { PagesFunction } from "../../../lib/env";

export const onRequestGet: PagesFunction = ({ env }) => handleNonce(env);
