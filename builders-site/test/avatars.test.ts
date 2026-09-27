import { describe, expect, test } from "vitest";
import { ICON_MAX_BYTES } from "../../src/lib/site-icon";
import { avatarCandidates, avatarKey, decodeAvatar, encodeAvatar, getMirroredAvatar } from "../lib/avatars";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("mirrored avatars (KV avatar:<source>)", () => {
  test("key", () => {
    expect(avatarKey("domain:obrain.cloud")).toBe("avatar:domain:obrain.cloud");
  });
  test("round trip: bytes, sniffed type, where it came from", () => {
    const raw = encodeAvatar({ bytes: JPEG, type: "image/jpeg", url: "https://unavatar.io/x/obrainarc?fallback=false" }, "x:@obrainarc", new Date("2026-09-27T20:00:00Z"));
    expect(JSON.parse(raw)).toMatchObject({ type: "image/jpeg", from: "x:@obrainarc", fetchedAt: "2026-09-27T20:00:00.000Z" });
    const back = decodeAvatar(raw);
    expect(back?.type).toBe("image/jpeg");
    expect(back?.bytes).toEqual(JPEG);
  });
  test("refused: over 200 KB, not an image, a type that doesn't match the bytes, junk", () => {
    const big = new Uint8Array(ICON_MAX_BYTES + 1);
    big.set(JPEG);
    expect(() => encodeAvatar({ bytes: big, type: "image/jpeg", url: "" }, "x:@a", new Date())).toThrow(/200 KB|too large/i);
    const notImage = JSON.stringify({ type: "image/png", from: "x:@a", fetchedAt: "", b64: btoa("<html>") });
    expect(decodeAvatar(notImage)).toBeNull();
    const mismatch = encodeAvatar({ bytes: PNG, type: "image/png", url: "" }, "x:@a", new Date()).replace("image/png", "image/jpeg");
    expect(decodeAvatar(mismatch)).toBeNull();
    expect(decodeAvatar("not json")).toBeNull();
    expect(decodeAvatar(null)).toBeNull();
  });
  test("read from KV; a missing or broken record is null", async () => {
    const store = new Map<string, string>([["avatar:domain:obrain.cloud", encodeAvatar({ bytes: JPEG, type: "image/jpeg", url: "" }, "x:@obrainarc", new Date())]]);
    const kv = { get: async (k: string) => store.get(k) ?? null } as never;
    expect((await getMirroredAvatar(kv, "domain:obrain.cloud"))?.type).toBe("image/jpeg");
    expect(await getMirroredAvatar(kv, "domain:argus.world")).toBeNull();
  });
  test("loader candidates: invited domain sources with an X handle, each once", () => {
    expect(
      avatarCandidates([
        { source: "domain:obrain.cloud", x: "@obrainarc" },
        { source: "domain:argus.world", x: "@Arguspad" },
        { source: "github:acme/tool", x: "@acme" },
        { source: "domain:nox.dev" },
        { source: "domain:argus.world", x: "@Arguspad" },
      ]),
    ).toEqual([
      { source: "domain:argus.world", handle: "@Arguspad" },
      { source: "domain:obrain.cloud", handle: "@obrainarc" },
    ]);
  });
});
