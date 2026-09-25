import { describe, expect, test } from "vitest";
import {
  CARD_H,
  CARD_LAYOUT,
  CARD_W,
  cardFileName,
  coverCrop,
  defaultPictureUrl,
  drawShareCard,
  fitSize,
  frameOutline,
  initialOf,
  projectName,
  shareText,
  subLine,
  tagText,
  xIntentUrl,
  type CardContext,
} from "./share-card";

describe("text", () => {
  test("project name from the source", () => {
    expect(projectName("github:acme/tool")).toBe("acme/tool");
    expect(projectName("domain:app.example.org")).toBe("app.example.org");
    expect(projectName(null, 4)).toBe("Builder #4");
  });

  test("sub-line: kind, builder id, issue date (UTC)", () => {
    // 2026-09-24T23:30:00Z — still the 24th in UTC
    const t = Date.UTC(2026, 8, 24, 23, 30) / 1000;
    expect(subLine("github:acme/tool", 3, t)).toBe("GITHUB · BUILDER #3 · VERIFIED 2026-09-24");
    expect(subLine("domain:app.example.org", 12, t)).toBe("DOMAIN · BUILDER #12 · VERIFIED 2026-09-24");
    expect(subLine("github:acme/tool", 3, 0)).toBe("GITHUB · BUILDER #3 · VERIFIED");
  });

  test("serial tag, picture default, initial", () => {
    expect(tagText(7)).toBe("#007");
    expect(tagText(1234)).toBe("#1234");
    expect(defaultPictureUrl("github:acme/tool")).toBe("https://avatars.githubusercontent.com/acme?size=400");
    expect(defaultPictureUrl("domain:acme.xyz")).toBe("/api/icon?source=domain%3Aacme.xyz");
    expect(defaultPictureUrl(null)).toBeNull();
    expect(defaultPictureUrl(null)).toBeNull();
    expect(initialOf("github:acme/tool", 3)).toBe("A");
    expect(initialOf("domain:9lives.io", 3)).toBe("9");
    expect(initialOf(null, 3)).toBe("B");
  });

  test("post text and X intent", () => {
    expect(shareText(7, "github:acme/tool", 3)).toBe("I'm Registrai Verified Builder No. 007 — acme/tool on Arc.");
    const u = new URL(xIntentUrl({ serial: 7, source: "github:acme/tool", builderId: 3 }));
    expect(u.origin + u.pathname).toBe("https://x.com/intent/post");
    expect(u.searchParams.get("text")).toBe("I'm Registrai Verified Builder No. 007 — acme/tool on Arc.");
    expect(u.searchParams.get("url")).toBe("https://builder.registrai.cc/builders/?builder=3");
    expect(cardFileName(7)).toBe("registrai-verified-builder-007.png");
  });
});

describe("geometry", () => {
  test("text shrinks in steps until it fits, never below min", () => {
    const w = (chars: number) => (size: number) => chars * size * 0.6; // 0.6em per glyph
    const o = CARD_LAYOUT.name;
    expect(fitSize(w(10), o)).toBe(56); // 336px fits at once
    expect(fitSize(w(25), o)).toBe(52); // 56: 840, 54: 810, 52: 780
    expect(fitSize(w(200), o)).toBe(28); // never fits: floor
    expect(fitSize(w(4), CARD_LAYOUT.tag)).toBe(36); // "#007": 86px
    expect(fitSize(w(5), CARD_LAYOUT.tag)).toBe(36); // "#1234": 108px fits at 36
    expect(fitSize(w(6), CARD_LAYOUT.tag)).toBe(34); // "#12345": 130px at 36, 122px at 34
  });

  test("the name never runs under the serial tag", () => {
    const { name, tag } = CARD_LAYOUT;
    expect(name.left + name.maxWidth).toBeLessThan(tag.cx - tag.maxWidth / 2 - 20);
  });

  test("cover crop takes the centred square", () => {
    expect(coverCrop(400, 400)).toEqual({ sx: 0, sy: 0, s: 400 });
    expect(coverCrop(800, 400)).toEqual({ sx: 200, sy: 0, s: 400 });
    expect(coverCrop(300, 500)).toEqual({ sx: 0, sy: 100, s: 300 });
  });

  test("frame outline is the picture square with cut corners", () => {
    const pts = frameOutline({ x: 0, y: 0, size: 100, cut: 10 });
    expect(pts).toHaveLength(8);
    expect(pts[0]).toEqual([10, 0]);
    expect(pts[3]).toEqual([100, 90]);
    expect(pts.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100)).toBe(true);
  });
});

