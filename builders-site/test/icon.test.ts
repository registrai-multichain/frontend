import { describe, expect, test } from "vitest";
import { ICON_CACHE_S, ICON_MISS_CACHE_S, handleIcon, iconApiSource } from "../lib/icon";

const ORIGIN = "https://builder.registrai.cc";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class MemCache {
  store = new Map<string, Response>();
  async match(req: Request) {
    return this.store.get(req.url)?.clone();
  }
  async put(req: Request, res: Response) {
    this.store.set(req.url, res);
  }
}

describe("/api/icon", () => {
  test("domain sources only", () => {
    expect(iconApiSource(`${ORIGIN}/api/icon?source=domain:Registrai.CC`)).toBe("domain:registrai.cc");
    expect(iconApiSource(`${ORIGIN}/api/icon?source=github:acme/tool`)).toBeNull();
    expect(iconApiSource(`${ORIGIN}/api/icon?source=domain:localhost`)).toBeNull();
    expect(iconApiSource(`${ORIGIN}/api/icon`)).toBeNull();
  });

  test("an icon: its sniffed type, a day of cache, never runnable; cached under the canonical source only", async () => {
    const cache = new MemCache();
    let calls = 0;
    const find = async () => {
      calls++;
      return { bytes: PNG, type: "image/png" as const, url: "https://registrai.cc/apple-touch-icon.png" };
    };
    const res = await handleIcon(new Request(`${ORIGIN}/api/icon?source=domain:registrai.cc&x=1`), { find, cache: cache as unknown as Cache });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe(`public, max-age=${ICON_CACHE_S}`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    const again = await handleIcon(new Request(`${ORIGIN}/api/icon?source=domain:REGISTRAI.cc&y=2`), { find, cache: cache as unknown as Cache });
    expect(again.status).toBe(200);
    expect(calls).toBe(1);
  });

  test("no icon: 404 cached an hour (the page shows the initial); a bad source is 400", async () => {
    const res = await handleIcon(new Request(`${ORIGIN}/api/icon?source=domain:acme.dev`), { find: async () => null, cache: null });
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe(`public, max-age=${ICON_MISS_CACHE_S}`);
    expect((await handleIcon(new Request(`${ORIGIN}/api/icon?source=github:a/b`), { cache: null })).status).toBe(400);
  });
});
