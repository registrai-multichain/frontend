/**
 * LOCAL END-TO-END ONLY. Drives Perennial on an anvil chain the way the UI does:
 * the same deployment resolver, overview reads, quote math, slippage floor, exact
 * approvals, simulate-then-write, and receipt decoding the panel uses — so a
 * mismatch between the UI and the contracts fails here, not in a user's wallet.
 *
 *   npx tsx scripts/e2e-perennial.ts '<json>'
 *
 * <json>: { rpc, contracts: {NanoLedger, BuilderRegistry, ProgressPool, MarketsPerennial,
 *           CaretakerRegistry, USDC}, operator, key, action, ...args }
 * Prints one JSON line. Exits non-zero when the chain disagrees with the UI's quote.
 * Refuses any chain but 31337, and only ever signs with the key it is handed
 * (anvil's dev keys, which hold nothing anywhere else).
 */
import { createPublicClient, createWalletClient, decodeEventLog, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { marketsPerennialAbi, nanoLedgerAbi, usdcAbi } from "../src/lib/abi";
import { resolvePerennialDeployment } from "../src/lib/perennial-network";
import { marketIdFromLogs, readLatestValue, readOverview, type ChainMarket } from "../src/lib/perennial-chain";
import {
  COMPARATOR,
  OUTCOME,
  marketStatus,
  minOutWithSlippage,
  nextMilestoneThreshold,
  quoteBuy,
  quoteSell,
  redeemPayout,
} from "../src/lib/perennial-market";

type Args = Record<string, unknown> & {
  rpc: string;
  contracts: Record<string, string>;
  operator: string;
  key?: Hex;
  action: string;
};

const args = JSON.parse(process.argv[2] ?? "{}") as Args;
const D = resolvePerennialDeployment("testnet", { contracts: args.contracts, operator: args.operator, deployBlock: 0 });
const pc = createPublicClient({ chain: foundry, transport: http(args.rpc) }) as PublicClient;
const acct = args.key ? privateKeyToAccount(args.key) : undefined;
const wc = acct ? createWalletClient({ chain: foundry, transport: http(args.rpc), account: acct }) : undefined;
const P = D.contracts;
const SLIPPAGE_BPS = 100n; // the panel's default 1%

const out = (o: unknown) => console.log(JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
function die(msg: string, extra: Record<string, unknown> = {}): never {
  out({ ok: false, error: msg, ...extra });
  process.exit(1);
}

async function send(address: Address, abi: readonly unknown[], functionName: string, fnArgs: readonly unknown[]) {
  // The panel simulates first so a revert is reported before the wallet prompt.
  await pc.simulateContract({ address, abi: abi as never, functionName: functionName as never, args: fnArgs as never, account: acct! });
  const hash = await wc!.writeContract({ address, abi: abi as never, functionName: functionName as never, args: fnArgs as never, chain: foundry, account: acct! });
  const r = await pc.waitForTransactionReceipt({ hash });
  if (r.status !== "success") die(`${functionName} reverted after inclusion`, { hash });
  return r;
}

async function ensureUsdc(spender: Address, needed: bigint) {
  const a = (await pc.readContract({ address: P.USDC!, abi: usdcAbi, functionName: "allowance", args: [acct!.address, spender] })) as bigint;
  if (a < needed) await send(P.USDC!, usdcAbi, "approve", [spender, needed]);
}
async function ensureLedger(spender: Address, needed: bigint) {
  const a = (await pc.readContract({ address: P.NanoLedger!, abi: nanoLedgerAbi, functionName: "allowance", args: [acct!.address, spender] })) as bigint;
  if (a < needed) await send(P.NanoLedger!, nanoLedgerAbi, "approveSpender", [spender, needed]);
}

function eventArgs(logs: { address: string; data: Hex; topics: [Hex, ...Hex[]] | [] }[], name: string) {
  for (const l of logs) {
    if (l.address.toLowerCase() !== P.MarketsPerennial!.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: marketsPerennialAbi, data: l.data, topics: l.topics as never });
      if (ev.eventName === name) return ev.args as Record<string, bigint>;
    } catch { /* another event */ }
  }
  return undefined;
}

async function market(id: Hex) {
  const ov = await readOverview(pc, D);
  const m = ov.markets.find((x: ChainMarket) => x.id.toLowerCase() === id.toLowerCase());
  if (!m) die(`market ${id} not discovered by readOverview`);
  return { ov, m: m! };
}

async function position(id: Hex, who: Address) {
  const [yes, no, lp] = (await Promise.all(
    (["yesBalance", "noBalance", "lpShares"] as const).map((fn) =>
      pc.readContract({ address: P.MarketsPerennial!, abi: marketsPerennialAbi, functionName: fn, args: [id, who] })),
  )) as bigint[];
  return { yes, no, lp };
}

