"use client";

import world from "@/lib/world-paths.json";
import { densityBucket } from "@/lib/atlas";
import type { CountryCell } from "@/lib/atlas";

type Country = { iso2: string | null; name: string; d: string; c: [number, number] };

/**
 * The world as an engraving, not a UI widget.
 *
 * Paths are projected at build time (`scripts/build-world.ts`), so nothing here
 * imports a map library — the component only draws strings. Equal Earth is
 * equal-area, so a country's drawn size is proportional to its real size; on a
 * map about where builders are, Mercator would make Greenland and Russia the
 * loudest marks on the page and that would be a lie told in geometry.
 *
 * Teal is the ink. It means the commons everywhere else on this site, so a
 * country soaked in it reads as "builders here draw from the pool".
 *
 * The reveal staggers west-to-east off each country's projected centroid, like
 * ink crossing the sheet. One orchestrated entrance, then stillness — CSS only,
 * because shipping an animation library to move something once would undo the
 * point of projecting at build time.
 */
export function WorldMap({
  cells,
  selected,
  onSelect,
  max,
}: {
  cells: CountryCell[];
  selected: string | null;
  onSelect: (code: string | null) => void;
  max: number;
}) {
  const byIso = new Map(cells.map((c) => [c.code, c]));
  const countries = world.countries as Country[];
  const lit = countries.filter((c) => c.iso2 && byIso.has(c.iso2));

  return (
    <figure className="atlas-figure">
      <svg
        viewBox={`0 0 ${world.width} ${world.height}`}
        className="atlas-map"
        role="img"
        aria-label={`World map, ${lit.length} countries with registered builders`}
      >
        <defs>
          {/* Engraved paper: a faint plate tone under the land so the sheet is
              never flat white, matching the grain on the page behind it. */}
          <radialGradient id="atlas-plate" cx="50%" cy="42%" r="72%">
            <stop offset="0%" stopColor="var(--bg-elev)" />
            <stop offset="100%" stopColor="var(--bg)" />
          </radialGradient>
        </defs>

        <path d={world.sphere} className="atlas-sphere" fill="url(#atlas-plate)" />
        <path d={world.graticule} className="atlas-graticule" />

        <g>
          {countries.map((c, i) => {
            const cell = c.iso2 ? byIso.get(c.iso2) : undefined;
            const bucket = cell ? densityBucket(cell.builders, max) : 0;
            const isSelected = !!cell && selected === cell.code;
            return (
              <path
                key={`${c.iso2 ?? "x"}-${i}`}
                d={c.d}
                className="atlas-country"
                data-lit={cell ? "true" : undefined}
                data-density={cell ? bucket : undefined}
                data-selected={isSelected ? "true" : undefined}
                // Stagger by longitude: 0 at the dateline, ~700ms at the far east.
                style={{ animationDelay: `${Math.round((c.c[0] / world.width) * 700)}ms` }}
                onClick={cell ? () => onSelect(isSelected ? null : cell.code) : undefined}
                tabIndex={cell ? 0 : undefined}
                role={cell ? "button" : undefined}
                aria-label={cell ? `${c.name}, ${cell.builders} builders` : undefined}
                onKeyDown={
                  cell
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelect(isSelected ? null : cell.code);
                        }
                      }
                    : undefined
                }
              />
            );
          })}
        </g>

        {/* Survey marks on lit countries — a crosshair and the code, the way a
            printed chart annotates a station rather than dropping a pin. */}
        <g className="atlas-marks">
          {lit.map((c) => {
            const cell = byIso.get(c.iso2!)!;
            const isSelected = selected === cell.code;
            return (
              <g
                key={c.iso2}
                transform={`translate(${c.c[0]} ${c.c[1]})`}
                data-selected={isSelected ? "true" : undefined}
                className="atlas-mark"
              >
                <circle r="9" className="atlas-mark-ring" />
                <line x1="-13" y1="0" x2="-5" y2="0" className="atlas-mark-tick" />
                <line x1="5" y1="0" x2="13" y2="0" className="atlas-mark-tick" />
                <line x1="0" y1="-13" x2="0" y2="-5" className="atlas-mark-tick" />
                <line x1="0" y1="5" x2="0" y2="13" className="atlas-mark-tick" />
                <text y="-18" textAnchor="middle" className="atlas-mark-label">
                  {c.iso2}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <figcaption className="atlas-caption">
        <span>Equal Earth projection — areas drawn true</span>
        <span className="atlas-scale" aria-hidden>
          {[0, 1, 2, 3, 4].map((b) => (
            <i key={b} data-density={b} />
          ))}
          <em>denser →</em>
        </span>
      </figcaption>
    </figure>
  );
}
