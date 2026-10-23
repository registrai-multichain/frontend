import { describe, expect, test } from "vitest";
import { findXAvatar, xAvatarUrl } from "./site-icon";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const ok = (bytes: Uint8Array, status = 200) => new Response(bytes as unknown as BodyInit, { status });

describe("X profile picture as the fallback icon", () => {
  test("the URL: unavatar's X route for a clean handle, no generic fallback image", () => {
    expect(xAvatarUrl("@Arguspad")).toBe("https://unavatar.io/x/Arguspad?fallback=false");
    expect(xAvatarUrl("obrainarc")).toBe("https://unavatar.io/x/obrainarc?fallback=false");
    expect(xAvatarUrl("@not a handle")).toBeNull();
    expect(xAvatarUrl("@toolonghandle_12345")).toBeNull();
    expect(xAvatarUrl("")).toBeNull();
  });
  test("an image comes back with its sniffed type", async () => {
    const seen: string[] = [];
    const r = await findXAvatar("@Arguspad", { fetchImpl: (async (u: string) => { seen.push(u); return ok(JPEG); }) as unknown as typeof fetch });
    expect(r?.type).toBe("image/jpeg");
    expect(seen).toEqual(["https://unavatar.io/x/Arguspad?fallback=false"]);
  });
  test("not an image, a 404, or a bad handle: null", async () => {
    const html = new TextEncoder().encode("<html>nope</html>");
    expect(await findXAvatar("@a", { fetchImpl: (async () => ok(html)) as unknown as typeof fetch })).toBeNull();
    expect(await findXAvatar("@a", { fetchImpl: (async () => ok(JPEG, 404)) as unknown as typeof fetch })).toBeNull();
    expect(await findXAvatar("@bad handle", { fetchImpl: (async () => { throw new Error("not called"); }) as unknown as typeof fetch })).toBeNull();
  });
});
