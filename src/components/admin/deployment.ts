import type { AdminDeployment } from "@/lib/admin-sections";
import { BUILDERS } from "@/lib/builders-network";
import { NOMINATIONS } from "@/lib/nominations";
import { WONDER_ON_BUILDERS } from "@/lib/wonder";

/** What is deployed on the builders network: a section with nothing to act on stays out of the admin rail. */
export const ADMIN_DEPLOYMENT: AdminDeployment = {
  registry: Boolean(BUILDERS.contracts.BuilderRegistry),
  nominations: Boolean(NOMINATIONS),
  wonder: Boolean(WONDER_ON_BUILDERS),
};
