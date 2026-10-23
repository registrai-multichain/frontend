import { describe, expect, test } from "vitest";
import { share7d, shareLabel, shareText } from "../lib/arc-share";

const snap = (day: string, app: number | null, moved: number | null) =>
  ({ generated_at: `${day}T00:02:00.000Z`, activity_24h: { data_until: `${day}T00:00:00Z`, app_usd: app, usdc_moved_usd_est: moved } }) as never;

describe("share7d gaps (review I3)", () => {
  test("only snapshots within 7×24 h of the newest count; a gap never makes '7 days' span more", () => {
    const days = ["2026-10-28", "2026-10-27", "2026-10-26", "2026-10-25", "2026-10-24", "2026-10-23", "2026-10-18", "2026-10-17"].map((d) => snap(d, 5, 100));
    const s = share7d(days)!;
    expect(s.window_days).toBe(6);
    expect(s.complete).toBe(false);
    expect(shareLabel(s)).toBe("6 of the last 7 days");
  });
});

describe("share7d", () => {
  test("seven usable days: sums, daily range, complete", () => {
    const days = [snap("2026-10-28", 10, 100), snap("2026-10-27", 1, 100), snap("2026-10-26", 34, 100), snap("2026-10-25", 5, 100),
      snap("2026-10-24", 5, 100), snap("2026-10-23", 5, 100), snap("2026-10-22", 5, 100), snap("2026-10-21", 99, 100)];
    expect(share7d(days)).toEqual({ window_days: 7, until: "2026-10-28T00:00:00Z", pct: 9.29, daily_min: 1, daily_max: 34, complete: true });
  });
  test("skips unusable days (null, zero or missing denominator); never NaN", () => {
    const s = share7d([snap("2026-10-23", 5, 0), snap("2026-10-22", null, 100), snap("2026-10-21", 2, 100)])!;
    expect(s).toEqual({ window_days: 1, until: "2026-10-21T00:00:00Z", pct: 2, daily_min: 2, daily_max: 2, complete: false });
    expect(share7d([snap("2026-10-23", 5, 0)])).toBeNull();
    expect(share7d([])).toBeNull();
  });
  test("labels and text", () => {
    const one = share7d([snap("2026-10-22", 5, 100)])!;
    const three = share7d([snap("2026-10-23", 1, 100), snap("2026-10-22", 3, 100), snap("2026-10-21", 5, 100)])!;
    expect(shareLabel(one)).toBe("24 h");
    expect(shareLabel(three)).toBe("3 of the last 7 days");
    expect(shareText(one)).toBe("5.00% over 24 h to 22 Oct 2026");
    expect(shareText(three)).toBe("3.00% over 3 of the last 7 days to 23 Oct 2026 (daily 1.00–5.00%)");
    expect(shareText(null)).toBe("Not available right now");
  });
});

describe("API", () => {
  test("/api/v1/arc carries attributed_share_7d from the daily table (null without DATA_DB)", async () => {
    const { resolve } = await import("node:path");
    const { DATA_MIGRATIONS } = await import("../lib/data-api-ingest");
    const { MemoryD1 } = await import("./memory-d1");
    const { MemoryKV } = await import("./memory-kv");
    const { storeArcDaily } = await import("../lib/arc-daily");
    const { handleArc } = await import("../lib/data-api-arc");
    const db = new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
    await storeArcDaily(db as never, "2026-10-22", snap("2026-10-22", 5, 100));
    const offline = (async () => { throw new Error("offline"); }) as never;
    const req = new Request("https://builder.registrai.cc/api/v1/arc");
    const withDb = await (await handleArc(req, { INVITES: new MemoryKV(), DATA_DB: db } as never, { cache: null }, [], offline)).json() as { attributed_share_7d: unknown };
    expect(withDb.attributed_share_7d).toMatchObject({ window_days: 1, pct: 5 });
    const noDb = await (await handleArc(req, { INVITES: new MemoryKV() } as never, { cache: null }, [], offline)).json() as { attributed_share_7d: unknown };
    expect(noDb.attributed_share_7d).toBeNull();
  });
});
