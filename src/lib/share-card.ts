/**
 * The X share card: a 9:4 image a builder posts to announce their Verified
 * Builder Badge. Off-chain only, drawn in the browser on top of
 * `/badge/<network>/card.jpg` (1881x836, scripts/render-badges.py bakes the
 * network label in). Everything here is pure except drawShareCard, which only
 * talks to the 2D context it is handed, so the geometry is unit-testable with a
 * fake context.
 *
 * Coordinates are card pixels, from the approved prototype (drawn with Pillow,
 * whose text origin is the font's ascender line). Canvas "top" is the em box,
 * which sits higher, so text is placed on its alphabetic baseline instead:
 * baseline = top + ASCENT x size, ASCENT being JetBrains Mono's hhea ascender.
 */
import { builderDeepLink, serialDigits, serialLabel } from "./verified-builder-badge";
import { sourceLabel } from "./verified-builders";

export const CARD_W = 1881;
export const CARD_H = 836;

const INK = "rgb(236,232,220)";
/** JetBrains Mono ascender / em (1020/1000). */
export const ASCENT = 1.02;

/** Alphabetic baseline of text whose ascender line is at `top`. */
export function baselineFor(top: number, size: number): number {
  return Math.round((top + ASCENT * size) * 10) / 10;
}
const DIM = "rgb(150,148,140)";

export const CARD_LAYOUT = {
  /** The square slot: "NO." over the serial, a lime rule under it. */
  slotCenterX: 706,
  no: { top: 285, size: 30, weight: 500, tracking: 10, color: DIM },
  serial: { top: 318, size: 150, weight: 700, color: INK },
  rule: { x0: 640, x1: 772, y: 520, width: 4, color: "#d7ff56" },
  /** The wide slot: project name, then the source line. */
  name: { left: 1012, top: 352, start: 64, min: 28, step: 2, maxWidth: 700, weight: 700, color: INK },
  sub: { left: 1014, top: 440, size: 24, weight: 500, color: DIM },
} as const;

/** `github:owner/repo` -> "owner/repo"; `domain:host` -> "host". */
export function projectName(source: string | null | undefined, builderId?: number): string {
  if (source) return sourceLabel(source);
  return builderId !== undefined ? `Builder #${builderId}` : "";
}

/** Unix seconds -> "YYYY-MM-DD" (UTC), "" when unknown. */
export function isoDay(unixSeconds: number): string {
  return unixSeconds > 0 ? new Date(unixSeconds * 1000).toISOString().slice(0, 10) : "";
}

/** "GITHUB · BUILDER #3 · VERIFIED 2026-09-24" (DOMAIN for domain sources). */
export function subLine(source: string | null | undefined, builderId: number, issuedAt: number): string {
  const kind = source?.startsWith("domain:") ? "DOMAIN" : "GITHUB";
  const day = isoDay(issuedAt);
  return `${kind} · BUILDER #${builderId} · VERIFIED${day ? ` ${day}` : ""}`;
}

/** A canvas font shorthand: `700 150px <family>`. */
export function cardFont(weight: number, size: number, family: string): string {
  return `${weight} ${size}px ${family}`;
}

/**
 * The largest name size that fits: start at 64px and shrink in 2px steps until
 * the measured width is within 700px, never below 28px. `widthAt(size)` measures
 * the name at that size.
 */
export function fitNameSize(
  widthAt: (size: number) => number,
  o: { start: number; min: number; step: number; maxWidth: number } = CARD_LAYOUT.name,
): number {
  let size = o.start;
  while (size > o.min && widthAt(size) > o.maxWidth) size -= o.step;
  return Math.max(size, o.min);
}

/** Top of a name set at `size`, kept vertically centred on the 64px line. */
export function nameTop(size: number): number {
  return CARD_LAYOUT.name.top + (CARD_LAYOUT.name.start - size) / 2;
}

/**
 * Left edge of each glyph of a letter-spaced run centred on `centerX`.
 * Tracking goes between glyphs only, so the run's ink stays centred.
 */
