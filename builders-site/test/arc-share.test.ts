import { describe, expect, test } from "vitest";
import { share7d, shareLabel, shareText } from "../lib/arc-share";

const snap = (day: string, app: number | null, moved: number | null) =>
  ({ generated_at: `${day}T00:02:00.000Z`, activity_24h: { data_until: `${day}T00:00:00Z`, app_usd: app, usdc_moved_usd_est: moved } }) as never;

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
    expect(shareLabel(three)).toBe("last 3 days");
    expect(shareText(one)).toBe("5.00% over 24 h to 22 Oct 2026");
    expect(shareText(three)).toBe("3.00% over last 3 days to 23 Oct 2026 (daily 1.00–5.00%)");
    expect(shareText(null)).toBe("Not available right now");
  });
});
