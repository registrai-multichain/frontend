/**
 * REGI supply for listings (CoinGecko reads dashboard.registrai.cc/api/regi/…):
 * burned = REGI at 0x…dEaD (the buyback burns there; totalSupply() never drops),
 * circulating = totalSupply - burned - REGI held by the protocol wallets.
 */
export const REGI_BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;

export interface RegiSupply {
  total: bigint;
  burned: bigint;
  protocol: bigint;
  totalNetOfBurn: bigint;
  circulating: bigint;
}

export function regiSupply(s: { total: bigint; burned: bigint; protocol: bigint }): RegiSupply {
  const totalNetOfBurn = s.total - s.burned;
  return { ...s, totalNetOfBurn, circulating: totalNetOfBurn - s.protocol };
}

/** Pure: an 18-decimal amount as a plain decimal string ("964345362.379…"), no trailing zeros. */
export function formatSupply(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / 10n ** 18n;
  const frac = (a % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}
