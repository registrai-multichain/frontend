/**
 * Project the world once, at build time, into plain SVG path strings.
 *
 *   npx tsx scripts/build-world.ts
 *
 * The alternative — shipping d3-geo, topojson-client and a TopoJSON blob to the
 * browser and projecting on every page load — costs ~150KB of JS and a frame of
 * work to draw something that never changes. Country borders are static data.
 * So this runs once and emits `src/lib/world-paths.json`, and the component
 * renders `<path d={...}>` with no map library at runtime at all.
 *
 * Projection is Equal Earth (Šavrič, Patterson & Jenny 2018): equal-area, so a
 * country's drawn size is proportional to its real area. That matters for a
 * choropleth — Mercator would inflate Greenland and Russia into the loudest
 * things on a map about builder density, which would be a lie told in geometry.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { geoEqualEarth, geoPath, geoGraticule10 } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";

// topojson-specification is not published on npm; the shape we touch is small,
// so it is declared locally rather than pulling a types-only dependency.
type TopoLike = { objects: Record<string, unknown> };

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Canvas the paths are projected into. The component scales via viewBox. */
const WIDTH = 960;
const HEIGHT = 480;

/**
 * ISO 3166-1 numeric → alpha-2. world-atlas carries Natural Earth's numeric
 * ids; `builder-meta.json` is keyed by alpha-2 because a human maintains it by
 * hand and "DE" is legible where "276" is not.
 */
const NUMERIC_TO_ALPHA2: Record<string, string> = Object.fromEntries(
  `004:AF 008:AL 012:DZ 024:AO 032:AR 036:AU 040:AT 031:AZ 044:BS 050:BD 051:AM 052:BB 056:BE 064:BT 068:BO 070:BA 072:BW 076:BR 084:BZ 090:SB 096:BN 100:BG 104:MM 108:BI 112:BY 116:KH 120:CM 124:CA 140:CF 144:LK 148:TD 152:CL 156:CN 170:CO 178:CG 180:CD 188:CR 191:HR 192:CU 196:CY 203:CZ 204:BJ 208:DK 214:DO 218:EC 222:SV 226:GQ 231:ET 232:ER 233:EE 242:FJ 246:FI 250:FR 260:TF 262:DJ 266:GA 268:GE 270:GM 275:PS 276:DE 288:GH 300:GR 304:GL 320:GT 324:GN 328:GY 332:HT 340:HN 348:HU 352:IS 356:IN 360:ID 364:IR 368:IQ 372:IE 376:IL 380:IT 384:CI 388:JM 392:JP 398:KZ 400:JO 404:KE 408:KP 410:KR 414:KW 417:KG 418:LA 422:LB 426:LS 428:LV 430:LR 434:LY 440:LT 442:LU 450:MG 454:MW 458:MY 466:ML 478:MR 484:MX 496:MN 498:MD 499:ME 504:MA 508:MZ 512:OM 516:NA 524:NP 528:NL 540:NC 548:VU 554:NZ 558:NI 562:NE 566:NG 578:NO 586:PK 591:PA 598:PG 600:PY 604:PE 608:PH 616:PL 620:PT 624:GW 626:TL 630:PR 634:QA 642:RO 643:RU 646:RW 682:SA 686:SN 688:RS 694:SL 703:SK 705:SI 706:SO 710:ZA 716:ZW 724:ES 728:SS 729:SD 740:SR 748:SZ 752:SE 756:CH 760:SY 762:TJ 764:TH 768:TG 780:TT 784:AE 788:TN 792:TR 795:TM 800:UG 804:UA 807:MK 818:EG 826:GB 834:TZ 840:US 854:BF 858:UY 860:UZ 862:VE 704:VN 887:YE 894:ZM`
    .split(/\s+/)
    .map((pair) => {
      const [num, a2] = pair.split(":");
      return [num, a2];
    }),
);

type CountryPath = {
  iso2: string | null;
  name: string;
  d: string;
  /** Projected centroid — drives marker placement and the west-to-east reveal. */
  c: [number, number];
};

function main(): void {
  const topo = JSON.parse(
    readFileSync(resolve(__dirname, "../node_modules/world-atlas/countries-110m.json"), "utf8"),
  ) as TopoLike;

  const countries = feature(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    topo as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    topo.objects.countries as any,
  ) as unknown as FeatureCollection<Geometry, { name: string }>;

  const projection = geoEqualEarth().fitSize([WIDTH, HEIGHT], { type: "Sphere" });
  // Integer coordinates. At a 960px canvas 1px is below the visible threshold
  // for country outlines, and it cuts the shipped JSON substantially — this
  // file is imported into the bundle, so its size is page weight.
  const path = geoPath(projection).digits(0);

  const out: CountryPath[] = [];
  for (const f of countries.features) {
    const d = path(f);
    if (!d) continue;
    const [cx, cy] = path.centroid(f);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    out.push({
      iso2: NUMERIC_TO_ALPHA2[String(f.id).padStart(3, "0")] ?? null,
      name: f.properties?.name ?? "",
      d,
      c: [Math.round(cx), Math.round(cy)],
    });
  }

  const world = {
    width: WIDTH,
    height: HEIGHT,
    projection: "equalEarth",
    sphere: path({ type: "Sphere" }) ?? "",
    graticule: path(geoGraticule10()) ?? "",
    countries: out,
  };

  const target = resolve(__dirname, "../src/lib/world-paths.json");
  writeFileSync(target, JSON.stringify(world));
  const kb = (JSON.stringify(world).length / 1024).toFixed(0);
  const mapped = out.filter((c) => c.iso2).length;
  console.log(`wrote ${target}`);
  console.log(`  ${out.length} countries (${mapped} with an alpha-2 code), ${kb}KB`);
}

main();
