import { ECOSYSTEM } from "../../src/lib/arc-ecosystem-data";
import { entityHref } from "../../src/lib/arc-ecosystem";
import { idToPath } from "./apps-data";

/** Where an index member's page is: its ecosystem entity page when an entry claims the id, else its /apps page. */
export const appHref = (id: string): string => {
  const e = ECOSYSTEM.byIndexId.get(id);
  return e ? entityHref(e.slug) : idToPath(id) ?? "/apps/";
};
