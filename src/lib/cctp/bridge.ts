/**
 * CCTP v2 burn-and-mint flow, in both directions.
 *
 * The sequence is identical whichever way you go — only the domains swap:
 *
 *   1. approve USDC to BridgeRouter on the source chain
 *   2. router.bridge(...)  -> takes our fee, calls Circle's TokenMessengerV2,
 *                             which burns the remainder and emits DepositForBurn
 *   3. poll Circle's attestation service until the burn is attested
 *   4. MessageTransmitterV2.receiveMessage(message, attestation) on the
 *      destination chain -> native USDC is minted to the recipient
 *
 * Step 4 is permissionless: we pass destinationCaller = 0, so anyone can
 * deliver the mint. If the user closes the tab mid-flight their funds are not
 * stuck — the attestation stays valid and the mint can be claimed later.
 *
 * Nothing here custodies funds. The router holds no balance between
 * transactions and every transfer produces a verifiable DepositForBurn from
 * Circle's own contract.
 */
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  fallback,
  http,
  pad,
  parseUnits,
  formatUnits,
  type Address,
  type Hex,
} from "viem";
import {
  BRIDGE_ROUTER,
  FINALITY_FAST,
  FINALITY_STANDARD,
  MESSAGE_TRANSMITTER_V2,
  ROUTER_FEE_BPS,
  TOKEN_MESSENGER_V2,
  type CctpChain,
} from "./domains";

const IRIS = "https://iris-api.circle.com";

/** Our agents Worker, which also hosts the CCTP mint relayer. */
const RELAYER = "https://registrai-agents.guanyidu98.workers.dev/relay";

export type RelayOutcome =
  | { delivered: true; txHash?: Hex; alreadyDelivered?: boolean }
  | { delivered: false; reason: string };

/**
 * Ask our relayer to deliver the mint on Arc.
 *
 * This is the difference between a bridge that works and one that strands
 * people: the mint is a transaction ON ARC, gas on Arc is USDC, and a
 * first-time user has none. `destinationCaller` is zero in our burns, so the
 * relayer can deliver it and the USDC still lands at the user's address.
 *
 * Failure here is never fatal — the burn and attestation stay valid, and the
 * caller falls back to letting the user mint it themselves.
 */
export async function requestRelay(sourceDomain: number, transactionHash: Hex): Promise<RelayOutcome> {
  try {
    const res = await fetch(RELAYER, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceDomain, transactionHash }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      txHash?: Hex;
      alreadyDelivered?: boolean;
      reason?: string;
    };
    if (res.ok && body.ok) {
      return { delivered: true, txHash: body.txHash, alreadyDelivered: body.alreadyDelivered };
    }
    return { delivered: false, reason: body.reason ?? `relayer returned ${res.status}` };
  } catch (e) {
    return { delivered: false, reason: (e as Error).message ?? "relayer unreachable" };
  }
}

export const bridgeRouterAbi = [
  {
    type: "function",
    name: "bridge",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    outputs: [{ name: "amountBurned", type: "uint256" }],
  },
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [
      { name: "routerFee", type: "uint256" },
      { name: "amountBurned", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "feeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint16" }],
  },
] as const;

export const messageTransmitterAbi = [
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export const tokenMessengerAbi = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    outputs: [],
  },
] as const;

export type Speed = "fast" | "standard";

/**
 * Where the burn is sent from, and what we charge.
 *
 * `direct` calls Circle's TokenMessengerV2 itself and charges nothing. It is
 * how the bridge bootstraps: deploying the router ON Arc costs gas, gas on Arc
 * is USDC, and getting USDC onto Arc requires bridging — so the first
 * transfers must not depend on the router existing.
 *
 * Once the router is deployed the UI picks it up automatically on the next
 * page load. No redeploy, no config change.
 */
export type Route = {
  mode: "router" | "direct";
  /** Contract the user approves USDC to, and that we call. */
  spender: Address;
  routerFeeBps: number;
};

export const DIRECT_ROUTE: Route = {
  mode: "direct",
  spender: TOKEN_MESSENGER_V2,
  routerFeeBps: 0,
};

