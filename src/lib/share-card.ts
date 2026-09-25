/**
 * The X share card: a 9:4 image a builder posts to announce their Verified
 * Builder Badge. Off-chain only, drawn in the browser on top of
 * `/badge/<network>/card.jpg` (1881x836, scripts/render-badges.py bakes the
 * network label in and clears the art's sample "#001"). Everything here is
 * pure except drawShareCard, which only talks to the 2D context it is handed,
 * so the geometry is unit-testable with a fake context.
 *
 * Layout (card pixels, measured from the art): the builder's picture in the
 * square frame, the project name and source line on the wide bar under it, and
 * the serial in the lime tag on the bar's top-right corner. Text sits on
 * alphabetic baselines.
 */
import { builderDeepLink, serialDigits, serialLabel } from "./verified-builder-badge";
import { sourceLabel } from "./verified-builders";
import { siteIconPath } from "./site-icon";

export const CARD_W = 1881;
export const CARD_H = 836;

const INK = "rgb(236,232,220)";
const DIM = "rgb(150,148,140)";
const LIME = "rgb(217,240,67)";

export const CARD_LAYOUT = {
  /** Inside the square frame; corners cut like the frame's. */
  picture: { x: 938, y: 228, size: 184, cut: 22 },
  /** Initial shown when the builder has no picture. */
  initial: { size: 110, weight: 700, color: INK },
  /** The serial tag, "#007", centred in the tag and shrunk to its width. */
  tag: { cx: 1582, baseline: 446, start: 36, min: 20, step: 2, maxWidth: 124, weight: 700, color: LIME },
  /** The wide bar: project name over the source line, clear of the tag. */
  name: { left: 676, baseline: 497, start: 56, min: 28, step: 2, maxWidth: 780, weight: 700, color: INK },
  sub: { left: 678, baseline: 533, size: 22, weight: 500, color: DIM },
} as const;

/** `github:owner/repo` -> "owner/repo"; `domain:host` -> "host". */
export function projectName(source: string | null | undefined, builderId?: number): string {
  if (source) return sourceLabel(source);
  return builderId !== undefined ? `Builder #${builderId}` : "";
}

/**
 * The card's default picture: the GitHub owner's avatar (CORS-enabled), or a
 * domain's site icon through this site's /api/icon (same origin); either way
 * the canvas stays exportable.
 */
export function defaultPictureUrl(source: string | null | undefined): string | null {
  const m = /^github:([^/]+)\//.exec(source ?? "");
  if (m) return `https://avatars.githubusercontent.com/${encodeURIComponent(m[1])}?size=400`;
  return source && source.startsWith("domain:") ? siteIconPath(source) : null;
}

/** First letter of the project, for a builder without a picture. */
export function initialOf(source: string | null | undefined, builderId: number): string {
  const name = projectName(source, builderId);
  const ch = /[a-z0-9]/i.exec(name)?.[0];
  return (ch ?? "R").toUpperCase();
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

/** "#007" */
export const tagText = (serial: number) => `#${serialDigits(serial)}`;

/** A canvas font shorthand: `700 56px <family>`. */
export function cardFont(weight: number, size: number, family: string): string {
  return `${weight} ${size}px ${family}`;
}

/**
 * The largest size that fits: start big and shrink in steps until the measured
 * width is within maxWidth, never below min. `widthAt(size)` measures the text.
 */
export function fitSize(
  widthAt: (size: number) => number,
  o: { start: number; min: number; step: number; maxWidth: number },
): number {
  let size = o.start;
  while (size > o.min && widthAt(size) > o.maxWidth) size -= o.step;
  return Math.max(size, o.min);
}

/** Source rectangle that covers a square target (centre crop). */
export function coverCrop(w: number, h: number): { sx: number; sy: number; s: number } {
  const s = Math.min(w, h);
  return { sx: (w - s) / 2, sy: (h - s) / 2, s };
}

/** The picture frame's outline: a square with its corners cut. */
export function frameOutline(p: { x: number; y: number; size: number; cut: number } = CARD_LAYOUT.picture): [number, number][] {
  const { x, y, size: s, cut: c } = p;
  return [
    [x + c, y], [x + s - c, y], [x + s, y + c], [x + s, y + s - c],
    [x + s - c, y + s], [x + c, y + s], [x, y + s - c], [x, y + c],
  ];
}

export interface CardPicture {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export interface ShareCardData {
  serial: number;
  builderId: number;
  source: string | null;
  /** Unix seconds (VerifiedBuilderBadge.issuedAt). */
  issuedAt: number;
  /** The builder's picture; the project initial is drawn without one. */
  picture?: CardPicture | null;
}

/** The 2D-context surface drawShareCard uses (a CanvasRenderingContext2D satisfies it). */
export type CardContext = Pick<
  CanvasRenderingContext2D,
  "font" | "fillStyle" | "textAlign" | "textBaseline" | "fillText" | "measureText"
  | "beginPath" | "moveTo" | "lineTo" | "closePath" | "clip" | "save" | "restore"
> & {
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  drawImage(image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
};

/** Paint the card: background, picture, serial tag, then the bar. */
export function drawShareCard(ctx: CardContext, background: CanvasImageSource, d: ShareCardData, family: string): void {
  const L = CARD_LAYOUT;
  ctx.drawImage(background, 0, 0, CARD_W, CARD_H);
  ctx.textBaseline = "alphabetic";

  // Picture, clipped to the frame's cut-corner square.
  const p = L.picture;
  if (d.picture) {
    ctx.save();
    ctx.beginPath();
    frameOutline().forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.clip();
    const c = coverCrop(d.picture.width, d.picture.height);
    ctx.drawImage(d.picture.image, c.sx, c.sy, c.s, c.s, p.x, p.y, p.size, p.size);
    ctx.restore();
  } else {
    ctx.textAlign = "center";
    ctx.font = cardFont(L.initial.weight, L.initial.size, family);
    ctx.fillStyle = L.initial.color;
    // cap height ~0.73em: centre the capital in the frame
    ctx.fillText(initialOf(d.source, d.builderId), p.x + p.size / 2, Math.round(p.y + p.size / 2 + 0.73 * L.initial.size / 2));
  }

  // Serial tag.
  const tag = tagText(d.serial);
  const tagSize = fitSize((s) => {
    ctx.font = cardFont(L.tag.weight, s, family);
    return ctx.measureText(tag).width;
  }, L.tag);
  ctx.textAlign = "center";
  ctx.font = cardFont(L.tag.weight, tagSize, family);
  ctx.fillStyle = L.tag.color;
  ctx.fillText(tag, L.tag.cx, L.tag.baseline);

  // Project name, shrunk to fit left of the tag, then the source line.
  ctx.textAlign = "left";
  const name = projectName(d.source, d.builderId);
  const size = fitSize((s) => {
    ctx.font = cardFont(L.name.weight, s, family);
    return ctx.measureText(name).width;
  }, L.name);
  ctx.font = cardFont(L.name.weight, size, family);
  ctx.fillStyle = L.name.color;
  ctx.fillText(name, L.name.left, L.name.baseline);

  ctx.font = cardFont(L.sub.weight, L.sub.size, family);
  ctx.fillStyle = L.sub.color;
  ctx.fillText(subLine(d.source, d.builderId, d.issuedAt), L.sub.left, L.sub.baseline);
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
