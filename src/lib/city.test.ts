import { describe, it, expect } from "vitest";
import {
  buildingFaces,
  footprintFor,
  heightFor,
  isoPoint,
  layoutCity,
  TILE_H,
  TILE_W,
} from "./city";
import type { CityBuilder } from "./city";

const b = (id: number, progress: number, volume: bigint): CityBuilder => ({
  builderId: id,
  address: `0x${id}`,
  lifetimeProgress: progress,
  volume,
});

describe("isoPoint", () => {
  it("puts the grid origin at the screen origin", () => {
    expect(isoPoint(0, 0)).toEqual([0, 0]);
  });

  it("moves +x down-right and +y down-left", () => {
    const [x1, y1] = isoPoint(1, 0);
    const [x2, y2] = isoPoint(0, 1);
    expect(x1).toBeGreaterThan(0);
    expect(x2).toBeLessThan(0);
    expect(y1).toBeGreaterThan(0);
    expect(y2).toBeGreaterThan(0);
  });

  it("uses a 2:1 isometric ratio", () => {
    expect(TILE_W / TILE_H).toBe(2);
  });
});

describe("heightFor", () => {
  it("is zero for no progress", () => {
    expect(heightFor(0, 100)).toBe(0);
  });

  it("is tallest for the leading builder", () => {
    expect(heightFor(100, 100)).toBeGreaterThan(heightFor(50, 100));
  });

  it("compresses so one huge builder does not flatten the rest", () => {
    // Linear would make 10-of-100 a tenth as tall as the leader. A sqrt curve
    // must lift it well clear of that.
    const lead = heightFor(100, 100);
    expect(heightFor(10, 100)).toBeGreaterThan(lead * 0.2);
  });

  it("never returns a negative height", () => {
    expect(heightFor(-5, 100)).toBe(0);
  });
});

describe("footprintFor", () => {
  it("gives a visible minimum even at zero volume", () => {
    expect(footprintFor(0n, 100n)).toBeGreaterThan(0);
  });

  it("grows with volume but stays capped", () => {
    const small = footprintFor(1n, 1000n);
    const big = footprintFor(1000n, 1000n);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThanOrEqual(1);
  });

  it("handles a zero maximum without dividing by zero", () => {
    expect(Number.isFinite(footprintFor(0n, 0n))).toBe(true);
  });
});

describe("buildingFaces", () => {
  it("emits three closed polygons", () => {
    const f = buildingFaces(0, 0, 1, 40);
    for (const side of [f.top, f.left, f.right]) {
      expect(side.split(" ").length).toBeGreaterThanOrEqual(4);
    }
  });

  it("puts the roof above the base", () => {
    const tall = buildingFaces(0, 0, 1, 80);
    const short = buildingFaces(0, 0, 1, 10);
    const roofY = (s: string) => Math.min(...s.split(" ").map((p) => Number(p.split(",")[1])));
    expect(roofY(tall.top)).toBeLessThan(roofY(short.top));
  });
});

describe("layoutCity", () => {
  it("returns one plot per builder", () => {
    expect(layoutCity([b(1, 5, 10n), b(2, 3, 20n)], 100)).toHaveLength(2);
  });

  it("orders plots back-to-front so near buildings paint over far ones", () => {
    const plots = layoutCity([b(1, 1, 1n), b(2, 1, 1n), b(3, 1, 1n), b(4, 1, 1n)], 100);
    const depth = plots.map((p) => p.gx + p.gy);
    expect([...depth].sort((a, z) => a - z)).toEqual(depth);
  });

  it("gives every builder a distinct plot", () => {
    const plots = layoutCity([b(1, 1, 1n), b(2, 1, 1n), b(3, 1, 1n)], 100);
    const keys = new Set(plots.map((p) => `${p.gx}:${p.gy}`));
    expect(keys.size).toBe(3);
  });

  it("returns nothing for an empty city", () => {
    expect(layoutCity([], 100)).toEqual([]);
  });
});

import { facePoint, windowGrid } from "./city";

describe("facePoint", () => {
  it("maps the face's own corners to the box corners", () => {
    // u=0,v=0 is the base of the left edge; u=1,v=0 the base of the right edge.
    const a = facePoint("left", 0, 0, 0, 0, 1, 40);
    const b = facePoint("left", 0, 0, 1, 0, 1, 40);
    expect(a).not.toEqual(b);
  });

  it("raises the point as v increases", () => {
    const low = facePoint("left", 0, 0, 0.5, 0, 1, 40);
    const high = facePoint("left", 0, 0, 0.5, 1, 1, 40);
    expect(high[1]).toBeLessThan(low[1]);
  });

  it("puts the left and right faces on opposite sides of the centre", () => {
    const l = facePoint("left", 0, 0, 0.5, 0.5, 1, 40);
    const r = facePoint("right", 0, 0, 0.5, 0.5, 1, 40);
    expect(l[0]).toBeLessThan(r[0]);
  });
});

describe("windowGrid", () => {
  const plot = { gx: 0, gy: 0, footprint: 1, height: 100, builderId: 7 };

  it("is deterministic for a given builder", () => {
    const a = windowGrid(plot);
    const b = windowGrid(plot);
    expect(a.map((w) => w.lit)).toEqual(b.map((w) => w.lit));
  });

  it("differs between builders", () => {
    const other = windowGrid({ ...plot, builderId: 8 });
    const mine = windowGrid(plot);
    expect(other.map((w) => w.lit).join("")).not.toBe(mine.map((w) => w.lit).join(""));
  });

  it("puts more windows on a taller building", () => {
    const tall = windowGrid({ ...plot, height: 160 });
    const short = windowGrid({ ...plot, height: 30 });
    expect(tall.length).toBeGreaterThan(short.length);
  });

  it("emits none for a building with no height", () => {
    expect(windowGrid({ ...plot, height: 0 })).toEqual([]);
  });

  it("emits closed polygons on both faces", () => {
    const g = windowGrid(plot);
    expect(g.some((w) => w.face === "left")).toBe(true);
    expect(g.some((w) => w.face === "right")).toBe(true);
    expect(g[0].points.split(" ")).toHaveLength(4);
  });

  it("lights some windows but not all", () => {
    const g = windowGrid(plot);
    const litCount = g.filter((w) => w.lit).length;
    expect(litCount).toBeGreaterThan(0);
    expect(litCount).toBeLessThan(g.length);
  });
});
