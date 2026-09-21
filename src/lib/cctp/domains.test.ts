// Written against node:test, ported to vitest so it actually runs — the
// package had no test script before, so these assertions were dead. `assert`
// is kept as-is; only the runner changed.
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  ARC,
  BRIDGE_CHAINS,
  CCTP_CHAINS,
  SOLANA,
  bridgeKitChainName,
  chainByChainId,
  chainByKey,
} from "./domains";
import { isSolanaAddress, validRecipient } from "./solanaBridge";

test("the EVM CCTP registry exposes every ordered cross-chain route", () => {
  const routes = CCTP_CHAINS.flatMap((source) =>
    CCTP_CHAINS.filter((destination) => destination.key !== source.key).map(
      (destination) => `${source.domain}->${destination.domain}`,
    ),
  );

  assert.equal(CCTP_CHAINS.length, 11);
  assert.equal(routes.length, 110);
  assert.equal(new Set(routes).size, routes.length);
  assert.equal(new Set(CCTP_CHAINS.map((chain) => chain.chainId)).size, CCTP_CHAINS.length);
  assert.equal(new Set(CCTP_CHAINS.map((chain) => chain.domain)).size, CCTP_CHAINS.length);
  assert.ok(CCTP_CHAINS.every((chain) => chain.supportsFast));
});

test("Arc mainnet is registered as Circle CCTP domain 26", () => {
  assert.equal(ARC.chainId, 5042);
  assert.equal(ARC.domain, 26);
  assert.equal(ARC.usdc, "0x3600000000000000000000000000000000000000");
  // Wallet installation must point at Circle's own endpoint: a third-party RPC
  // installed in a user's wallet controls every balance and confirmation they
  // see, and the arc-scan operator has a documented no-burn incident.
  assert.equal(ARC.walletRpcUrl, "https://rpc.mainnet.arc.io");
  assert.ok(!ARC.walletRpcUrl.includes("arc-scan"));
  assert.equal(chainByKey("arc"), ARC);
  assert.equal(chainByChainId(5042), ARC);
});

test("Solana expands the registry to every one of 132 ordered routes", () => {
  const routes = BRIDGE_CHAINS.flatMap((source) =>
    BRIDGE_CHAINS.filter((destination) => destination.key !== source.key).map(
      (destination) => `${source.domain}->${destination.domain}`,
    ),
  );

  assert.equal(BRIDGE_CHAINS.length, 12);
  assert.equal(routes.length, 132);
  assert.equal(new Set(routes).size, routes.length);
  assert.equal(SOLANA.domain, 5);
  assert.equal(SOLANA.usdc, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  assert.equal(bridgeKitChainName(SOLANA), "Solana");
  assert.equal(bridgeKitChainName(CCTP_CHAINS.find((chain) => chain.key === "optimism")!), "Optimism");
  assert.equal(bridgeKitChainName(CCTP_CHAINS.find((chain) => chain.key === "worldchain")!), "World_Chain");
});

test("recipient validation rejects cross-ecosystem address mistakes", () => {
  const solanaAddress = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const evmAddress = "0x000000000000000000000000000000000000dEaD";
  assert.ok(isSolanaAddress(solanaAddress));
  assert.ok(isSolanaAddress("11111111111111111111111111111111"));
  assert.ok(validRecipient(SOLANA, solanaAddress));
  assert.equal(validRecipient(SOLANA, evmAddress), false);
  assert.ok(validRecipient(ARC, evmAddress));
  assert.equal(validRecipient(ARC, solanaAddress), false);
});
