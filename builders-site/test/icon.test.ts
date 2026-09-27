import { describe, expect, test } from "vitest";
import { ICON_CACHE_S, ICON_MISS_CACHE_S, handleIcon, iconApiSource } from "../lib/icon";

const ORIGIN = "https://builder.registrai.cc";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

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

  test("no site icon: the project's X picture (from its invite) stands in, cached a day", async () => {
    const asked: string[] = [];
    const res = await handleIcon(new Request(`${ORIGIN}/api/icon?source=domain:argus.world`), {
      find: async () => null,
      xHandleOf: async (s) => (s === "domain:argus.world" ? "@Arguspad" : null),
      findX: async (h) => {
        asked.push(h);
        return { bytes: JPEG, type: "image/jpeg" as const, url: "https://unavatar.io/x/Arguspad" };
      },
      cache: null,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe(`public, max-age=${ICON_CACHE_S}`);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(asked).toEqual(["@Arguspad"]);
  });

  test("the site's own icon wins: X is not asked", async () => {
    let asked = false;
    const res = await handleIcon(new Request(`${ORIGIN}/api/icon?source=domain:kairo.market`), {
      find: async () => ({ bytes: PNG, type: "image/png" as const, url: "https://kairo.market/favicon.png" }),
      xHandleOf: async () => "@kairo_market",
      findX: async () => {
        asked = true;
        return null;
      },
      cache: null,
    });
    expect(res.status).toBe(200);
    expect(asked).toBe(false);
  });

  test("no site icon and no X handle, or no X picture: 404 (the initial shows)", async () => {
    const none = await handleIcon(new Request(`${ORIGIN}/api/icon?source=domain:acme.dev`), { find: async () => null, xHandleOf: async () => null, findX: async () => { throw new Error("not called"); }, cache: null });
    expect(none.status).toBe(404);
    const miss = await handleIcon(new Request(`${ORIGIN}/api/icon?source=domain:acme.dev`), { find: async () => null, xHandleOf: async () => "@acme", findX: async () => null, cache: null });
    expect(miss.status).toBe(404);
  });

  test("a failing handle lookup degrades to 404, never a 500", async () => {
    const res = await handleIcon(new Request(`${ORIGIN}/api/icon?source=domain:acme.dev`), { find: async () => null, xHandleOf: async () => { throw new Error("kv down"); }, cache: null });
    expect(res.status).toBe(404);
  });
});