export const ROUTER_ROUTE: Route = {
  mode: "router",
  spender: BRIDGE_ROUTER,
  routerFeeBps: ROUTER_FEE_BPS,
};

/**
 * Is the router live on this chain? Checked per chain, because deployment
 * rolls out chain by chain and Arc will almost certainly be last.
 */
export async function resolveRoute(chain: CctpChain): Promise<Route> {
  try {
    const client = createPublicClient({
      transport: fallback(chain.readRpcUrls.map((u) => http(u))),
    });
    const code = await client.getCode({ address: BRIDGE_ROUTER });
    return code && code !== "0x" ? ROUTER_ROUTE : DIRECT_ROUTE;
  } catch {
    // If we cannot tell, charge nothing rather than send funds at a contract
    // we have not confirmed exists.
    return DIRECT_ROUTE;
  }
}

/** Burn straight through Circle, no router, no fee. */
export function directBridgeCalldata(params: {
  amount: bigint;
  destinationDomain: number;
  recipient: Address;
  burnToken: Address;
  maxFee: bigint;
  minFinalityThreshold: number;
}): Hex {
  return encodeFunctionData({
    abi: tokenMessengerAbi,
    functionName: "depositForBurn",
    args: [
      params.amount,
      params.destinationDomain,
      toMintRecipient(params.recipient),
      params.burnToken,
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      params.maxFee,
      params.minFinalityThreshold,
    ],
  });
}

export type Quote = {
  /** What the user types, in USDC base units. */
  amountIn: bigint;
  /** Our router fee. */
  routerFee: bigint;
  /** Circle's fee for this route at this speed. */
  cctpFee: bigint;
  /** What actually lands on the destination chain. */
  amountOut: bigint;
  minFinalityThreshold: number;
  /** Circle's fee expressed in bps, as returned by the fee API. */
  cctpFeeBps: number;
};

type FeeTier = { finalityThreshold: number; minimumFee: number };

/**
 * Circle's per-route fee, in basis points. Fast transfers cost a few tenths of
 * a bp; standard is always free. Rates differ per direction, so never assume
 * symmetry: the quote always comes from Circle's live route fee endpoint.
 */
export async function fetchCctpFeeBps(
  srcDomain: number,
  dstDomain: number,
  speed: Speed,
): Promise<number> {
  const res = await fetch(`${IRIS}/v2/burn/USDC/fees/${srcDomain}/${dstDomain}`);
  if (!res.ok) throw new Error(`fee lookup failed (${res.status})`);
  const tiers: FeeTier[] = await res.json();
  const want = speed === "fast" ? FINALITY_FAST : FINALITY_STANDARD;
  const tier = tiers.find((t) => t.finalityThreshold === want);
  if (!tier) throw new Error(`route ${srcDomain}->${dstDomain} has no ${speed} tier`);
  return tier.minimumFee;
}

/** Full cost breakdown before the user signs anything. */
export async function quoteBridge(params: {
  amount: string;
  from: Pick<CctpChain, "domain">;
  to: Pick<CctpChain, "domain">;
  speed: Speed;
  routerFeeBps: number;
}): Promise<Quote> {
  const { amount, from, to, speed, routerFeeBps } = params;
  const amountIn = parseUnits(amount || "0", 6);

  const routerFee = (amountIn * BigInt(routerFeeBps)) / 10_000n;
  const afterRouter = amountIn - routerFee;

  const cctpFeeBps = await fetchCctpFeeBps(from.domain, to.domain, speed);
  // The fee API returns bps as a decimal (e.g. 0.25). Scale to avoid floats.
  const cctpFee = (afterRouter * BigInt(Math.round(cctpFeeBps * 1_000))) / 10_000_000n;

  return {
    amountIn,
    routerFee,
    cctpFee,
    amountOut: afterRouter - cctpFee,
    minFinalityThreshold: speed === "fast" ? FINALITY_FAST : FINALITY_STANDARD,
    cctpFeeBps,
  };
}

/**
 * `maxFee` is the ceiling the user accepts for Circle's fee. Pad the quoted
 * fee so a small rate move between quote and execution doesn't revert the
 * burn, but never so much that a surprise materially hurts.
 */
