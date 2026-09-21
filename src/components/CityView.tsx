"use client";

import { buildingFaces, isoPoint, layoutCity, TILE_H, TILE_W } from "@/lib/city";
import type { CityBuilder } from "@/lib/city";

/**
 * The builders of one cell, as an isometric block.
 *
 *   HEIGHT    = verified progress — what they actually shipped
 *   FOOTPRINT = market volume     — how much was bet about them
 *
 * The two are independent on purpose. A tall narrow tower is a quiet grinder
 * nobody bets on — exactly the builder the commons exists to fund. A wide flat
 * slab is an attention magnet that has delivered nothing. Showing both at once
 * makes the decoupling visible instead of asserted.
 *
 * Fake 3D: flat SVG polygons on a 2:1 isometric grid. Three faces per box,
 * painted back-to-front because SVG has no depth buffer. No WebGL — a 3D
 * runtime to draw a few dozen boxes would outweigh the rest of the page.
 */
export function CityView({
  builders,
  selectedId,
  onSelect,
}: {
  builders: CityBuilder[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}) {
  const maxProgress = builders.reduce((m, b) => Math.max(m, b.lifetimeProgress), 0);
  const plots = layoutCity(builders, maxProgress);

  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(builders.length, 1))));
  const rows = Math.ceil(Math.max(builders.length, 1) / cols);

  // Bounds: widest at the two side corners, tallest allowing for the roofs.
  // Generous horizontal padding keeps the canvas wide rather than tall, so the
  // SVG is not magnified to fit its container — which would blow up the labels
  // and stroke widths along with it.
  const padX = TILE_W * 2.5;
  // Derived, not guessed: the viewBox must clear the TALLEST building plus its
  // labels, or the roof and the id spill out of the panel (overflow is visible
  // so that hover strokes are not clipped). A fixed value silently breaks the
  // moment one builder pulls ahead.
  const tallest = plots.reduce((m, p) => Math.max(m, p.height), 0);
  const padTop = tallest + 46;
  const padBottom = TILE_H * 2;
  const minX = -((rows - 1) * TILE_W) / 2 - padX;
  const maxX = ((cols - 1) * TILE_W) / 2 + padX;
  const maxY = ((cols - 1 + rows - 1) * TILE_H) / 2 + padBottom;
  const width = maxX - minX;
  const height = maxY + padTop;

  // Ground tiles, drawn under everything as a surveyed plot.
  const ground: string[] = [];
  for (let gx = -1; gx <= cols; gx++) {
    for (let gy = -1; gy <= rows; gy++) {
      const [cx, cy] = isoPoint(gx, gy);
      ground.push(
        `${cx},${cy - TILE_H / 2} ${cx + TILE_W / 2},${cy} ${cx},${cy + TILE_H / 2} ${cx - TILE_W / 2},${cy}`,
      );
    }
  }

  return (
    <figure className="city-figure">
      <svg
        viewBox={`${minX} ${-padTop} ${width} ${height}`}
        className="city-svg"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Isometric view of ${builders.length} builders; height is verified progress, footprint is market volume`}
      >
        <g className="city-ground">
          {ground.map((pts, i) => (
            <polygon key={i} points={pts} />
          ))}
        </g>

        {plots.map((p) => {
          const f = buildingFaces(p.gx, p.gy, p.footprint, p.height);
          const [cx, cy] = isoPoint(p.gx, p.gy);
          const isSelected = selectedId === p.builderId;
          return (
            <g
              key={p.builderId}
              className="city-building"
              data-selected={isSelected ? "true" : undefined}
              onClick={() => onSelect(isSelected ? null : p.builderId)}
              tabIndex={0}
              role="button"
              aria-label={`Builder ${p.builderId}, ${p.lifetimeProgress} progress`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(isSelected ? null : p.builderId);
                }
              }}
            >
              {/* Contact shadow so the box sits on the ground rather than floating. */}
              <ellipse
                cx={cx}
                cy={cy + 2}
                rx={(TILE_W / 2) * p.footprint * 0.9}
                ry={(TILE_H / 2) * p.footprint * 0.9}
                className="city-shadow"
              />
              <polygon points={f.left} className="city-face-left" />
              <polygon points={f.right} className="city-face-right" />
              <polygon points={f.top} className="city-face-top" />
              <text x={cx} y={cy - p.height - 20} textAnchor="middle" className="city-label">
                #{p.builderId}
              </text>
              {isSelected && (
                <text x={cx} y={cy - p.height - 32} textAnchor="middle" className="city-sublabel">
                  {p.lifetimeProgress} progress
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <figcaption className="city-caption">
        <span>height — verified progress</span>
        <span>footprint — market volume</span>
      </figcaption>
    </figure>
  );
}
