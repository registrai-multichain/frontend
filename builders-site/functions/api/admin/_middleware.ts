import { adminGate, type Role } from "../../../lib/auth";
import type { PagesFunction } from "../../../lib/env";

/** Every /api/admin/* route: a live admin session; mutations also pass the CSRF checks. */
export const onRequest: PagesFunction<{ admin?: string; role?: Role }> = async (ctx) => {
  const gate = await adminGate(ctx.request, ctx.env);
  if (gate instanceof Response) return gate;
  ctx.data.admin = gate.address;
  ctx.data.role = gate.role;
  return ctx.next();
};
