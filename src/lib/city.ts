/**
 * Isometric city geometry. Pure maths, no React, no DOM — so the projection and
 * scaling rules are testable without rendering anything.
 *
 * Two axes carry the whole thesis:
 *   HEIGHT    = verified progress — what the builder actually shipped
 *   FOOTPRINT = market volume     — how much was bet about them
 *
 * They are deliberately independent, which is the point. A tall narrow tower is
 * a quiet grinder nobody bets on; a wide flat slab is an attention magnet that
 * has delivered nothing. Seeing both at once is the argument the prose makes.
 *
 * Drawn as flat SVG polygons rather than real 3D: a WebGL runtime to render
 * a few dozen boxes would dwarf the entire rest of the page.
 */

export type CityBuilder = {
  builderId: number;
  address: string;
  lifetimeProgress: number;
  volume: bigint;
};

export type Plot = CityBuilder & {
  gx: number;
  gy: number;
  /** 0..1 — scales the tile the building sits on. */
  footprint: number;
  /** Screen pixels from the plot's base to its roof. */
  height: number;
};

/** 2:1 isometric — the classic ratio, and the one that reads as a city rather than a chart. */
export const TILE_W = 64;
export const TILE_H = 32;

/**
 * Tallest a building may stand, in grid units.
 *
 * Kept near 2x the tile width: taller than that and a leading builder becomes a
 * needle on a postage-stamp canvas, which forces the whole SVG to scale up and
 * magnifies every label with it.
 */
const MAX_HEIGHT = 118;
/** Floor so a builder with no progress is still a visible plot, not nothing. */
const MIN_HEIGHT = 0;

export function isoPoint(gx: number, gy: number, tileW = TILE_W, tileH = TILE_H): [number, number] {
  return [((gx - gy) * tileW) / 2, ((gx + gy) * tileH) / 2];
}

/**
 * Height from progress, square-rooted.
 *
 * Linear would make an early leader tower absurdly over everyone else and flatten
 * the rest into the ground — the same failure the map's density curve avoids.
 * sqrt keeps the leader clearly tallest while leaving the field legible.
 */
export function heightFor(progress: number, maxProgress: number): number {
  if (progress <= 0 || maxProgress <= 0) return MIN_HEIGHT;
  const ratio = Math.min(progress / maxProgress, 1);
  return MIN_HEIGHT + Math.sqrt(ratio) * (MAX_HEIGHT - MIN_HEIGHT);
}

/**
 * Footprint from volume, 0..1, capped.
 *
 * Capped deliberately: one whale market must not eat the block. Volume is not
 * merit — it says how much was wagered, not how much was delivered — so the
 * footprint is kept visually subordinate to height.
 */
export function footprintFor(volume: bigint, maxVolume: bigint): number {
  const MIN = 0.45;
  if (maxVolume <= 0n || volume <= 0n) return MIN;
  const ratio = Number(volume) / Number(maxVolume);
  return MIN + Math.min(Math.sqrt(ratio), 1) * (1 - MIN);
}

/**
 * The three visible faces of a box on the isometric grid, as SVG polygon
 * point strings. A cube shows exactly three faces; drawing the hidden ones
 * would only cost bytes.
 */
