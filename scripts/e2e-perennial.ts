/**
 * LOCAL END-TO-END ONLY. Drives Perennial on an anvil chain the way the UI does:
 * the same deployment resolver, overview reads, quote math, slippage floor, exact
 * approvals, simulate-then-write, and receipt decoding the panel uses — so a
 * mismatch between the UI and the contracts fails here, not in a user's wallet.
 *
 *   npx tsx scripts/e2e-perennial.ts '<json>'
 *
 * <json>: { rpc, contracts: {NanoLedger, BuilderRegistry, MarketsPerennial, CaretakerRegistry,
 *           USDC, BuilderFund?, SeasonPool?}, operator, key, action, ...args }
 * (A ProgressPool / ProgressArbiter key is ignored: both are retired.)
 * Prints one JSON line. Exits non-zero when the chain disagrees with the UI's quote
 * or preview. v3 (1% trading fee): buy/sell quotes must match to the unit, the
 * fee must be exactly 1%, its FeesPaid legs exactly 30/20/50 with the 20% added
 * to agentEscrow and, with a BuilderFund, the 50% credited as IncomeCredited to
 * the market's builder; voidMarket must pay no creator fee and send the escrow
 * to the challenger XOR the season pool (SeasonCredited on the fund); redeem /
 * claimLP must pay exactly the contract's `redeemable` / `claimableLP` view
 * read BEFORE the call AND the UI's mirror. `economy`, `income` and
 * `claimIncome` read and claim builder income the way the market pages do.
 * Resolving is the keeper's job; the `resolve` action is kept for manual runs.
 * Refuses any chain but 31337, and only ever signs with the key it is handed
 * (anvil's dev keys, which hold nothing anywhere else).
 */