export function maxFeeFor(quote: Quote): bigint {
  if (quote.minFinalityThreshold === FINALITY_STANDARD) return 0n;
  const padded = (quote.cctpFee * 15n) / 10n;
  return padded > 0n ? padded : 1n;
}

/** Recipient address as the bytes32 CCTP expects. Works for non-EVM too. */
export function toMintRecipient(addr: Address): Hex {
  return pad(addr, { size: 32 });
}

export function approvalCalldata(spender: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount],
  });
}

export function bridgeCalldata(params: {
  amount: bigint;
  destinationDomain: number;
  recipient: Address;
  maxFee: bigint;
  minFinalityThreshold: number;
}): Hex {
  return encodeFunctionData({
    abi: bridgeRouterAbi,
    functionName: "bridge",
    args: [
      params.amount,
      params.destinationDomain,
      toMintRecipient(params.recipient),
      params.maxFee,
      params.minFinalityThreshold,
    ],
  });
}

export function receiveCalldata(message: Hex, attestation: Hex): Hex {
  return encodeFunctionData({
    abi: messageTransmitterAbi,
    functionName: "receiveMessage",
    args: [message, attestation],
  });
}

export type AttestedMessage = {
  message: Hex;
  attestation: Hex;
  status: string;
  eventNonce?: string;
};

/**
 * Poll Circle until the burn is attested. Fast transfers typically attest in
 * seconds; standard waits for source-chain finality.
 *
 * A pending attestation is never a lost transfer — the burn already happened
 * on-chain and the attestation will eventually be issued, so this is safe to
 * abandon and resume from the burn tx hash.
 */
export async function waitForAttestation(params: {
  sourceDomain: number;
  transactionHash: Hex;
  signal?: AbortSignal;
  pollMs?: number;
  timeoutMs?: number;
  onPoll?: (status: string, elapsedMs: number) => void;
}): Promise<AttestedMessage> {
  const { sourceDomain, transactionHash, signal, onPoll } = params;
  const pollMs = params.pollMs ?? 4_000;
  const timeoutMs = params.timeoutMs ?? 30 * 60_000;
  const started = Date.now();

  for (;;) {
    if (signal?.aborted) throw new Error("attestation polling aborted");
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        "attestation timed out. The burn is on-chain and still valid — " +
          "resume from the burn transaction hash.",
      );
    }

    const url = `${IRIS}/v2/messages/${sourceDomain}?transactionHash=${transactionHash}`;
    const res = await fetch(url, { signal });

    if (res.ok) {
      const body = await res.json();
      const found = body?.messages?.[0];
      const status = found?.status ?? "pending";
      onPoll?.(status, Date.now() - started);

      if (status === "complete" && found.attestation && found.attestation !== "PENDING") {
        return {
          message: found.message as Hex,
          attestation: found.attestation as Hex,
          status,
          eventNonce: found.eventNonce,
        };
      }
    } else if (res.status !== 404) {
      // 404 simply means Circle has not indexed the burn yet.
      throw new Error(`attestation lookup failed (${res.status})`);
    } else {
      onPoll?.("indexing", Date.now() - started);
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** Has this message already been minted on the destination chain? */
export async function isAlreadyReceived(params: {
  chain: CctpChain;
  eventNonce: string;
}): Promise<boolean> {
  const client = createPublicClient({
    transport: fallback(params.chain.readRpcUrls.map((u) => http(u))),
  });
  try {
    const used = await client.readContract({
      address: MESSAGE_TRANSMITTER_V2,
      abi: [
        {
          type: "function",
          name: "usedNonces",
          stateMutability: "view",
          inputs: [{ name: "nonce", type: "bytes32" }],
          outputs: [{ type: "uint256" }],
        },
      ] as const,
      functionName: "usedNonces",
      args: [params.eventNonce as Hex],
    });
    return used > 0n;
  } catch {
    return false;
  }
}

export const fmtUsdc = (v: bigint) => formatUnits(v, 6);

export { BRIDGE_ROUTER, MESSAGE_TRANSMITTER_V2 };
