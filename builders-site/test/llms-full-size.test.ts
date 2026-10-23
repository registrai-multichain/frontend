import { expect, test, vi } from "vitest";
import { ECOSYSTEM } from "../../src/lib/arc-ecosystem-data";

test("with the real directory: one line per project and under 300 KB", async () => {
  vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
  try {
    const { buildLlmsFull } = await import("../lib/llms-full");
    const t = await buildLlmsFull({ INVITES: { get: async () => null } } as never, { cache: null });
    expect(t.split("\n").filter((l) => l.startsWith("- **")).length).toBe(ECOSYSTEM.entities.length);
    expect(new TextEncoder().encode(t).length).toBeLessThan(300_000);
  } finally { vi.unstubAllGlobals(); }
});