import { createPublicClient, createWalletClient, decodeEventLog, http, type Abi, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { builderFundAbi, marketsPerennialAbi, nanoLedgerAbi, usdcAbi } from "../src/lib/abi";
import { epochState, splitIncome } from "../src/lib/builder-economy";
import { readBuilderEpochs, readEconomy, readEconomyHistory } from "../src/lib/economy-chain";
import { resolvePerennialDeployment } from "../src/lib/perennial-network";
import { marketIdFromLogs, readFundStatus, readLatestValue, readOverview, type ChainMarket } from "../src/lib/perennial-chain";
import { readAgentBond, readOpenCollateral, resolveStack } from "../src/lib/reputation-chain";
import { assessAgent, type AgentRecordJson } from "../src/lib/reputation";
import { canonicalClaimMessage, validateProof, type Claim } from "../src/lib/verified-builders";
import {
  BPS,
  COMPARATOR,
  OUTCOME,
  PHASE,
  marketStatus,
  minOutWithSlippage,
  nextMilestoneThreshold,
  quoteBuy,
  quoteSell,
} from "../src/lib/perennial-market";
import {
  feeSummary,
  mirrorClaimLP,
  mirrorRedeem,
  mirrorVoid,
  splitTradeFee,
  tradeFeeBps,
  type FeeModel,
  type SettlementSnapshot,
} from "../src/lib/market-fees";
import { marketFeesAbi, readHolderSettlement, readMarketSettlement } from "../src/lib/market-fees-chain";

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
const ONE_PERCENT_BPS = 100n; // the v3 trading fee the owner set

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

function eventArgs(logs: { address: string; data: Hex; topics: [Hex, ...Hex[]] | [] }[], name: string, at: Address = P.MarketsPerennial!) {
  for (const l of logs) {
    if (l.address.toLowerCase() !== at.toLowerCase()) continue;
    // A pre-fund contract's field names differ (commonsFee): fall back to the fragment.
    for (const abi of [marketsPerennialAbi as Abi, builderFundAbi as Abi, marketFeesAbi as Abi]) {
      try {
        const ev = decodeEventLog({ abi, data: l.data, topics: l.topics as never });
        if (ev.eventName === name) return ev.args as unknown as Record<string, bigint>;
      } catch { /* another event */ }
    }
  }
  return undefined;
}

const view = (functionName: "collateralOf" | "totalNetCost" | "agentEscrow", id: Hex) =>
  pc.readContract({ address: P.MarketsPerennial!, abi: marketFeesAbi, functionName, args: [id] }) as Promise<bigint>;
const holderView = (functionName: "netCost" | "redeemable" | "claimableLP", id: Hex, who: Address) =>
  pc.readContract({ address: P.MarketsPerennial!, abi: marketFeesAbi, functionName, args: [id, who] }) as Promise<bigint>;

/** v3 bookkeeping a trade moves: the trader's net cost, the pot, the agent escrow. */
async function books(id: Hex, who: Address) {
  const [netCost, collateral, escrow] = await Promise.all([holderView("netCost", id, who), view("collateralOf", id), view("agentEscrow", id)]);
  return { netCost, collateral, escrow };
}

/** FeesPaid's third field: builderFee (BuilderFund), commonsFee (before it). */
const payeeFeeOf = (paid: Record<string, bigint>) => paid.builderFee ?? paid.payeeFee ?? paid.commonsFee;

/** v3: the fee is exactly 1% and its FeesPaid legs are exactly 30/20/50, the 20% into escrow;
 *  with a BuilderFund, the 50% is credited to the market's builder for the current epoch. */
function checkTradeFee(
  fm: Extract<FeeModel, { kind: "trade" }>,
  base: bigint,
  evFee: bigint,
  logs: never,
  before: { escrow: bigint },
  after: { escrow: bigint },
  builderId?: bigint,
) {
  if (fm.tradeFeeBps !== ONE_PERCENT_BPS) die("TRADE_FEE_BPS is not 1%", { tradeFeeBps: fm.tradeFeeBps });
  const want = (base * ONE_PERCENT_BPS) / BPS;
  if (evFee !== want) die("trade fee is not exactly 1%", { base, fee: evFee, want });
  const legs = splitTradeFee(evFee, fm)!;
  const paid = eventArgs(logs, "FeesPaid");
  if (!paid) die("no FeesPaid event on the trade");
  if (paid!.creatorFee !== legs.creator || paid!.agentFee !== legs.agent || payeeFeeOf(paid!) !== legs.payee) {
    die("FeesPaid legs are not 30/20/50 of the fee", { expected: legs, chain: paid });
  }
  if (after.escrow - before.escrow !== legs.agent) die("agentEscrow did not grow by the agent leg", { before: before.escrow, after: after.escrow, agentFee: legs.agent });
  if (P.BuilderFund && fm.payee === "builder" && legs.payee > 0n) {
    const credited = eventArgs(logs, "IncomeCredited", P.BuilderFund);
    if (!credited || credited.builderId !== builderId || credited.amount !== legs.payee) {
      die("the builder leg was not credited to the market's builder", { expected: { builderId, amount: legs.payee }, chain: credited ?? null });
    }
  }
  return legs;
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

/** The market as the panel's payout mirror sees it. */
function snapshotOf(m: ChainMarket): SettlementSnapshot {
  return { ...m, totalLpShares: m.seeded };
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
        feeModel: ov.feeModel,
        feeSummary: feeSummary(ov.feeModel) ?? null,
        markets: ov.markets.map((m: ChainMarket) => ({
          id: m.id, builderId: m.builderId, feedId: m.feedId, threshold: m.threshold, phase: m.phase,
          settlement: m.settlement, status: marketStatus({ phase: m.phase, yesWon: m.yesWon, expiry: m.expiry, chainNow: now, settlement: m.settlement, supportsSettlement: ov.supportsSettlement, feeModel: ov.feeModel }).key,
        })),
        builders: ov.builders.map((b) => ({ builderId: b.builderId, active: b.active, milestoneFeedId: b.milestoneFeedId })),
        fundStatus: ov.fundStatus,
      });
    }
    case "economy": {
      // The market pages' fund + pool reads (status strip, tax schedule).
      const fundStatus = await readFundStatus(pc, D);
      if (fundStatus !== "live") return out({ ok: true, fundStatus });
      const e = await readEconomy(pc, P.BuilderFund!, P.SeasonPool!);
      return out({
        ok: true, fundStatus, epoch: e.epoch, start: e.start, epochLength: e.epochLength, epochEndsAt: e.epochEndsAt,
        outstanding: e.outstanding, unallocated: e.unallocated, reserved: e.reserved, schedule: e.schedule, upcoming: e.upcoming,
      });
    }
    case "income": {
      // One builder's income card: every epoch with income, as the panel shows it.
      if ((await readFundStatus(pc, D)) !== "live") die("the BuilderFund is not live for these markets");
      const e = await readEconomy(pc, P.BuilderFund!, P.SeasonPool!);
      const head = await pc.getBlock();
      const history = await readEconomyHistory(pc, D, head.number);
      const rows = await readBuilderEpochs(pc, e, Number(args.builderId), head.timestamp, history.ledger);
      return out({ ok: true, epoch: e.epoch, rows: rows.map((r) => ({ ...r, state: epochState(r) })) });
    }
    case "claimIncome": {
      // The panel's claim: simulate + claimFor(epoch, builderId) from any wallet; the
      // Claimed split must equal the UI's (progressiveTax over scheduleFor(epoch)).
      if ((await readFundStatus(pc, D)) !== "live") die("the BuilderFund is not live for these markets");
      const epoch = BigInt(String(args.epoch));
      const builderId = BigInt(String(args.builderId));
      const fund = P.BuilderFund!;
      const [schedule, quote] = await Promise.all([
        pc.readContract({ address: fund, abi: builderFundAbi, functionName: "scheduleFor", args: [epoch] }),
        pc.readContract({ address: fund, abi: builderFundAbi, functionName: "quote", args: [epoch, builderId] }),
      ]);
      const gross = (quote as readonly bigint[])[0];
      const ui = splitIncome(gross, (schedule as readonly { upTo: bigint; rateBps: number }[]).map((b) => ({ upTo: b.upTo, rateBps: Number(b.rateBps) })));
      const q = quote as readonly [bigint, bigint, bigint, bigint];
      if (q[1] !== ui.tax || q[2] !== ui.fee || q[3] !== ui.net) die("quote disagrees with the UI's tax math", { quote: q, ui });
      const r = await send(fund, builderFundAbi, "claimFor", [epoch, builderId]);
      const ev = eventArgs(r.logs as never, "Claimed", fund) as (Record<string, bigint> & { payout?: Address }) | undefined;
      if (!ev) die("no Claimed event");
      if (ev!.gross !== ui.gross || ev!.tax !== ui.tax || ev!.fee !== ui.fee || ev!.net !== ui.net) die("Claimed disagrees with the UI's split", { ui, chain: ev });
      return out({ ok: true, gross: ev!.gross, tax: ev!.tax, fee: ev!.fee, net: ev!.net, payout: ev!.payout ?? null, previewMatched: true });
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
      // Mirror the panel: no on-chain reading -> no market (the count is unknown).
      if (!latest) die("no on-chain reading of this feed yet — the create form refuses");
      const threshold = nextMilestoneThreshold(latest.value);
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
      const fm = ov.feeModel;
      const feeBps = tradeFeeBps(fm);
      if (feeBps === undefined) die("fee model unknown: the UI would not quote", { feeModel: fm });
      const q = quoteBuy(m, outcome, amount, feeBps!);
      if (!q) die("quoteBuy returned null");
      const floor = minOutWithSlippage(q!.sharesOut, SLIPPAGE_BPS);
      const before = fm.kind === "trade" ? await books(m.id, acct!.address) : undefined;
      await ensureLedger(P.MarketsPerennial!, amount);
      const r = await send(P.MarketsPerennial!, marketsPerennialAbi, "buy", [m.id, outcome, amount, floor]);
      const ev = eventArgs(r.logs as never, "Bought");
      if (!ev) die("no Bought event");
      if (ev!.sharesOut !== q!.sharesOut || ev!.fee !== q!.fee) die("chain disagrees with the UI buy quote", { quote: q, chain: ev });
      if (fm.kind !== "trade") return out({ ok: true, sharesOut: ev!.sharesOut, fee: ev!.fee, quoteMatched: true });
      const after = await books(m.id, acct!.address);
      const legs = checkTradeFee(fm, amount, ev!.fee, r.logs as never, before!, after, m.builderId);
      const net = amount - ev!.fee;
      if (after.netCost !== before!.netCost + net) die("netCost did not grow by collateralIn − fee", { before: before!.netCost, after: after.netCost, net });
      if (after.collateral !== before!.collateral + net) die("collateralOf did not grow by collateralIn − fee", { before: before!.collateral, after: after.collateral, net });
      return out({ ok: true, sharesOut: ev!.sharesOut, fee: ev!.fee, legs, netCost: after.netCost, agentEscrow: after.escrow, quoteMatched: true });
    }
    case "sell": {
      const { ov, m } = await market(id!);
      const outcome = outcomeOf(args.side);
      const shares = BigInt(String(args.shares));
      const fm = ov.feeModel;
      const feeBps = tradeFeeBps(fm);
      if (feeBps === undefined) die("fee model unknown: the UI would not quote", { feeModel: fm });
      const q = quoteSell(m, outcome, shares, feeBps!);
      if (!q) die("quoteSell returned null");
      const floor = minOutWithSlippage(q!.collateralOut, SLIPPAGE_BPS);
      const before = fm.kind === "trade" ? await books(m.id, acct!.address) : undefined;
      const r = await send(P.MarketsPerennial!, marketsPerennialAbi, "sell", [m.id, outcome, shares, floor]);
      const ev = eventArgs(r.logs as never, "Sold");
      if (!ev) die("no Sold event");
      if (ev!.collateralOut !== q!.collateralOut || ev!.fee !== q!.fee) die("chain disagrees with the UI sell quote", { quote: q, chain: ev });
      if (fm.kind !== "trade") return out({ ok: true, collateralOut: ev!.collateralOut, fee: ev!.fee, quoteMatched: true });
      const after = await books(m.id, acct!.address);
      const grossOut = ev!.collateralOut + ev!.fee;
      const legs = checkTradeFee(fm, grossOut, ev!.fee, r.logs as never, before!, after, m.builderId);
      const reduce = before!.netCost < grossOut ? before!.netCost : grossOut;
      if (after.netCost !== before!.netCost - reduce) die("netCost did not shrink by min(netCost, grossOut)", { before: before!.netCost, after: after.netCost, grossOut });
      if (after.collateral !== before!.collateral - grossOut) die("collateralOf did not shrink by grossOut", { before: before!.collateral, after: after.collateral, grossOut });
      return out({ ok: true, collateralOut: ev!.collateralOut, grossOut, fee: ev!.fee, legs, netCost: after.netCost, agentEscrow: after.escrow, quoteMatched: true });
    }
    case "status": {
      const { ov, m } = await market(id!);
      return out({ ok: true, phase: m.phase, settlement: m.settlement, yesWon: m.yesWon, feeModel: ov.feeModel,
        collateral: m.collateral ?? null, agentEscrow: m.agentEscrow ?? null,
        status: marketStatus({ phase: m.phase, yesWon: m.yesWon, expiry: m.expiry, chainNow: ov.chainNow, settlement: m.settlement, supportsSettlement: ov.supportsSettlement, feeModel: ov.feeModel }).key });
    }
    case "resolve":
    case "voidMarket": {
      const { ov } = await market(id!);
      const fm = ov.feeModel;
      if (fm.kind !== "trade") {
        await send(P.MarketsPerennial!, marketsPerennialAbi, args.action, [id]);
        return out({ ok: true });
      }
      // v3: nothing is charged at settlement; only the held agent escrow moves.
      const [collateral, totalNetCost, escrow] = await Promise.all([view("collateralOf", id!), view("totalNetCost", id!), view("agentEscrow", id!)]);
      const r = await send(P.MarketsPerennial!, marketsPerennialAbi, args.action, [id]);
      const escrowAfter = await view("agentEscrow", id!);
      if (escrowAfter !== 0n) die("agentEscrow was not emptied at settlement", { before: escrow, after: escrowAfter });
      if (args.action === "resolve") {
        // Normally the keeper resolves; kept for manual runs.
        const rel = eventArgs(r.logs as never, "AgentFeeReleased");
        if (escrow > 0n && rel?.amount !== escrow) die("AgentFeeReleased does not match the held escrow", { escrow, chain: rel ?? null });
        return out({ ok: true, agentFeeReleased: rel?.amount ?? 0n });
      }
      const ev = eventArgs(r.logs as never, "VoidFeesPaid") as (Record<string, bigint> & { challenger?: Address }) | undefined;
      if (!ev) die("no VoidFeesPaid event on voidMarket");
      if (ev!.creatorFee !== 0n) die("a void charged a creator fee", { chain: ev });
      const challenged = Boolean(ev!.challenger && ev!.challenger !== "0x0000000000000000000000000000000000000000");
      // Third field: seasonPoolAmount (BuilderFund), commonsFee before it.
      const sinkAmount = ev!.seasonPoolAmount ?? ev!.sinkAmount ?? ev!.commonsFee;
      const toChallenger = challenged && ev!.challengerReward === escrow && sinkAmount === 0n;
      const toSink = !challenged && sinkAmount === escrow && ev!.challengerReward === 0n;
      if (!(toChallenger || toSink)) die("the held escrow did not go to the challenger XOR the season pool", { escrow, chain: ev });
      if (toSink && escrow > 0n && P.BuilderFund && fm.payee === "builder") {
        const sc = eventArgs(r.logs as never, "SeasonCredited", P.BuilderFund);
        if (sc?.amount !== escrow) die("the unchallenged escrow was not forwarded to the season pool", { escrow, chain: sc ?? null });
      }
      const snap = await readMarketSettlement(pc, P.MarketsPerennial!, id!, PHASE.Voided);
      const want = mirrorVoid(collateral, totalNetCost);
      if (snap.voidTraderPool !== want.voidTraderPool || snap.voidNetCostTotal !== want.voidNetCostTotal) die("void snapshot disagrees with the mirror", { expected: want, chain: snap });
      return out({
        ok: true, collateral, escrow, challenger: ev!.challenger ?? null, challengerReward: ev!.challengerReward, seasonPoolAmount: sinkAmount,
        voidTraderPool: snap.voidTraderPool, voidNetCostTotal: snap.voidNetCostTotal, previewMatched: true,
      });
    }
    case "redeem": {
      const { ov, m } = await market(id!);
      const pos = await position(id!, acct!.address);
      const v3 = ov.feeModel.kind === "trade";
      // Read the contract's own preview BEFORE redeeming, exactly as the panel does.
      const views = v3 ? await readHolderSettlement(pc, P.MarketsPerennial!, id!, acct!.address, m.phase) : {};
      if (v3 && views.redeemable === undefined) die("v3 contract has no redeemable view");
      const mirror = mirrorRedeem(snapshotOf(m), { ...pos, netCost: views.netCost }, ov.feeModel);
      if (mirror === undefined) die("local redeem mirror lacked inputs", { market: m, views });
      if (v3 && views.redeemable !== mirror) die("redeemable view disagrees with the UI mirror", { view: views.redeemable, mirror });
      const r = await send(P.MarketsPerennial!, marketsPerennialAbi, "redeem", [id]);
      const ev = eventArgs(r.logs as never, "Redeemed");
      if (!ev) die("no Redeemed event");
      if (ev!.payout !== mirror) die("chain disagrees with the UI redeem preview", { expected: mirror, view: views.redeemable ?? null, chain: ev!.payout });
      return out({ ok: true, payout: ev!.payout, redeemable: views.redeemable ?? null, mirror, netCost: views.netCost ?? null, previewMatched: true });
    }
    case "claimLP": {
      const { ov, m } = await market(id!);
      const pos = await position(id!, acct!.address);
      const v3 = ov.feeModel.kind === "trade";
      const claimable = v3 ? await holderView("claimableLP", id!, acct!.address) : undefined;
      const mirror = mirrorClaimLP(snapshotOf(m), pos);
      if (v3 && claimable !== mirror) die("claimableLP view disagrees with the UI mirror", { view: claimable, mirror });
      const r = await send(P.MarketsPerennial!, marketsPerennialAbi, "claimLP", [id]);
      const ev = eventArgs(r.logs as never, "LPClaimed");
      const payout = ev?.payout ?? 0n;
      if (payout !== mirror) die("chain disagrees with the UI claimLP preview", { expected: mirror, view: claimable ?? null, chain: payout });
      return out({ ok: true, payout, claimableLP: claimable ?? null, mirror, previewMatched: true });
    }
    case "netCost": {
      const who = (args.who as Address | undefined) ?? acct?.address;
      if (!who) die("netCost needs `who` or `key`");
      const [netCost, totalNetCost] = await Promise.all([holderView("netCost", id!, who!), view("totalNetCost", id!)]);
      return out({ ok: true, who, netCost, totalNetCost });
    }
    case "coverage": {
      // The panel's own path: stack -> bond on the market's feed -> open collateral of
      // the agent's Trading markets on that feed -> assessAgent with the snapshot record.
      const { ov, m } = await market(id!);
      const stack = await resolveStack(pc, P.MarketsPerennial!);
      const bond = await readAgentBond(pc, stack.registry, m.feedId, m.agent);
      const openCollateral = await readOpenCollateral(pc, P.MarketsPerennial!, "perennial", m.agent, m.feedId, m.id,
        ov.markets.map((x: ChainMarket) => ({ id: x.id, phase: x.phase, agent: x.agent, feed: x.feedId })));
      const record = (args.record ?? null) as AgentRecordJson | null;
      const a = assessAgent({ record, indexed: record !== null, bond, openCollateral });
      return out({ ok: true, agent: m.agent, registry: stack.registry ?? null, bond: a.bond ?? null, openCollateral: a.openCollateral ?? null,
        recommended: a.recommended ?? null, level: a.level, coveragePct: a.coveragePct ?? null, tier: a.tier ?? null });
    }
    case "claim": {
      // Build and sign a proof file exactly as /verify does (canonical message, personal_sign).
      const c = args.claim as Claim;
      const message = canonicalClaimMessage(c);
      const builderSig = await privateKeyToAccount(args.builderKey as Hex).signMessage({ message });
      const deployerSigs: Record<string, Hex> = {};
      for (const k of (args.deployerKeys as Hex[] | undefined) ?? []) {
        const a = privateKeyToAccount(k);
        deployerSigs[a.address.toLowerCase()] = await a.signMessage({ message });
      }
      return out({ ok: true, message, file: { version: 1, claim: c, signatures: { builder: builderSig, deployers: deployerSigs } } });
    }
    case "validateProof": {
      const r = await validateProof(args.file, { expectedSource: String(args.expectedSource), onchainOwner: String(args.onchainOwner), chainId: Number(args.chainId) } as never);
      return out({ ok: true, result: r });
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
