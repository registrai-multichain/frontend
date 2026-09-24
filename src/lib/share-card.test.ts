import { describe, expect, test } from "vitest";
import {
  CARD_H,
  CARD_LAYOUT,
  CARD_W,
  cardFileName,
  drawShareCard,
  fitNameSize,
  nameTop,
  baselineFor,
  projectName,
  shareText,
  subLine,
  trackedStarts,
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

  test("post text and X intent", () => {
    expect(shareText(7, "github:acme/tool", 3)).toBe("I'm Registrai Verified Builder No. 007 — acme/tool on Arc.");
    const u = new URL(xIntentUrl({ serial: 7, source: "github:acme/tool", builderId: 3 }));
    expect(u.origin + u.pathname).toBe("https://x.com/intent/post");
    expect(u.searchParams.get("text")).toBe("I'm Registrai Verified Builder No. 007 — acme/tool on Arc.");
    expect(u.searchParams.get("url")).toBe("https://registrai.cc/perennial/?builder=3");
    expect(cardFileName(7)).toBe("registrai-verified-builder-007.png");
  });
});

describe("geometry", () => {
  test("name shrinks in 2px steps until it fits 700px, never below 28px", () => {
    // monospace-ish: 0.6em per glyph
    const w = (chars: number) => (size: number) => chars * size * 0.6;
    expect(fitNameSize(w(10))).toBe(64); // 384px fits at once
    expect(fitNameSize(w(20))).toBe(58); // 64: 768, 62: 744, 60: 720, 58: 696
    expect(fitNameSize(w(200))).toBe(28); // never fits: floor
    const seen: number[] = [];
    fitNameSize((s) => (seen.push(s), s > 60 ? 999 : 0));
    expect(seen).toEqual([64, 62, 60]);
  });

  test("baselines sit one ascender below the prototype's text tops", () => {
    expect(baselineFor(318, 150)).toBe(471);
    expect(baselineFor(352, 64)).toBe(417.3);
  });

  test("a shrunk name stays centred on the 64px line", () => {
    expect(nameTop(64)).toBe(352);
    expect(nameTop(58)).toBe(355);
    expect(nameTop(28)).toBe(370);
  });

  test("tracked run is centred, tracking only between glyphs", () => {
    const xs = trackedStarts([18, 18, 18], 10, 706);
    // total 18*3 + 10*2 = 74 -> starts at 706 - 37
    expect(xs).toEqual([669, 697, 725]);
    expect(xs[2] + 18 - 706).toBe(706 - xs[0]);
    expect(trackedStarts([], 10, 706)).toEqual([]);
  });
});

describe("drawShareCard", () => {
  type Call = { op: string; args: unknown[]; font?: string; fill?: unknown; align?: string; baseline?: string };
  function fakeCtx(): { ctx: CardContext; calls: Call[] } {
    const calls: Call[] = [];
    const state = { font: "", fillStyle: "" as unknown, strokeStyle: "" as unknown, lineWidth: 0, lineCap: "", textAlign: "", textBaseline: "" };
    const ctx = {
      ...state,
      measureText(text: string) {
        const size = Number(/(\d+)px/.exec(this.font)?.[1] ?? 0);
        return { width: text.length * size * 0.6 } as TextMetrics;
      },
      fillText(text: string, x: number, y: number) {
        calls.push({ op: "fillText", args: [text, x, y], font: this.font, fill: this.fillStyle, align: this.textAlign, baseline: this.textBaseline });
      },
      drawImage: (...args: unknown[]) => calls.push({ op: "drawImage", args }),
      beginPath: () => calls.push({ op: "beginPath", args: [] }),
      moveTo: (...args: unknown[]) => calls.push({ op: "moveTo", args }),
      lineTo: (...args: unknown[]) => calls.push({ op: "lineTo", args }),
      stroke() { calls.push({ op: "stroke", args: [], fill: this.strokeStyle, font: String(this.lineWidth) }); },
    };
    return { ctx: ctx as unknown as CardContext, calls };
  }

  test("paints the approved layout", () => {
    const { ctx, calls } = fakeCtx();
    const bg = {} as CanvasImageSource;
    const issuedAt = Date.UTC(2026, 8, 24) / 1000;
    drawShareCard(ctx, bg, { serial: 7, builderId: 3, source: "github:registrai-multichain/oracle-primitives", issuedAt }, "MONO");

    expect(calls[0]).toEqual({ op: "drawImage", args: [bg, 0, 0, CARD_W, CARD_H] });
    const texts = calls.filter((c) => c.op === "fillText");
    expect(texts.every((c) => c.baseline === "alphabetic")).toBe(true);

    // "NO." glyph by glyph, 30px Medium, 10px tracking, centred on 706
    const no = texts.slice(0, 3);
    expect(no.map((c) => c.args[0])).toEqual(["N", "O", "."]);
    expect(no.every((c) => c.font === "500 30px MONO" && c.args[2] === 315.6 && c.fill === "rgb(150,148,140)")).toBe(true);
    expect(no.map((c) => c.args[1])).toEqual([706 - 37, 706 - 37 + 28, 706 - 37 + 56]);

    const serial = texts[3];
    expect(serial).toMatchObject({ args: ["007", 706, 471], font: "700 150px MONO", align: "center", fill: "rgb(236,232,220)" });

    expect(calls.find((c) => c.op === "moveTo")?.args).toEqual([640, 520]);
    expect(calls.find((c) => c.op === "lineTo")?.args).toEqual([772, 520]);
    expect(calls.find((c) => c.op === "stroke")).toMatchObject({ fill: "#d7ff56", font: "4" });

    // 38 chars at 0.6em: 64px is 1459px wide; 30px (684px) is the first size that fits
    const name = texts[4];
    expect(name.args[0]).toBe("registrai-multichain/oracle-primitives");
    expect(name.font).toBe("700 30px MONO");
    expect(name.args.slice(1)).toEqual([1012, 399.6]);
    expect(name.align).toBe("left");

    expect(texts[5]).toMatchObject({ args: ["GITHUB · BUILDER #3 · VERIFIED 2026-09-24", 1014, 464.5], font: "500 24px MONO", fill: "rgb(150,148,140)" });
    expect(CARD_LAYOUT.name.maxWidth).toBe(700);
  });
});
