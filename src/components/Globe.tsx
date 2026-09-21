"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { geoOrthographic, geoPath, geoGraticule10, geoContains, geoCentroid } from "d3-geo";
import type { GeoPermissibleObjects } from "d3-geo";
import geo from "@/lib/world-geo.json";
import { densityBucket } from "@/lib/atlas";
import type { CountryCell } from "@/lib/atlas";

type Feature = {
  id: string | null;
  properties: { name: string };
  geometry: { type: string; coordinates: unknown };
};

const FEATURES = (geo as unknown as { features: Feature[] }).features;

/** Degrees of longitude per second while idling. Slow enough to read. */
const SPIN_PER_SEC = 4;
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 6;

/**
 * Interactive globe. Drag to spin, wheel or pinch to zoom, click a lit country
 * to select it; it idles with a slow rotation and stops the moment you touch it.
 *
 * Canvas rather than SVG: an orthographic projection has to be recomputed for
 * all 177 countries on every frame, and mutating that many DOM nodes at 60fps
 * is exactly what canvas exists to avoid.
 *
 * Colours are read from CSS custom properties at draw time rather than hardcoded,
 * so the globe follows the theme instead of having its own private palette.
 */
export function Globe({
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Mutable render state. Deliberately refs, not state: these change every
  // frame and re-rendering React 60 times a second to move a globe would be
  // absurd. React only owns the selection.
  const rotation = useRef<[number, number]>([-20, -15]);
  const zoom = useRef(1);
  const dragging = useRef(false);
  const dragged = useRef(false);
  const lastPointer = useRef<[number, number]>([0, 0]);
  const idle = useRef(true);
  /** Rotation we are easing toward after a selection, or null when settled. */
  const target = useRef<[number, number] | null>(null);

  const [hovered, setHovered] = useState<string | null>(null);
  // Mirrored into refs so the animation loop can read current values without
  // being torn down and rebuilt on every prop change. Synced in an effect, not
  // during render: mutating a ref while rendering is a React rule violation and
  // can leave the loop reading a value the committed tree never had.
  const cellsRef = useRef(cells);
  const selectedRef = useRef(selected);
  const hoveredRef = useRef(hovered);
  useEffect(() => {
    cellsRef.current = cells;
    selectedRef.current = selected;
    hoveredRef.current = hovered;
  }, [cells, selected, hovered]);

  // Turn the globe to face whatever was just selected. Without this the country
  // you clicked can sit on the limb — or rotate off the back entirely — while
  // the panel beside it claims to describe it.
  useEffect(() => {
    if (!selected) {
      target.current = null;
      return;
    }
    const f = FEATURES.find((x) => x.id === selected);
    if (!f) return;
    const [lon, lat] = geoCentroid(f as unknown as GeoPermissibleObjects);
    // geoOrthographic().rotate() takes the NEGATED centre, so this brings the
    // country's centroid to the middle of the disc.
    target.current = [-lon, -lat];
  }, [selected]);

  /** Screen point -> country, via the projection's inverse. */
  const countryAt = useCallback((px: number, py: number): Feature | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    const projection = geoOrthographic()
      .translate([rect.width / 2, rect.height / 2])
      .scale((size / 2 - 2) * zoom.current)
      .rotate([rotation.current[0], rotation.current[1], 0]);
    const inverted = projection.invert?.([px, py]);
    if (!inverted || Number.isNaN(inverted[0])) return null;
    for (const f of FEATURES) {
      if (geoContains(f as unknown as GeoPermissibleObjects, inverted)) return f;
    }
    return null;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const styles = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;

    const palette = {
      ocean: v("--globe-ocean", "#151513"),
      land: v("--globe-land", "#2a2a26"),
      border: v("--globe-border", "#3d3d37"),
      grat: v("--globe-graticule", "#26261f"),
      halo: v("--globe-halo", "#ff5a1f"),
      accent: v("--globe-accent", "#ff5a1f"),
      lit: [
        v("--globe-lit-0", "#3f5a43"),
        v("--globe-lit-1", "#4e7a52"),
        v("--globe-lit-2", "#6aa463"),
        v("--globe-lit-3", "#96cf62"),
        v("--globe-lit-4", "#c9ff3d"),
      ],
    };

    let frame = 0;
    let last = performance.now();
    const graticule = geoGraticule10();

    const draw = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;

      if (target.current && !dragging.current) {
        const [tx, ty] = target.current;
        // Take the short way round: +170 -> -170 is 20 degrees, not 340.
        const dLon = ((((tx - rotation.current[0]) % 360) + 540) % 360) - 180;
        const dLat = ty - rotation.current[1];
        if (reduceMotion || (Math.abs(dLon) < 0.25 && Math.abs(dLat) < 0.25)) {
          rotation.current = [tx, ty];
          target.current = null;
        } else {
          // Frame-rate independent ease, so the flight takes the same time on a
          // 120Hz display as on a 60Hz one.
          const k = 1 - Math.pow(0.0015, dt);
          rotation.current[0] += dLon * k;
          rotation.current[1] += dLat * k;
        }
      } else if (idle.current && !dragging.current && !reduceMotion && !selectedRef.current) {
        // Hold still while a country is selected — otherwise the thing the panel
        // is describing quietly drifts off the visible face.
        rotation.current[0] = (rotation.current[0] + SPIN_PER_SEC * dt) % 360;
      }

      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = rect.width;
      const h = rect.height;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const size = Math.min(w, h);
      const radius = (size / 2 - 2) * zoom.current;
      const projection = geoOrthographic()
        .translate([w / 2, h / 2])
        .scale(radius)
        .rotate([rotation.current[0], rotation.current[1], 0]);
      const path = geoPath(projection, ctx);

      // Ocean disc.
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.fillStyle = palette.ocean;
      ctx.fill();

      // Graticule under the land, like printed guide lines on a globe.
      ctx.beginPath();
      path(graticule);
      ctx.strokeStyle = palette.grat;
      ctx.lineWidth = 0.5;
      ctx.stroke();

      const byIso = new Map(cellsRef.current.map((c) => [c.code, c]));
      for (const f of FEATURES) {
        const cell = f.id ? byIso.get(f.id) : undefined;
        ctx.beginPath();
        path(f as unknown as GeoPermissibleObjects);
        ctx.fillStyle = cell
          ? palette.lit[densityBucket(cell.builders, max)]
          : palette.land;
        ctx.fill();
        const isActive = !!cell && (selectedRef.current === cell.code || hoveredRef.current === f.id);
        ctx.strokeStyle = isActive ? palette.accent : palette.border;
        ctx.lineWidth = isActive ? 1.6 : 0.4;
        ctx.stroke();
      }

      // Limb: a thin ring so the sphere reads as a solid body, not a flat disc.
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.strokeStyle = palette.halo;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [max]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragging.current = true;
    dragged.current = false;
    idle.current = false;
    target.current = null; // grabbing the globe overrides a fly-to in progress
    lastPointer.current = [e.clientX, e.clientY];
    // Drop the readout for the duration of the drag. The globe moves under the
    // cursor while hit-testing is suspended, so keeping the old label would
    // caption whatever country has rotated into that spot with the wrong name.
    setHovered(null);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      const f = countryAt(e.clientX - rect.left, e.clientY - rect.top);
      setHovered(f?.id ?? null);
      return;
    }
    const [lx, ly] = lastPointer.current;
    const dx = e.clientX - lx;
    const dy = e.clientY - ly;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragged.current = true;
    lastPointer.current = [e.clientX, e.clientY];
    // Scale drag by zoom so a spin feels the same however far in you are.
    const k = 0.25 / zoom.current;
    rotation.current[0] += dx * k;
    // Clamp tilt so the globe cannot be rolled upside down.
    rotation.current[1] = Math.max(-90, Math.min(90, rotation.current[1] - dy * k));
  };

  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const under = countryAt(e.clientX - rect.left, e.clientY - rect.top);
    if (dragging.current && !dragged.current) {
      const code = under?.id ?? null;
      const known = code && cells.some((c) => c.code === code);
      onSelect(known && selected !== code ? code : null);
    }
    dragging.current = false;
    // Re-label for wherever the globe came to rest, so the readout is correct
    // again the moment the user lets go rather than on their next movement.
    setHovered(under?.id ?? null);
    // Resume idle spin shortly after the user lets go.
    window.setTimeout(() => {
      if (!dragging.current) idle.current = true;
    }, 2500);
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    zoom.current = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom.current * (e.deltaY < 0 ? 1.12 : 0.89)));
    idle.current = false;
    window.setTimeout(() => {
      if (!dragging.current) idle.current = true;
    }, 2500);
  };

  const hoveredName = hovered ? FEATURES.find((f) => f.id === hovered)?.properties.name : null;
  const hoveredCell = hovered ? cells.find((c) => c.code === hovered) : undefined;

  return (
    <figure className="globe-figure">
      <div className="globe-stage" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="globe-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={() => {
            dragging.current = false;
            setHovered(null);
          }}
          onWheel={onWheel}
          role="img"
          aria-label={`Rotatable globe, ${cells.length} countries with registered builders`}
        />
        {hoveredName && (
          <div className="globe-readout">
            <span className="globe-readout-name">{hoveredName}</span>
            {hoveredCell && (
              <span className="globe-readout-stat">
                {hoveredCell.builders} builder{hoveredCell.builders === 1 ? "" : "s"} ·{" "}
                {hoveredCell.progress} progress
              </span>
            )}
          </div>
        )}
      </div>
      <figcaption className="globe-caption">
        <span>drag to spin · scroll to zoom · click a lit country</span>
        <span className="globe-scale" aria-hidden>
          {[0, 1, 2, 3, 4].map((b) => (
            <i key={b} data-density={b} />
          ))}
          <em>denser</em>
        </span>
      </figcaption>
    </figure>
  );
}
