/**
 * Chain reads for the fee & settlement model v3 (MarketsPerennial + MarketsV4).
 *
 * abi.ts is regenerated from the contracts separately, so everything the v3
 * model uses is declared here as a hand-written fragment with the exact names
 * from the spec, and everything is PROBED: testnet still runs the legacy
 * contracts, where these views revert. Legacy fee reads (FEE_BPS_TOTAL & co.)
 * are only made after the v3 probe (TRADE_FEE_BPS) reverted.
 */
import { BaseError, ContractFunctionRevertedError, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { PHASE } from "./perennial-market";
import { feeModelFromProbe, type FeeFlavor, type FeeModel, type FeeProbe } from "./market-fees";

/** v3 constants, accounting and preview views, and fee events (both contracts;
 *  MarketsV4 names the 50% leg TREASURY_SHARE_BPS). */
export const marketFeesAbi = parseAbi([
  "function TRADE_FEE_BPS() view returns (uint256)",
  "function CREATOR_SHARE_BPS() view returns (uint256)",
  "function AGENT_SHARE_BPS() view returns (uint256)",
  "function COMMONS_SHARE_BPS() view returns (uint256)",
  "function TREASURY_SHARE_BPS() view returns (uint256)",
  "function agentEscrow(bytes32 marketId) view returns (uint256)",
  "function collateralOf(bytes32 marketId) view returns (uint256)",
  "function netCost(bytes32 marketId, address trader) view returns (uint256)",
  "function totalNetCost(bytes32 marketId) view returns (uint256)",
  "function voidTraderPool(bytes32 marketId) view returns (uint256)",
  "function voidNetCostTotal(bytes32 marketId) view returns (uint256)",
  "function redeemable(bytes32 marketId, address who) view returns (uint256)",
  "function claimableLP(bytes32 marketId, address who) view returns (uint256)",
  "event Bought(bytes32 indexed marketId, address indexed buyer, uint8 outcome, uint256 collateralIn, uint256 sharesOut, uint256 fee)",
  "event Sold(bytes32 indexed marketId, address indexed seller, uint8 outcome, uint256 sharesIn, uint256 collateralOut, uint256 fee)",
  "event FeesPaid(bytes32 indexed marketId, uint256 creatorFee, uint256 commonsFee, uint256 agentFee)",
  "event AgentFeeReleased(bytes32 indexed marketId, address indexed agent, uint256 amount)",
  "event VoidFeesPaid(bytes32 indexed marketId, uint256 creatorFee, uint256 commonsFee, uint256 challengerReward, address challenger)",
]);

/** LEGACY MarketsPerennial fee reads (called only after the v3 probe reverts). */
export const legacyPerennialFeeAbi = parseAbi([
  "function FEE_BPS_TOTAL() view returns (uint256)",
  "function creatorBps() view returns (uint256)",
  "function treasuryBps() view returns (uint256)",
  "function agentBps() view returns (uint256)",
]);

/** LEGACY MarketsV4 fee reads (called only after the v3 probe reverts). */
export const legacyV4FeeAbi = parseAbi([
  "function FEE_BPS_TOTAL() view returns (uint256)",
  "function FEE_BPS_CREATOR() view returns (uint256)",
  "function FEE_BPS_AGENT() view returns (uint256)",
  "function FEE_BPS_TREASURY() view returns (uint256)",
]);

/** True when a call failed because the contract reverted (vs. a transport error). */
export function isRevert(e: unknown): boolean {
  if (!(e instanceof BaseError)) return false;
  return Boolean(e.walk((x) => x instanceof ContractFunctionRevertedError));
}

/** Read a view that may not exist on this deployment: undefined on revert,
 *  transport errors still throw. */
async function tryView<T>(p: Promise<unknown>): Promise<T | undefined> {
  try {
    return (await p) as T;
  } catch (e) {
    if (isRevert(e)) return undefined;
    throw e;
  }
}

/** Probe the fee model: v3 when TRADE_FEE_BPS answers, else the legacy fee reads. */
export async function readFeeModel(client: PublicClient, address: Address, flavor: FeeFlavor): Promise<FeeModel> {
  const view = (functionName: "TRADE_FEE_BPS" | "CREATOR_SHARE_BPS" | "AGENT_SHARE_BPS" | "COMMONS_SHARE_BPS" | "TREASURY_SHARE_BPS") =>
    tryView<bigint>(client.readContract({ address, abi: marketFeesAbi, functionName }));
  const probe: FeeProbe = { v3: null, legacy: null };
  const feeBps = await view("TRADE_FEE_BPS");
  if (feeBps !== undefined) {
    const [creator, agent, commons] = await Promise.all([
      view("CREATOR_SHARE_BPS"),
      view("AGENT_SHARE_BPS"),
      view(flavor === "v4" ? "TREASURY_SHARE_BPS" : "COMMONS_SHARE_BPS"),
    ]);
    probe.v3 = { feeBps, creator, agent, commons };
    return feeModelFromProbe(probe, flavor);
  }
  if (flavor === "perennial") {
    const legacy = (functionName: "FEE_BPS_TOTAL" | "creatorBps" | "treasuryBps" | "agentBps") =>
      tryView<bigint>(client.readContract({ address, abi: legacyPerennialFeeAbi, functionName }));
    const [total, creator, commons, agent] = await Promise.all([legacy("FEE_BPS_TOTAL"), legacy("creatorBps"), legacy("treasuryBps"), legacy("agentBps")]);
    if (total !== undefined) probe.legacy = { totalBps: total, creator, agent, commons };
  } else {
    const legacy = (functionName: "FEE_BPS_TOTAL" | "FEE_BPS_CREATOR" | "FEE_BPS_AGENT" | "FEE_BPS_TREASURY") =>
      tryView<bigint>(client.readContract({ address, abi: legacyV4FeeAbi, functionName }));
    const [total, creator, agent, commons] = await Promise.all([legacy("FEE_BPS_TOTAL"), legacy("FEE_BPS_CREATOR"), legacy("FEE_BPS_AGENT"), legacy("FEE_BPS_TREASURY")]);
    if (total !== undefined) probe.legacy = { totalBps: total, creator, agent, commons };
  }
  return feeModelFromProbe(probe, flavor);
}

/** Per-market v3 accounting; each undefined where the deployment lacks the view. */
export interface MarketSettlementViews {
  /** collateralOf — the pot (trading). */
  collateral?: bigint;
  /** agentEscrow — the agent's held 20% (0 once released or redirected). */
  agentEscrow?: bigint;
  voidTraderPool?: bigint;
  voidNetCostTotal?: bigint;
}

export async function readMarketSettlement(
  client: PublicClient,
  address: Address,
  marketId: Hex,
  phase: number,
): Promise<MarketSettlementViews> {
  const v = (functionName: "collateralOf" | "agentEscrow" | "voidTraderPool" | "voidNetCostTotal") =>
    tryView<bigint>(client.readContract({ address, abi: marketFeesAbi, functionName, args: [marketId] }));
  if (phase === PHASE.Voided) {
    const [voidTraderPool, voidNetCostTotal] = await Promise.all([v("voidTraderPool"), v("voidNetCostTotal")]);
    return { voidTraderPool, voidNetCostTotal };
  }
  if (phase === PHASE.Resolved) return {};
  const [collateral, agentEscrow] = await Promise.all([v("collateralOf"), v("agentEscrow")]);
  return { collateral, agentEscrow };
}

/** Per-holder v3 views; each undefined where the deployment lacks it. */
export interface HolderSettlementViews {
  netCost?: bigint;
  redeemable?: bigint;
  claimableLP?: bigint;
}

export async function readHolderSettlement(
  client: PublicClient,
  address: Address,
  marketId: Hex,
  who: Address,
  phase: number,
): Promise<HolderSettlementViews> {
  const v = (functionName: "netCost" | "redeemable" | "claimableLP") =>
    tryView<bigint>(client.readContract({ address, abi: marketFeesAbi, functionName, args: [marketId, who] }));
  if (phase === PHASE.Trading) return { netCost: await v("netCost") };
  const [netCost, redeemable, claimableLP] = await Promise.all([v("netCost"), v("redeemable"), v("claimableLP")]);
  return { netCost, redeemable, claimableLP };
}
