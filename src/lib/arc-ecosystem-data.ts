import raw from "../data/arc-ecosystem/entities.json";
import { indexEntities, type ArcEntity } from "./arc-ecosystem";

/** The published directory. arc-ecosystem-data.test.ts validates the file, so a bad entry fails the build, never the site. */
export const ECOSYSTEM = indexEntities(raw as unknown as ArcEntity[]);