describe("drawShareCard", () => {
  type Call = { op: string; args: unknown[]; font?: string; fill?: unknown; align?: string; baseline?: string };
  function fakeCtx(): { ctx: CardContext; calls: Call[] } {
    const calls: Call[] = [];
    const state = { font: "", fillStyle: "" as unknown, textAlign: "", textBaseline: "" };
    const rec = (op: string) => (...args: unknown[]) => calls.push({ op, args });
    const ctx = {
      ...state,
      measureText(text: string) {
        const size = Number(/(\d+)px/.exec(this.font)?.[1] ?? 0);
        return { width: text.length * size * 0.6 } as TextMetrics;
      },
      fillText(text: string, x: number, y: number) {
        calls.push({ op: "fillText", args: [text, x, y], font: this.font, fill: this.fillStyle, align: this.textAlign, baseline: this.textBaseline });
      },
      drawImage: rec("drawImage"),
      beginPath: rec("beginPath"),
      moveTo: rec("moveTo"),
      lineTo: rec("lineTo"),
      closePath: rec("closePath"),
      clip: rec("clip"),
      save: rec("save"),
      restore: rec("restore"),
    };
    return { ctx: ctx as unknown as CardContext, calls };
  }
  const issuedAt = Date.UTC(2026, 8, 24) / 1000;

  test("paints the approved layout with a picture", () => {
    const { ctx, calls } = fakeCtx();
    const bg = {} as CanvasImageSource;
    const img = {} as CanvasImageSource;
    drawShareCard(ctx, bg, { serial: 7, builderId: 3, source: "github:registrai-multichain/oracle-primitives", issuedAt, picture: { image: img, width: 460, height: 400 } }, "MONO");

    expect(calls[0]).toEqual({ op: "drawImage", args: [bg, 0, 0, CARD_W, CARD_H] });
    // picture: clipped, centre-cropped into the frame
    const ops = calls.map((c) => c.op);
    expect(ops.indexOf("save")).toBeLessThan(ops.indexOf("clip"));
    expect(ops.indexOf("clip")).toBeLessThan(ops.lastIndexOf("drawImage"));
    expect(ops.lastIndexOf("drawImage")).toBeLessThan(ops.indexOf("restore"));
    const p = CARD_LAYOUT.picture;
    expect(calls.filter((c) => c.op === "drawImage")[1].args).toEqual([img, 30, 0, 400, 400, p.x, p.y, p.size, p.size]);

    const texts = calls.filter((c) => c.op === "fillText");
    expect(texts.every((c) => c.baseline === "alphabetic")).toBe(true);
    expect(texts[0]).toMatchObject({ args: ["#007", 1582, 446], font: "700 36px MONO", align: "center", fill: "rgb(217,240,67)" });
    // 38 chars at 0.6em: 56px is 1277px; 34px (775px) is the first size within 780
    expect(texts[1]).toMatchObject({ args: ["registrai-multichain/oracle-primitives", 676, 497], font: "700 34px MONO", align: "left", fill: "rgb(236,232,220)" });
    expect(texts[2]).toMatchObject({ args: ["GITHUB · BUILDER #3 · VERIFIED 2026-09-24", 678, 533], font: "500 22px MONO", fill: "rgb(150,148,140)" });
  });

  test("without a picture the project initial fills the frame", () => {
    const { ctx, calls } = fakeCtx();
    drawShareCard(ctx, {} as CanvasImageSource, { serial: 12, builderId: 9, source: "domain:acme.xyz", issuedAt }, "MONO");
    expect(calls.some((c) => c.op === "clip")).toBe(false);
    const p = CARD_LAYOUT.picture;
    const first = calls.find((c) => c.op === "fillText")!;
    expect(first).toMatchObject({ font: "700 110px MONO", align: "center" });
    expect(first.args.slice(0, 2)).toEqual(["A", p.x + p.size / 2]);
  });
});
