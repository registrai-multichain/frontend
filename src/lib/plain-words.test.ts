import { describe, expect, test } from "vitest";
import { COMPARATOR } from "./perennial-market";
import {
  durationWords, marketQuestion, sentence, tradeLabel, metricNoun, outcomeCondition, readingNow, settlesText, statusSentence, statusShort,
  timeLeft, usdText, when, whenUtc, who,
} from "./plain-words";

// 2026-09-30 16:00:00 UTC
const EXPIRY = 1_790_784_000n;
const USD = 1_000_000n;

describe("when / whenUtc", () => {
  test("local time in the viewer's zone, without ICU's narrow no-break space", () => {
    expect(when(EXPIRY, "Europe/Berlin")).toBe("Sep 30, 6:00 PM");
    expect(when(EXPIRY, "UTC")).toBe("Sep 30, 4:00 PM");
    expect(when(EXPIRY, "UTC")).not.toMatch(/ /);
  });
  test("UTC stamp for Details", () => {
    expect(whenUtc(EXPIRY)).toBe("2026-09-30 16:00 UTC");
  });
});

describe("timeLeft", () => {
  test("days, hours, minutes, closed; singular and plural; unknown now", () => {
    expect(timeLeft(EXPIRY - 4n * 86_400n, EXPIRY)).toBe("4 days left");
    expect(timeLeft(EXPIRY - 86_400n, EXPIRY)).toBe("1 day left");
    expect(timeLeft(EXPIRY - 86_401n, EXPIRY)).toBe("2 days left");
    expect(timeLeft(EXPIRY - 3n * 3_600n, EXPIRY)).toBe("3 hours left");
    expect(timeLeft(EXPIRY - 3_600n, EXPIRY)).toBe("1 hour left");
    expect(timeLeft(EXPIRY - 720n, EXPIRY)).toBe("closes in 12 minutes");
    expect(timeLeft(EXPIRY - 30n, EXPIRY)).toBe("closes in 1 minute");
    expect(timeLeft(EXPIRY, EXPIRY)).toBe("closed");
    expect(timeLeft(undefined, EXPIRY)).toBe("—");
  });
});

describe("durationWords", () => {
  test("whole days, whole hours, else minutes", () => {
    expect(durationWords(86_400)).toBe("1 day");
    expect(durationWords(2 * 86_400)).toBe("2 days");
    expect(durationWords(6 * 3_600)).toBe("6 hours");
    expect(durationWords(3_600)).toBe("1 hour");
    expect(durationWords(5_400)).toBe("90 minutes");
  });
});

describe("usdText", () => {
  test("whole dollars without cents, cents when there are some, grouped", () => {
    expect(usdText(1_240n * USD)).toBe("$1,240");
    expect(usdText(12_500_000n)).toBe("$12.50");
    expect(usdText(50_000n)).toBe("$0.05");
    expect(usdText(1_234_567n * USD)).toBe("$1,234,567");
  });
  test("edges: zero, sub-cent, rounding down, negative", () => {
    expect(usdText(0n)).toBe("$0");
    expect(usdText(9_999n)).toBe("<$0.01");
    expect(usdText(1n)).toBe("<$0.01");
    expect(usdText(12_509_999n)).toBe("$12.50");
    expect(usdText(-5n * USD)).toBe("-$5");
  });
});

