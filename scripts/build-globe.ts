/**
 * Emit unprojected country geometry for the interactive globe.
 *
 *   npx tsx scripts/build-globe.ts
 *
 * The flat map could be projected once at build time because it never moved.
 * A globe the user can spin has to be re-projected every frame, so the browser
 * needs the raw spherical coordinates. topojson-client stays a dev dependency:
 * the decode happens here, and the browser gets plain GeoJSON.
 *
 * Coordinates are rounded to 2dp — about 1km at the equator, far below one
 * pixel at any globe size we render — which roughly halves the payload.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";

const __dirname = dirname(fileURLToPath(import.meta.url));
type TopoLike = { objects: Record<string, unknown> };

const NUMERIC_TO_ALPHA2: Record<string, string> = Object.fromEntries(
  `004:AF 008:AL 012:DZ 024:AO 032:AR 036:AU 040:AT 031:AZ 044:BS 050:BD 051:AM 052:BB 056:BE 064:BT 068:BO 070:BA 072:BW 076:BR 084:BZ 090:SB 096:BN 100:BG 104:MM 108:BI 112:BY 116:KH 120:CM 124:CA 140:CF 144:LK 148:TD 152:CL 156:CN 170:CO 178:CG 180:CD 188:CR 191:HR 192:CU 196:CY 203:CZ 204:BJ 208:DK 214:DO 218:EC 222:SV 226:GQ 231:ET 232:ER 233:EE 242:FJ 246:FI 250:FR 260:TF 262:DJ 266:GA 268:GE 270:GM 275:PS 276:DE 288:GH 300:GR 304:GL 320:GT 324:GN 328:GY 332:HT 340:HN 348:HU 352:IS 356:IN 360:ID 364:IR 368:IQ 372:IE 376:IL 380:IT 384:CI 388:JM 392:JP 398:KZ 400:JO 404:KE 408:KP 410:KR 414:KW 417:KG 418:LA 422:LB 426:LS 428:LV 430:LR 434:LY 440:LT 442:LU 450:MG 454:MW 458:MY 466:ML 478:MR 484:MX 496:MN 498:MD 499:ME 504:MA 508:MZ 512:OM 516:NA 524:NP 528:NL 540:NC 548:VU 554:NZ 558:NI 562:NE 566:NG 578:NO 586:PK 591:PA 598:PG 600:PY 604:PE 608:PH 616:PL 620:PT 624:GW 626:TL 630:PR 634:QA 642:RO 643:RU 646:RW 682:SA 686:SN 688:RS 694:SL 703:SK 705:SI 706:SO 710:ZA 716:ZW 724:ES 728:SS 729:SD 740:SR 748:SZ 752:SE 756:CH 760:SY 762:TJ 764:TH 768:TG 780:TT 784:AE 788:TN 792:TR 795:TM 800:UG 804:UA 807:MK 818:EG 826:GB 834:TZ 840:US 854:BF 858:UY 860:UZ 862:VE 704:VN 887:YE 894:ZM`
    .split(/\s+/)
    .map((p) => p.split(":")),
);

/** Round every coordinate in a nested ring structure. */
function round(coords: unknown): unknown {
  if (typeof coords === "number") return Math.round(coords * 100) / 100;
  if (Array.isArray(coords)) return coords.map(round);
  return coords;
}

function main(): void {
  const topo = JSON.parse(
    readFileSync(resolve(__dirname, "../node_modules/world-atlas/countries-110m.json"), "utf8"),
  ) as TopoLike;

  const fc = feature(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    topo as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    topo.objects.countries as any,
  ) as unknown as FeatureCollection<Geometry, { name: string }>;

  const features = fc.features.map((f) => ({
    type: "Feature" as const,
    id: NUMERIC_TO_ALPHA2[String(f.id).padStart(3, "0")] ?? null,
    properties: { name: f.properties?.name ?? "" },
    geometry: {
      type: f.geometry.type,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      coordinates: round((f.geometry as any).coordinates),
    },
  }));

  const out = { type: "FeatureCollection" as const, features };
  const target = resolve(__dirname, "../src/lib/world-geo.json");
  const json = JSON.stringify(out);
  writeFileSync(target, json);
  console.log(`wrote ${target}`);
  console.log(`  ${features.length} countries, ${(json.length / 1024).toFixed(0)}KB`);
}

main();
