/** "$1,234.50": raw USDC (6 decimals) to dollars and cents, rounded down. Pure, no imports
 *  (the builders site's Pages Functions import builders-admin.ts, which uses it). */
export function usd(amount: bigint): string {
  const cents = amount / 10_000n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${whole}.${(cents % 100n).toString().padStart(2, "0")}`;
}