async function main() {
  if ((await pc.getChainId()) !== 31337) die("refusing: e2e runs on anvil (31337) only");
  const id = args.marketId as Hex | undefined;
  const outcomeOf = (s: unknown) => (s === "No" ? OUTCOME.No : OUTCOME.Yes);

  switch (args.action) {
    case "overview": {
      const ov = await readOverview(pc, D);
      const now = ov.chainNow;
      return out({
        ok: true,
        supportsSettlement: ov.supportsSettlement,
        approvalView: ov.approvalView,
        fees: ov.fees,
        markets: ov.markets.map((m: ChainMarket) => ({
          id: m.id, builderId: m.builderId, feedId: m.feedId, threshold: m.threshold, phase: m.phase,
          settlement: m.settlement, status: marketStatus({ phase: m.phase, yesWon: m.yesWon, expiry: m.expiry, chainNow: now, settlement: m.settlement, supportsSettlement: ov.supportsSettlement }).key,
        })),
        builders: ov.builders.map((b) => ({ builderId: b.builderId, active: b.active, milestoneFeedId: b.milestoneFeedId })),
      });
    }
    case "deposit": {
      const amount = BigInt(String(args.amount));
      await ensureUsdc(P.NanoLedger!, amount);
      await send(P.NanoLedger!, nanoLedgerAbi, "deposit", [amount]);
      return out({ ok: true });
    }
    case "create": {
      // Exactly the panel's create: threshold = latest attested count + 1, >=, expiry from chain time.
      const ov = await readOverview(pc, D);
      const b = ov.builders.find((x) => x.builderId === Number(args.builderId));
      if (!b) die(`builder ${args.builderId} not in overview`);
      const feed = (args.feedId as Hex | undefined) ?? b!.milestoneFeedId;
      if (!feed) die("builder has no milestone feed in the overview");
      const latest = await readLatestValue(pc, ov.attestation, feed!, D.operator!);
      const threshold = nextMilestoneThreshold(latest?.value ?? null);
      const now = BigInt((await pc.getBlock()).timestamp);
      const expiry = now + BigInt(Number(args.expiryIn));
      const liq = BigInt(String(args.liquidity));
      await ensureLedger(P.MarketsPerennial!, liq);
      const r = await send(P.MarketsPerennial!, marketsPerennialAbi, "createMarket",
        [BigInt(b!.builderId), feed, D.operator, threshold, COMPARATOR.GreaterOrEqual, expiry, liq]);
      const mid = marketIdFromLogs(r.logs, P.MarketsPerennial!);
      if (!mid) die("createMarket receipt carried no MarketCreated");
      return out({ ok: true, marketId: mid, threshold, expiry, latest: latest?.value ?? null });
    }
    case "buy": {
      const { ov, m } = await market(id!);
      const outcome = outcomeOf(args.side);
      const amount = BigInt(String(args.amount));
      const q = quoteBuy(m, outcome, amount, ov.fees.total);
      if (!q) die("quoteBuy returned null");
      const floor = minOutWithSlippage(q!.sharesOut, SLIPPAGE_BPS);
      await ensureLedger(P.MarketsPerennial!, amount);
      const r = await send(P.MarketsPerennial!, marketsPerennialAbi, "buy", [m.id, outcome, amount, floor]);
      const ev = eventArgs(r.logs as never, "Bought");
      if (!ev) die("no Bought event");
      if (ev!.sharesOut !== q!.sharesOut || ev!.fee !== q!.fee) die("chain disagrees with the UI buy quote", { quote: q, chain: ev });
      return out({ ok: true, sharesOut: ev!.sharesOut, fee: ev!.fee, quoteMatched: true });
    }
    case "sell": {
      const { ov, m } = await market(id!);
      const outcome = outcomeOf(args.side);
      const shares = BigInt(String(args.shares));
      const q = quoteSell(m, outcome, shares, ov.fees.total);
      if (!q) die("quoteSell returned null");
      const floor = minOutWithSlippage(q!.collateralOut, SLIPPAGE_BPS);
      const r = await send(P.MarketsPerennial!, marketsPerennialAbi, "sell", [m.id, outcome, shares, floor]);
      const ev = eventArgs(r.logs as never, "Sold");
      if (!ev) die("no Sold event");
      if (ev!.collateralOut !== q!.collateralOut || ev!.fee !== q!.fee) die("chain disagrees with the UI sell quote", { quote: q, chain: ev });
      return out({ ok: true, collateralOut: ev!.collateralOut, fee: ev!.fee, quoteMatched: true });
    }
    case "status": {
      const { ov, m } = await market(id!);
      return out({ ok: true, phase: m.phase, settlement: m.settlement, yesWon: m.yesWon, fees: ov.fees,
        status: marketStatus({ phase: m.phase, yesWon: m.yesWon, expiry: m.expiry, chainNow: ov.chainNow, settlement: m.settlement, supportsSettlement: ov.supportsSettlement }).key });
    }
    case "resolve":
    case "voidMarket": {
      await send(P.MarketsPerennial!, marketsPerennialAbi, args.action, [id]);
      return out({ ok: true });
    }
    case "redeem": {
      const { m } = await market(id!);
      const pos = await position(id!, acct!.address);
      const expected = redeemPayout(m, pos.yes, pos.no);
      const r = await send(P.MarketsPerennial!, marketsPerennialAbi, "redeem", [id]);
      const ev = eventArgs(r.logs as never, "Redeemed");
      if (!ev) die("no Redeemed event");
      if (ev!.payout !== expected) die("chain disagrees with the UI redeem preview", { expected, chain: ev!.payout });
      return out({ ok: true, payout: ev!.payout, previewMatched: true });
    }
    case "claimLP": {
      const r = await send(P.MarketsPerennial!, marketsPerennialAbi, "claimLP", [id]);
      const ev = eventArgs(r.logs as never, "LPClaimed");
      return out({ ok: true, payout: ev?.payout ?? 0n });
    }
    case "withdrawAll": {
      const bal = (await pc.readContract({ address: P.NanoLedger!, abi: nanoLedgerAbi, functionName: "balanceOf", args: [acct!.address] })) as bigint;
      if (bal > 0n) await send(P.NanoLedger!, nanoLedgerAbi, "withdraw", [bal]);
      return out({ ok: true, withdrawn: bal });
    }
    default:
      die(`unknown action ${args.action}`);
  }
}

main().catch((e) => die(e instanceof Error ? e.message.split("\n").slice(0, 6).join(" | ") : String(e)));