export function buildingFaces(
  gx: number,
  gy: number,
  footprint: number,
  height: number,
): { top: string; left: string; right: string } {
  const w = (TILE_W / 2) * footprint;
  const h = (TILE_H / 2) * footprint;
  const [cx, cy] = isoPoint(gx, gy);

  // Base diamond, clockwise from the north corner.
  const n: [number, number] = [cx, cy - h];
  const e: [number, number] = [cx + w, cy];
  const s: [number, number] = [cx, cy + h];
  const wst: [number, number] = [cx - w, cy];

  const up = ([x, y]: [number, number]): [number, number] => [x, y - height];
  const pts = (...p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  return {
    top: pts(up(n), up(e), up(s), up(wst)),
    left: pts(wst, s, up(s), up(wst)),
    right: pts(s, e, up(e), up(s)),
  };
}

/**
 * Place builders on a square-ish grid and sort back-to-front.
 *
 * Isometric has no depth buffer — later paints cover earlier ones — so plots
 * must be emitted in increasing (gx + gy) order or near buildings will be
 * overdrawn by far ones. Tallest first into the back rows, so the skyline
 * steps down toward the viewer instead of hiding behind itself.
 */
export function layoutCity(builders: CityBuilder[], maxProgress: number): Plot[] {
  if (builders.length === 0) return [];

  const cols = Math.max(1, Math.ceil(Math.sqrt(builders.length)));
  const maxVolume = builders.reduce((m, b) => (b.volume > m ? b.volume : m), 0n);
  const tallestFirst = [...builders].sort((a, b) => b.lifetimeProgress - a.lifetimeProgress);

  const plots = tallestFirst.map((b, i) => {
    const gx = i % cols;
    const gy = Math.floor(i / cols);
    return {
      ...b,
      gx,
      gy,
      footprint: footprintFor(b.volume, maxVolume),
      height: heightFor(b.lifetimeProgress, maxProgress),
    };
  });

  return plots.sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
}

/* ── pixel-art facades ──────────────────────────────────────────────────── */

export type Face = "left" | "right";

/**
 * A point on one vertical face of an isometric box, in face coordinates:
 * `u` runs 0..1 along the base edge, `v` runs 0..1 from ground to roof.
 *
 * The faces are parallelograms, not rectangles, so anything drawn on them has
 * to be sheared to match or it floats off the surface.
 */
export function facePoint(
  face: Face,
  gx: number,
  gy: number,
  u: number,
  v: number,
  footprint: number,
  height: number,
): [number, number] {
  const w = (TILE_W / 2) * footprint;
  const h = (TILE_H / 2) * footprint;
  const [cx, cy] = isoPoint(gx, gy);

  // left: west corner -> south corner. right: south corner -> east corner.
  const [x, y] =
    face === "left"
      ? [cx - w + u * w, cy + u * h]
      : [cx + u * w, cy + h - u * h];

  return [x, y - v * height];
}

/**
 * Deterministic PRNG (mulberry32).
 *
 * Deliberately not Math.random(): the facades are generated during render, and
 * a random pattern would differ between the server and client passes and blow
 * up hydration. Seeded on builderId, every builder gets a stable building.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type WindowCell = { face: Face; points: string; lit: boolean };

/** Floor height in grid units — sets how chunky the pixel grid reads. */
const FLOOR_H = 13;

/**
 * Window grid for one building: rows of lit and unlit cells on both visible
 * faces, sheared onto the isometric planes.
 *
 * Lighting is seeded per builder so a building looks the same on every render
 * and every machine, and so two builders never look identical.
 */
export function windowGrid(plot: {
  gx: number;
  gy: number;
  footprint: number;
  height: number;
  builderId: number;
}): WindowCell[] {
  const { gx, gy, footprint, height, builderId } = plot;
  if (height <= FLOOR_H) return [];

  const floors = Math.max(1, Math.floor(height / FLOOR_H) - 1);
  const cols = Math.max(2, Math.round(2 + footprint * 2));
  const rnd = mulberry32(builderId * 2654435761);

  const cells: WindowCell[] = [];
  // Inset so windows sit inside the facade rather than bleeding over its edges.
  const padU = 0.16;
  const usable = 1 - padU * 2;
  const cellU = usable / cols;
  const winU = cellU * 0.62;
  const winV = (FLOOR_H * 0.46) / height;

  for (const face of ["left", "right"] as Face[]) {
    for (let f = 0; f < floors; f++) {
      // Start one floor up so there is a solid base course.
      const v0 = ((f + 1) * FLOOR_H) / height;
      if (v0 + winV > 0.94) continue;
      for (let c = 0; c < cols; c++) {
        const u0 = padU + c * cellU + (cellU - winU) / 2;
        const pts = [
          facePoint(face, gx, gy, u0, v0, footprint, height),
          facePoint(face, gx, gy, u0 + winU, v0, footprint, height),
          facePoint(face, gx, gy, u0 + winU, v0 + winV, footprint, height),
          facePoint(face, gx, gy, u0, v0 + winV, footprint, height),
        ];
        cells.push({
          face,
          points: pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "),
          // Roughly a third lit: enough to read as occupied, sparse enough that
          // the facade still reads as a grid rather than a solid block.
          lit: rnd() < 0.34,
        });
      }
    }
  }
  return cells;
}