export function trackedStarts(widths: number[], tracking: number, centerX: number): number[] {
  const total = widths.reduce((s, w) => s + w, 0) + tracking * Math.max(0, widths.length - 1);
  const out: number[] = [];
  let x = centerX - total / 2;
  for (const w of widths) {
    out.push(x);
    x += w + tracking;
  }
  return out;
}

export interface ShareCardData {
  serial: number;
  builderId: number;
  source: string | null;
  /** Unix seconds (VerifiedBuilderBadge.issuedAt). */
  issuedAt: number;
}

/** The 2D-context surface drawShareCard uses (a CanvasRenderingContext2D satisfies it). */
export type CardContext = Pick<
  CanvasRenderingContext2D,
  "font" | "fillStyle" | "strokeStyle" | "lineWidth" | "lineCap" | "textAlign" | "textBaseline"
  | "fillText" | "measureText" | "beginPath" | "moveTo" | "lineTo" | "stroke"
> & { drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void };

/** Paint the card: background, then the square slot, then the wide slot. */
export function drawShareCard(ctx: CardContext, background: CanvasImageSource, d: ShareCardData, family: string): void {
  const L = CARD_LAYOUT;
  ctx.drawImage(background, 0, 0, CARD_W, CARD_H);
  ctx.textBaseline = "alphabetic";

  // "NO." — letter-spaced by hand (canvas letterSpacing is not everywhere yet).
  ctx.textAlign = "left";
  ctx.font = cardFont(L.no.weight, L.no.size, family);
  ctx.fillStyle = L.no.color;
  const glyphs = [..."NO."];
  const starts = trackedStarts(glyphs.map((g) => ctx.measureText(g).width), L.no.tracking, L.slotCenterX);
  glyphs.forEach((g, i) => ctx.fillText(g, starts[i], baselineFor(L.no.top, L.no.size)));

  // The serial, three digits, centred.
  ctx.textAlign = "center";
  ctx.font = cardFont(L.serial.weight, L.serial.size, family);
  ctx.fillStyle = L.serial.color;
  ctx.fillText(serialDigits(d.serial), L.slotCenterX, baselineFor(L.serial.top, L.serial.size));

  ctx.beginPath();
  ctx.strokeStyle = L.rule.color;
  ctx.lineWidth = L.rule.width;
  ctx.lineCap = "butt";
  ctx.moveTo(L.rule.x0, L.rule.y);
  ctx.lineTo(L.rule.x1, L.rule.y);
  ctx.stroke();

  // Project name, shrunk to fit the slot.
  ctx.textAlign = "left";
  const name = projectName(d.source, d.builderId);
  const size = fitNameSize((s) => {
    ctx.font = cardFont(L.name.weight, s, family);
    return ctx.measureText(name).width;
  });
  ctx.font = cardFont(L.name.weight, size, family);
  ctx.fillStyle = L.name.color;
  ctx.fillText(name, L.name.left, baselineFor(nameTop(size), size));

  ctx.font = cardFont(L.sub.weight, L.sub.size, family);
  ctx.fillStyle = L.sub.color;
  ctx.fillText(subLine(d.source, d.builderId, d.issuedAt), L.sub.left, baselineFor(L.sub.top, L.sub.size));
}

/** The post text; X attaches `url` itself. */
export function shareText(serial: number, source: string | null, builderId: number): string {
  return `I'm Registrai Verified Builder ${serialLabel(serial)} — ${projectName(source, builderId)} on Arc.`;
}

/** X's web intent. The image cannot ride along: the builder attaches the downloaded card. */
export function xIntentUrl(d: Pick<ShareCardData, "serial" | "source" | "builderId">): string {
  const q = new URLSearchParams({ text: shareText(d.serial, d.source, d.builderId), url: builderDeepLink(d.builderId) });
  return `https://x.com/intent/post?${q.toString()}`;
}

export function cardFileName(serial: number): string {
  return `registrai-verified-builder-${serialDigits(serial)}.png`;
}
