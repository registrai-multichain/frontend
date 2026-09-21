"use client";

import type { BridgeChain } from "./domains";
import { bridgeKitChainName, isSolanaChain } from "./domains";
import type { Speed } from "./bridge";
import type { BridgeParams } from "@circle-fin/bridge-kit";

export type InjectedSolanaProvider = {
  publicKey?: { toString: () => string };
  isConnected?: boolean;
  connect: () => Promise<{ publicKey?: { toString: () => string } } | void>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

type SolanaWindow = typeof globalThis & {
  phantom?: { solana?: InjectedSolanaProvider };
  solflare?: InjectedSolanaProvider;
  backpack?: { solana?: InjectedSolanaProvider };
  solana?: InjectedSolanaProvider;
};

type EvmProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export type CircleBridgeReceipt = {
  sourceUrl?: string;
  destinationUrl?: string;
  sourceTx?: string;
  destinationTx?: string;
};

export function detectSolanaProvider(): InjectedSolanaProvider | undefined {
  if (typeof window === "undefined") return undefined;
  const injected = globalThis as SolanaWindow;
  return (
    injected.phantom?.solana ??
    injected.solflare ??
    injected.backpack?.solana ??
    injected.solana
  );
}

export async function connectSolanaProvider(): Promise<{
  address: string;
  provider: InjectedSolanaProvider;
}> {
  const provider = detectSolanaProvider();
  if (!provider) {
    throw new Error("No Solana wallet found. Install Phantom, Solflare, or Backpack.");
  }
  const response = await provider.connect();
  const address = response?.publicKey?.toString() ?? provider.publicKey?.toString();
  if (!address || !isSolanaAddress(address)) {
    throw new Error("The Solana wallet connected without returning a valid address.");
  }
  return { address, provider };
}

export function getInjectedEvmProvider(): EvmProvider {
  const provider = (globalThis as { ethereum?: EvmProvider }).ethereum;
  if (!provider) throw new Error("No EVM wallet found. Install a compatible wallet.");
  return provider;
}

/** Base58 decode only as far as needed to prove a Solana public key is 32 bytes. */
export function isSolanaAddress(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let decoded = 0n;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return false;
    decoded = decoded * 58n + BigInt(digit);
  }
  let leadingZeroes = 0;
  while (leadingZeroes < value.length && value[leadingZeroes] === "1") leadingZeroes += 1;
  const decodedBytes = decoded === 0n ? 0 : Math.ceil(decoded.toString(16).length / 2);
  return decodedBytes + leadingZeroes === 32;
}

export function isEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function validRecipient(chain: BridgeChain, value: string): boolean {
  return isSolanaChain(chain) ? isSolanaAddress(value) : isEvmAddress(value);
}

function circleParams(params: {
  sourceAdapter: unknown;
  from: BridgeChain;
  to: BridgeChain;
  amount: string;
  recipientAddress: string;
  speed: Speed;
}) {
  return {
    from: {
      adapter: params.sourceAdapter,
      chain: bridgeKitChainName(params.from),
    },
    to: {
      chain: bridgeKitChainName(params.to),
      recipientAddress: params.recipientAddress,
      useForwarder: true as const,
    },
    amount: params.amount,
    token: "USDC" as const,
    config: {
      transferSpeed: params.speed === "fast" ? ("FAST" as const) : ("SLOW" as const),
    },
    invocationMeta: {
      callers: [{ type: "app" as const, name: "Registrai Bridge", version: "1" }],
    },
  };
}

async function sourceAdapter(from: BridgeChain, solanaProvider?: InjectedSolanaProvider) {
  if (isSolanaChain(from)) {
    const { createSolanaKitAdapterFromProvider } = await import(
      "@circle-fin/adapter-solana-kit"
    );
    const provider = solanaProvider ?? detectSolanaProvider();
    if (!provider) throw new Error("Connect a Solana wallet first.");
    return createSolanaKitAdapterFromProvider({
      provider: provider as Parameters<typeof createSolanaKitAdapterFromProvider>[0]["provider"],
    });
  }

  const { createViemAdapterFromProvider } = await import("@circle-fin/adapter-viem-v2");
  return createViemAdapterFromProvider({
    provider: getInjectedEvmProvider() as Parameters<
      typeof createViemAdapterFromProvider
    >[0]["provider"],
  });
}

/**
 * Routes involving Solana use Circle's production Bridge Kit and Forwarding
 * Service. The user signs only on the source; Circle pays the destination gas.
 */
export async function runCircleBridge(params: {
  from: BridgeChain;
  to: BridgeChain;
  amount: string;
  recipientAddress: string;
  speed: Speed;
  solanaProvider?: InjectedSolanaProvider;
}): Promise<CircleBridgeReceipt> {
  const [{ BridgeKit }, adapter] = await Promise.all([
    import("@circle-fin/bridge-kit"),
    sourceAdapter(params.from, params.solanaProvider),
  ]);
  const kit = new BridgeKit({ disableErrorReporting: true });
  const result = await kit.bridge(
    circleParams({ ...params, sourceAdapter: adapter }) as BridgeParams,
  );
  if (result.state !== "success") throw new Error("Circle did not complete the transfer.");

  const transactionSteps = result.steps.filter((step) => Boolean(step.txHash));
  const source = transactionSteps[0];
  const destination = transactionSteps.at(-1);
  return {
    sourceTx: source?.txHash,
    sourceUrl: source?.explorerUrl,
    destinationTx: destination?.txHash,
    destinationUrl: destination?.explorerUrl,
  };
}
