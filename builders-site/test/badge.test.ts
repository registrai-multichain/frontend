import { describe, expect, test } from "vitest";
import { genericBadgePath, handleBadge, parseBadgePath } from "../lib/badge";
import type { Env } from "../lib/env";
import { MemoryKV } from "./memory-kv";

const ORIGIN = "https://builder.registrai.cc";

/** Pages' ASSETS: only the files listed exist. */
function assets(files: Record<string, string>) {
  const asked: string[] = [];
  const env: Env = {
    INVITES: new MemoryKV(),
    ASSETS: {
      async fetch(input) {
        const url = new URL(typeof input === "string" ? input : input.url);
        asked.push(url.pathname);
        const body = files[url.pathname];
        return body === undefined
          ? new Response("404", { status: 404 })
          : new Response(body, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=14400" } });
      },
    },
  };
  return { env, asked };
}

const get = (path: string, method = "GET") => new Request(`${ORIGIN}${path}`, { method });

describe("badge art fallback", () => {
  const files = {
    "/badge/arc/1.jpg": "one",
    "/badge/arc/1-lapsed.jpg": "one-lapsed",
    "/badge/arc/badge-generic.jpg": "generic",
    "/badge/arc/badge-generic-lapsed.jpg": "generic-lapsed",
    "/badge/arc/card.jpg": "card",
  };

  test("a rendered serial is the static file, untouched", async () => {
    const { env } = assets(files);
    const res = await handleBadge(get("/badge/arc/1.jpg"), env);
    expect(await res.text()).toBe("one");
    expect(res.headers.get("x-registrai-badge")).toBeNull();
    expect(await (await handleBadge(get("/badge/arc/1-lapsed.jpg"), env)).text()).toBe("one-lapsed");
  });

  test("a serial past the rendered ones gets the generic picture (lapsed too), briefly cached", async () => {
    const { env, asked } = assets(files);
    const res = await handleBadge(get("/badge/arc/77.jpg"), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("generic");
    expect(res.headers.get("x-registrai-badge")).toBe("generic");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(asked).toEqual(["/badge/arc/77.jpg", "/badge/arc/badge-generic.jpg"]);
    expect(await (await handleBadge(get("/badge/arc/77-lapsed.jpg"), env)).text()).toBe("generic-lapsed");
    const head = await handleBadge(get("/badge/arc/78.jpg", "HEAD"), env);
    expect([head.status, head.body]).toEqual([200, null]);
  });

  test("anything else under /badge/ is the static answer as it is (never the generic picture)", async () => {
    const { env } = assets(files);
    expect(await (await handleBadge(get("/badge/arc/card.jpg"), env)).text()).toBe("card");
    for (const p of ["/badge/arc/0.jpg", "/badge/arc/007.jpg", "/badge/arc/x.jpg", "/badge/arc/5.png", "/badge/mars/5.jpg", "/badge/arc/5-lapsed-lapsed.jpg"]) {
      expect((await handleBadge(get(p), env)).status, p).toBe(404);
    }
  });

  test("no generic file deployed: the 404 stands; no ASSETS binding: 404", async () => {
    const { env } = assets({ "/badge/arc/1.jpg": "one" });
    expect((await handleBadge(get("/badge/arc/9.jpg"), env)).status).toBe(404);
    expect((await handleBadge(get("/badge/arc/9.jpg"), { INVITES: new MemoryKV() })).status).toBe(404);
  });

  test("parseBadgePath / genericBadgePath", () => {
    expect(parseBadgePath("/badge/arc/12.jpg")).toEqual({ net: "arc", serial: 12, lapsed: false });
    expect(parseBadgePath("/badge/arc-testnet/3-lapsed.jpg")).toEqual({ net: "arc-testnet", serial: 3, lapsed: true });
    expect(parseBadgePath("/badge/arc/badge-generic.jpg")).toBeNull();
    expect(parseBadgePath("/badge/arc/1234567890.jpg")).toBeNull();
    expect(genericBadgePath("arc", true)).toBe("/badge/arc/badge-generic-lapsed.jpg");
  });
});
