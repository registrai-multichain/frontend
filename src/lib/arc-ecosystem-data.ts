import raw from "../data/arc-ecosystem/entities.json";
import corrRaw from "../data/arc-ecosystem/corrections.json";
import { indexEntities, type ArcEntity } from "./arc-ecosystem";
import { indexCorrections, type CorrectionEntry } from "./arc-ecosystem-corrections";

/** The published directory. arc-ecosystem-data.test.ts validates the file, so a bad entry fails the build, never the site. */
export const ECOSYSTEM = indexEntities(raw as unknown as ArcEntity[]);
/** The public corrections log (validated in the same test and in the build). */
export const CORRECTIONS = indexCorrections(corrRaw as unknown as CorrectionEntry[]);