describe("who", () => {
  const me = "0x3F00000000000000000000000000000000000Aa2";
  test("you, then a known name, then a short address", () => {
    expect(who(me.toLowerCase(), { me })).toBe("you");
    expect(who("0xAbC0000000000000000000000000000000000001", { names: { "0xabc0000000000000000000000000000000000001": "RegistrAI" } })).toBe("RegistrAI");
    expect(who("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
    expect(who(null)).toBe("—");
  });
});

describe("metricNoun", () => {
  test("github counts releases, a domain counts contract deployments, else milestones", () => {
    expect(metricNoun("github:acme/widget")).toBe("releases");
    expect(metricNoun("domain:acme.xyz")).toBe("contract deployments");
    expect(metricNoun(null)).toBe("milestones");
    expect(metricNoun("registrai:legacy")).toBe("milestones");
  });
});

describe("marketQuestion", () => {
  const base = { subject: "RegistrAI", metric: "releases", threshold: 5n, expiry: EXPIRY };
  test("every comparator with a metric", () => {
    expect(marketQuestion({ ...base, comparator: COMPARATOR.GreaterOrEqual }, "Europe/Berlin")).toBe("Will RegistrAI reach 5 or more releases by Sep 30, 6:00 PM?");
    expect(marketQuestion({ ...base, comparator: COMPARATOR.GreaterThan }, "Europe/Berlin")).toBe("Will RegistrAI have more than 5 releases by Sep 30, 6:00 PM?");
    expect(marketQuestion({ ...base, comparator: COMPARATOR.LessOrEqual }, "Europe/Berlin")).toBe("Will RegistrAI have 5 or fewer releases by Sep 30, 6:00 PM?");
    expect(marketQuestion({ ...base, comparator: COMPARATOR.LessThan }, "Europe/Berlin")).toBe("Will RegistrAI have fewer than 5 releases by Sep 30, 6:00 PM?");
  });
  test("an unknown metric names the tracked number instead of guessing", () => {
    expect(marketQuestion({ ...base, metric: undefined, comparator: COMPARATOR.GreaterOrEqual }, "UTC")).toBe("Will the number tracked for RegistrAI reach 5 or more by Sep 30, 4:00 PM?");
    expect(marketQuestion({ ...base, metric: undefined, comparator: COMPARATOR.LessThan }, "UTC")).toBe("Will the number tracked for RegistrAI stay below 5 by Sep 30, 4:00 PM?");
  });
  test("an out-of-range comparator still reads, with its symbol", () => {
    expect(marketQuestion({ ...base, metric: undefined, comparator: 9 }, "UTC")).toBe("Will the number tracked for RegistrAI be ? 5 by Sep 30, 4:00 PM?");
  });
});

describe("outcomeCondition", () => {
  test("the four comparators", () => {
    expect(outcomeCondition(COMPARATOR.GreaterOrEqual, 5n)).toBe("5 or more");
    expect(outcomeCondition(COMPARATOR.GreaterThan, 5n)).toBe("more than 5");
    expect(outcomeCondition(COMPARATOR.LessOrEqual, 5n)).toBe("5 or fewer");
    expect(outcomeCondition(COMPARATOR.LessThan, 5n)).toBe("fewer than 5");
  });
});

describe("settlesText", () => {
  const q = { subject: "RegistrAI", metric: "releases", threshold: 5n, comparator: COMPARATOR.GreaterOrEqual, expiry: EXPIRY };
  test("settlement contract, net-cost refunds", () => {
    expect(settlesText({ ...q, windowSecs: 6 * 3_600, voidRefund: "net-cost" }, "Europe/Berlin")).toBe(
      "Trading closes Sep 30, 6:00 PM. The first reading of RegistrAI's releases after that settles it: 5 or more and Yes pays $1 a share; otherwise No does. " +
        "If no reading arrives within 6 hours, the market is voided and every trader gets back what they put in after fees, minus what they took out (pro rata if the pool is short).",
    );
  });
  test("half-share refunds, unknown window, unknown metric", () => {
    expect(settlesText({ ...q, metric: undefined, voidRefund: "half" }, "UTC")).toBe(
      "Trading closes Sep 30, 4:00 PM. The first reading of the number tracked for RegistrAI after that settles it: 5 or more and Yes pays $1 a share; otherwise No does. " +
        "If no reading arrives within the settlement window, the market is voided and every Yes and No share pays $0.50.",
    );
  });
  test("legacy contract: the latest reading at or before expiry", () => {
    expect(settlesText({ ...q, voidRefund: "half", legacy: true }, "UTC")).toBe(
      "The latest reading of RegistrAI's releases at or before Sep 30, 4:00 PM settles it: 5 or more and Yes pays $1 a share; otherwise No does.",
    );
  });
});

describe("readingNow", () => {
  test("known, nothing yet, unread", () => {
    expect(readingNow(4n)).toBe("It's at 4 now.");
    expect(readingNow(null)).toBe("Nothing counted yet.");
    expect(readingNow(undefined)).toBeNull();
  });
});

describe("status words", () => {
  test("short labels for cards", () => {
    expect(statusShort("trading")).toBe("Open");
    expect(statusShort("waiting")).toBe("Waiting for result");
    expect(statusShort("resolvable")).toBe("Ready to settle");
    expect(statusShort("voidable")).toBe("Ready to void");
    expect(statusShort("resolved-yes")).toBe("Yes won");
    expect(statusShort("resolved-no")).toBe("No won");
    expect(statusShort("voided")).toBe("Voided");
    expect(statusShort("closed-legacy")).toBe("Closed");
    expect(statusShort("loading")).toBe("Loading");
  });
  test("sentences for the ticket", () => {
    expect(statusSentence("trading", EXPIRY, "UTC")).toBe("Open until Sep 30, 4:00 PM.");
    expect(statusSentence("waiting", EXPIRY, "UTC")).toBe("Trading ended Sep 30, 4:00 PM. Waiting for the result.");
    expect(statusSentence("resolvable", EXPIRY, "UTC")).toBe("The result is in. Anyone can settle the market now.");
    expect(statusSentence("voidable", EXPIRY, "UTC")).toBe("No result arrived in time. Anyone can void the market now, and traders get refunds.");
    expect(statusSentence("resolved-yes", EXPIRY, "UTC")).toBe("Settled: Yes won.");
    expect(statusSentence("resolved-no", EXPIRY, "UTC")).toBe("Settled: No won.");
    expect(statusSentence("voided", EXPIRY, "UTC")).toBe("Voided: traders get refunds.");
    expect(statusSentence("closed-legacy", EXPIRY, "UTC")).toBe("Trading ended Sep 30, 4:00 PM. The operator settles this market.");
    expect(statusSentence("loading", EXPIRY, "UTC")).toBe("Reading the market…");
  });
});

describe("tradeLabel", () => {
  test("buy names dollars; sell names shares, never the share count as dollars", () => {
    expect(tradeLabel("buy", "Yes", 10n * 1_000_000n)).toBe("Buy Yes for $10");
    expect(tradeLabel("buy", "No")).toBe("Buy No");
    expect(tradeLabel("sell", "Yes", 10n * 1_000_000n)).toBe("Sell 10 Yes shares");
    expect(tradeLabel("sell", "No", 2_500_000n)).toBe("Sell 2.5 No shares");
    expect(tradeLabel("sell", "Yes")).toBe("Sell Yes");
  });
});

describe("review minors", () => {
  test("sentence() capitalises the first letter only", () => {
    expect(sentence("your net cost $5 back")).toBe("Your net cost $5 back");
    expect(sentence("")).toBe("");
  });
  test("settlesText says the trading closed once it has", () => {
    const q = { subject: "RegistrAI", metric: "releases", threshold: 5n, comparator: COMPARATOR.GreaterOrEqual, expiry: EXPIRY };
    expect(settlesText({ ...q, voidRefund: "half", now: EXPIRY + 1n }, "UTC")).toMatch(/^Trading closed Sep 30, 4:00 PM\. /);
    expect(settlesText({ ...q, voidRefund: "half", now: EXPIRY - 1n }, "UTC")).toMatch(/^Trading closes Sep 30, 4:00 PM\. /);
  });
});
