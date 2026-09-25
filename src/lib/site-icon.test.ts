import { describe, expect, test } from "vitest";
import { findSiteIcon, iconLinksFromHtml, siteIconPath, sniffImageType } from "./site-icon";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ICO = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

/** A fake web: url (no query) -> response; records every request. */
function web(routes: Record<string, { status?: number; body?: Uint8Array | string; location?: string }>) {
  const seen: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    const r = routes[url];
    if (!r) return new Response("nope", { status: 404 });
    const headers: Record<string, string> = r.location ? { location: r.location } : {};
    return new Response(r.body === undefined ? null : (r.body as BodyInit), { status: r.status ?? 200, headers });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

describe("sniffImageType", () => {
  test("by magic bytes; SVG and HTML are not images here", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(ICO)).toBe("image/x-icon");
    expect(sniffImageType(JPG)).toBe("image/jpeg");
    expect(sniffImageType(new TextEncoder().encode("GIF89a......"))).toBe("image/gif");
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(sniffImageType(SVG)).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("<!doctype html>"))).toBeNull();
  });
});

describe("iconLinksFromHtml", () => {
  test("apple-touch-icon first, then icons by size; SVG, data: and unsafe URLs dropped; relative resolved", () => {
    const html = `
      <link rel="icon" href="/favicon-16.png" sizes="16x16">
      <link rel="icon" type="image/svg+xml" href="/logo.svg">
      <link rel="shortcut icon" href="/icon.svg?v=2">
      <link rel="icon" href='/favicon-192.png' sizes="192x192">
      <link rel="apple-touch-icon" href="https://cdn.acme.dev/touch.png">
      <link rel="icon" href="data:image/png;base64,AAAA">
      <link rel="icon" href="http://acme.dev/insecure.png">
      <link rel="icon" href="https://127.0.0.1/internal.png">
      <link rel="stylesheet" href="/app.css">`;
    expect(iconLinksFromHtml(html, "https://acme.dev/")).toEqual([
      "https://cdn.acme.dev/touch.png",
      "https://acme.dev/favicon-192.png",
      "https://acme.dev/favicon-16.png",
    ]);
  });
});

describe("findSiteIcon", () => {
  test("apple-touch-icon.png wins when it is an image", async () => {
    const w = web({ "https://acme.dev/apple-touch-icon.png": { body: PNG } });
    const icon = await findSiteIcon("domain:acme.dev", { fetchImpl: w.fetchImpl });
    expect(icon).toMatchObject({ type: "image/png", url: "https://acme.dev/apple-touch-icon.png" });
    expect(w.seen).toEqual(["https://acme.dev/apple-touch-icon.png"]);
  });

  test("else the homepage's declared icon, else /favicon.ico", async () => {
    const w = web({
      "https://acme.dev/": { body: '<link rel="icon" href="/img/i.png" sizes="64x64">' },
      "https://acme.dev/img/i.png": { body: JPG },
    });
    expect(await findSiteIcon("domain:acme.dev", { fetchImpl: w.fetchImpl })).toMatchObject({ type: "image/jpeg", url: "https://acme.dev/img/i.png" });
    const ico = web({ "https://acme.dev/": { body: "<html></html>" }, "https://acme.dev/favicon.ico": { body: ICO } });
    expect(await findSiteIcon("domain:acme.dev", { fetchImpl: ico.fetchImpl })).toMatchObject({ type: "image/x-icon" });
  });

  test("a homepage bigger than the cap is still read: the icon links are in its first bytes", async () => {
    const big = `<html><head><link rel="apple-touch-icon" href="/touch.png"></head><body>${"x".repeat(600 * 1024)}</body></html>`;
    const w = web({ "https://acme.dev/": { body: big }, "https://acme.dev/touch.png": { body: PNG } });
    expect(await findSiteIcon("domain:acme.dev", { fetchImpl: w.fetchImpl })).toMatchObject({ url: "https://acme.dev/touch.png" });
  });

  test("an SVG (or HTML) answer is never an icon, whatever its URL says", async () => {
    const w = web({ "https://acme.dev/apple-touch-icon.png": { body: SVG }, "https://acme.dev/favicon.ico": { body: "<html>soft 404</html>" } });
    expect(await findSiteIcon("domain:acme.dev", { fetchImpl: w.fetchImpl })).toBeNull();
  });

  test("redirects: followed to another public https host; never to an internal one or plain http", async () => {
    const ok = web({
      "https://acme.dev/apple-touch-icon.png": { status: 301, location: "https://www.acme.dev/apple-touch-icon.png" },
      "https://www.acme.dev/apple-touch-icon.png": { body: PNG },
    });
    expect(await findSiteIcon("domain:acme.dev", { fetchImpl: ok.fetchImpl })).toMatchObject({ url: "https://www.acme.dev/apple-touch-icon.png" });
    const bad = web({
      "https://acme.dev/apple-touch-icon.png": { status: 302, location: "https://169.254.169.254/latest" },
      "https://acme.dev/favicon.ico": { status: 302, location: "http://acme.dev/favicon.ico" },
    });
    expect(await findSiteIcon("domain:acme.dev", { fetchImpl: bad.fetchImpl })).toBeNull();
    expect(bad.seen.some((u) => u.includes("169.254") || u.startsWith("http://"))).toBe(false);
  });

  test("oversized icons are refused; github and local sources are not fetched at all", async () => {
    const big = web({ "https://acme.dev/apple-touch-icon.png": { body: new Uint8Array(300 * 1024).fill(0x89) } });
    expect(await findSiteIcon("domain:acme.dev", { fetchImpl: big.fetchImpl })).toBeNull();
    const none = web({});
    expect(await findSiteIcon("github:acme/tool", { fetchImpl: none.fetchImpl })).toBeNull();
    expect(await findSiteIcon("domain:localhost", { fetchImpl: none.fetchImpl })).toBeNull();
    expect(none.seen).toEqual([]);
  });

  test("siteIconPath is same-origin", () => {
    expect(siteIconPath("domain:registrai.cc")).toBe("/api/icon?source=domain%3Aregistrai.cc");
  });
});

describe("the Workers runtime", () => {
  test("fetch is never called as a method (workerd throws 'Illegal invocation' for that)", async () => {
    let badThis = false;
    const strict = function (this: unknown, input: RequestInfo | URL) {
      if (this !== undefined && this !== globalThis) badThis = true;
      return Promise.resolve(String(input).endsWith("/apple-touch-icon.png") ? new Response(PNG as unknown as BodyInit) : new Response("x", { status: 404 }));
    } as unknown as typeof fetch;
    expect(await findSiteIcon("domain:acme.dev", { fetchImpl: strict })).toMatchObject({ type: "image/png" });
    expect(badThis).toBe(false);
  });
});
