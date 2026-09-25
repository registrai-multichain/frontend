/**
 * Every sentence the paper surfaces show about markets, money, time and people
 * (spec §2). Questions are derived from exactly what the contract checks
 * (subject, metric, comparator, threshold, expiry): never a free-text promise
 * that could drift from the parameters.
 */
import { COMPARATOR, shortHex, utcStamp, type MarketStatusKey } from "./perennial-market";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a milestone feed counts, as a noun: GitHub releases, a domain's contract deployments. */
export function metricNoun(source: string | null | undefined): string {
  if (source?.startsWith("github:")) return "releases";
  if (source?.startsWith("domain:")) return "contract deployments";
  return "milestones";
}

/** "Sep 30, 6:00 PM" in the viewer's zone (or `timeZone`). */
export function when(ts: bigint | number, timeZone?: string): string {
  const s = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(
    new Date(Number(ts) * 1000),
  );
  return s.replace(/[  ]/g, " ");
}

export const whenUtc = (ts: bigint | number) => utcStamp(ts);

export function timeLeft(now: bigint | number | undefined, expiry: bigint | number): string {
  if (now === undefined) return "—";
  const s = Number(BigInt(expiry) - BigInt(now));
  if (s <= 0) return "closed";
  if (s < 3_600) return `closes in ${plural(Math.max(1, Math.ceil(s / 60)), "minute")}`;
  if (s < 86_400) return `${plural(Math.ceil(s / 3_600), "hour")} left`;
  return `${plural(Math.ceil(s / 86_400), "day")} left`;
}

export function durationWords(secs: number): string {
  if (secs > 0 && secs % 86_400 === 0) return plural(secs / 86_400, "day");
  if (secs > 0 && secs % 3_600 === 0) return plural(secs / 3_600, "hour");
  return plural(Math.round(secs / 60), "minute");
}

const group = (n: bigint) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** "$1,240", "$12.50", "$0.05", "<$0.01", "$0": USDC base units (6 decimals), rounded down to the cent. */
export function usdText(v: bigint): string {
  if (v < 0n) return `-${usdText(-v)}`;
  if (v === 0n) return "$0";
  if (v < 10_000n) return "<$0.01";
  const cents = v / 10_000n;
  const whole = group(cents / 100n);
  const rest = cents % 100n;
  return rest === 0n ? `$${whole}` : `$${whole}.${rest.toString().padStart(2, "0")}`;
}

/** "you", then a known name, then a short address. */
export function who(addr: string | null | undefined, ctx: { me?: string | null; names?: Record<string, string> } = {}): string {
  if (!addr) return "—";
  const a = addr.toLowerCase();
  if (ctx.me && ctx.me.toLowerCase() === a) return "you";
  const name = ctx.names?.[a];
  return name ?? shortHex(addr);
}

export interface QuestionInput {
  subject: string;
  /** A noun from metricNoun; undefined when the feed is not a known milestone count. */
  metric?: string;
  threshold: bigint;
  comparator: number;
  expiry: bigint;
}

const SYMBOL = [">", "≥", "<", "≤"];

export function outcomeCondition(comparator: number, threshold: bigint): string {
  const n = threshold.toString();
  switch (comparator) {
    case COMPARATOR.GreaterOrEqual: return `${n} or more`;
    case COMPARATOR.GreaterThan: return `more than ${n}`;
    case COMPARATOR.LessOrEqual: return `${n} or fewer`;
    case COMPARATOR.LessThan: return `fewer than ${n}`;
    default: return `${SYMBOL[comparator] ?? "?"} ${n}`;
  }
}

export function marketQuestion(q: QuestionInput, timeZone?: string): string {
  const n = q.threshold.toString();
  const by = `by ${when(q.expiry, timeZone)}?`;
  if (q.metric) {
    const m = q.metric;
    switch (q.comparator) {
      case COMPARATOR.GreaterOrEqual: return `Will ${q.subject} reach ${n} or more ${m} ${by}`;
      case COMPARATOR.GreaterThan: return `Will ${q.subject} have more than ${n} ${m} ${by}`;
      case COMPARATOR.LessOrEqual: return `Will ${q.subject} have ${n} or fewer ${m} ${by}`;
      case COMPARATOR.LessThan: return `Will ${q.subject} have fewer than ${n} ${m} ${by}`;
    }
  }
  const head = `Will the number tracked for ${q.subject}`;
  switch (q.comparator) {
    case COMPARATOR.GreaterOrEqual: return `${head} reach ${n} or more ${by}`;
    case COMPARATOR.GreaterThan: return `${head} go above ${n} ${by}`;
    case COMPARATOR.LessOrEqual: return `${head} stay at ${n} or fewer ${by}`;
    case COMPARATOR.LessThan: return `${head} stay below ${n} ${by}`;
    default: return `${head} be ${SYMBOL[q.comparator] ?? "?"} ${n} ${by}`;
  }
}

export interface SettlesInput extends QuestionInput {
  windowSecs?: number;
  /** "net-cost": the v3 contract refunds what each trader put in after fees; "half": every share pays $0.50. */
  voidRefund: "net-cost" | "half";
  /** Legacy contract: settles on the latest reading at or before expiry. */
  legacy?: boolean;
}

export function settlesText(s: SettlesInput, timeZone?: string): string {
  const of = s.metric ? `${s.subject}'s ${s.metric}` : `the number tracked for ${s.subject}`;
  const payoff = `${outcomeCondition(s.comparator, s.threshold)} and Yes pays $1 a share; otherwise No does.`;
  if (s.legacy) return `The latest reading of ${of} at or before ${when(s.expiry, timeZone)} settles it: ${payoff}`;
  const within = s.windowSecs ? durationWords(s.windowSecs) : "the settlement window";
  const refund =
    s.voidRefund === "net-cost"
      ? "every trader gets back what they put in after fees, minus what they took out"
      : "every Yes and No share pays $0.50";
  return (
    `Trading closes ${when(s.expiry, timeZone)}. The first reading of ${of} after that settles it: ${payoff} ` +
    `If no reading arrives within ${within}, the market is voided and ${refund}.`
  );
}

/** The feed's latest reading, for the market page; null = nothing attested yet; undefined = not read. */
export function readingNow(value: bigint | null | undefined): string | null {
  if (value === undefined) return null;
  if (value === null) return "Nothing counted yet.";
  return `It's at ${value.toString()} now.`;
}

const SHORT: Record<MarketStatusKey, string> = {
  loading: "Loading",
  trading: "Open",
  waiting: "Waiting for result",
  resolvable: "Ready to settle",
  voidable: "Ready to void",
  "resolved-yes": "Yes won",
  "resolved-no": "No won",
  voided: "Voided",
  "closed-legacy": "Closed",
};
export const statusShort = (key: MarketStatusKey) => SHORT[key];

export function statusSentence(key: MarketStatusKey, expiry: bigint, timeZone?: string): string {
  const at = when(expiry, timeZone);
  switch (key) {
    case "trading": return `Open until ${at}.`;
    case "waiting": return `Trading ended ${at}. Waiting for the result.`;
    case "resolvable": return "The result is in. Anyone can settle the market now.";
    case "voidable": return "No result arrived in time. Anyone can void the market now, and traders get refunds.";
    case "resolved-yes": return "Settled: Yes won.";
    case "resolved-no": return "Settled: No won.";
    case "voided": return "Voided: traders get refunds.";
    case "closed-legacy": return `Trading ended ${at}. The operator settles this market.`;
    default: return "Reading the market…";
  }
}
