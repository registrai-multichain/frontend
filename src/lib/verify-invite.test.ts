import { describe, expect, test } from "vitest";
import { isMobileUserAgent, metamaskDappLink, nextBadgeImage, nextBadgeLine, RENDERED_BADGE_SERIALS } from "./verify-invite";

describe("next badge", () => {
  test("line and art from nextSerial", () => {
    expect(nextBadgeLine(1)).toBe("Next up: No. 001");
    expect(nextBadgeLine(42)).toBe("Next up: No. 042");
    for (const bad of [null, undefined, 0, -1, 1.5, Number.NaN]) expect(nextBadgeLine(bad)).toBeNull();
    expect(nextBadgeImage("arc", 1)).toBe("/badge/arc/1.jpg");
    expect(nextBadgeImage("arc", RENDERED_BADGE_SERIALS)).toBe(`/badge/arc/${RENDERED_BADGE_SERIALS}.jpg`);
    expect(nextBadgeImage("arc", RENDERED_BADGE_SERIALS + 1)).toBe("/badge/arc/badge-generic.jpg");
    expect(nextBadgeImage("arc", null)).toBe("/badge/arc/badge-generic.jpg");
  });
});

describe("mobile wallet link", () => {
  test("MetaMask universal link keeps host, path and query (the invite), drops the fragment", () => {
    expect(metamaskDappLink("https://builder.registrai.cc/verify/?source=github%3Afoo%2Fbar&invite=abc#x")).toBe(
      "https://metamask.app.link/dapp/builder.registrai.cc/verify/?source=github%3Afoo%2Fbar&invite=abc",
    );
    expect(metamaskDappLink("http://builder.registrai.cc/verify/")).toBeNull();
    expect(metamaskDappLink("not a url")).toBeNull();
  });

  test("mobile user agents", () => {
    expect(isMobileUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")).toBe(true);
    expect(isMobileUserAgent("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36")).toBe(true);
    expect(isMobileUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36")).toBe(false);
  });
});
