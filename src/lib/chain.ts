import { defineChain, type Address } from "viem";
import live from "./live-data.json";

export const ARC_TESTNET = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  network: "arc-testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
    public: { http: ["https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

type LiveContracts = typeof live.contracts & { MarketsEURC?: string; EURC?: string };
const liveContracts = live.contracts as LiveContracts;

export const CONTRACTS = {
  USDC: liveContracts.USDC as Address,
  EURC: (liveContracts.EURC ?? "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a") as Address,
  Registry: liveContracts.Registry as Address,
  Attestation: liveContracts.Attestation as Address,
  Dispute: liveContracts.Dispute as Address,
  Markets: liveContracts.Markets as Address,
  MarketsEURC: liveContracts.MarketsEURC as Address | undefined,
} as const;

export const EXPLORER = live.explorer;

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addrUrl = (addr: string) => `${EXPLORER}/address/${addr}`;
