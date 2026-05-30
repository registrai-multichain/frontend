/**
 * Map raw viem / wallet errors into a single sentence a non-dev user can act on.
 * Falls through to a generic message rather than the raw stack trace so the
 * UI never displays "ContractFunctionExecutionError: execution reverted…"
 * to a fresh visitor.
 */
export function humanizeError(e: unknown): string {
  const raw =
    e instanceof Error
      ? `${e.message}`
      : typeof e === "string"
        ? e
        : String(e);
  const s = raw.toLowerCase();

  // Wallet-side rejections (most common case)
  if (s.includes("user rejected") || s.includes("user denied") || s.includes("rejected the request"))
    return "Signature cancelled in your wallet.";
  if (s.includes("eip-1193")) return "Wallet refused the request.";

  // No funds
  if (s.includes("transfer amount exceeds balance") || s.includes("insufficient balance"))
    return "Not enough testnet USDC in your wallet. Grab some from faucet.circle.com.";
  if (s.includes("insufficient funds") || s.includes("exceeds the balance"))
    return "Not enough gas. Top up testnet USDC at faucet.circle.com (gas is paid in USDC on Arc).";
  if (s.includes("erc20: transfer amount exceeds allowance"))
    return "Token allowance too low. Try again — the approval step should run first.";

  // Slippage / market state
  if (s.includes("slippageexceeded"))
    return "Price moved between simulation and submission. Try again.";
  if (s.includes("marketexpired"))
    return "Market has already expired.";
  if (s.includes("marketnotexpired") || s.includes("nottrading"))
    return "Market not in tradable state.";
  if (s.includes("alreadyresolved"))
    return "Market is already resolved.";

  // Bonding / agents
  if (s.includes("bondtoolow"))
    return "Bond is below the feed's minimum (10 USDC for first-party feeds).";
  if (s.includes("alreadyregistered"))
    return "This address is already registered as an agent on this feed.";
  if (s.includes("agentinactive"))
    return "Agent is not active — likely missing bond or slashed.";
  if (s.includes("agenthasrule"))
    return "Agent is rule-bound — use the verifiable submission path.";
  if (s.includes("agenthasnorule"))
    return "Agent is not rule-bound — use the plain submission path.";

  // RPC / network
  // The Canteen swarm endpoint (often pre-configured in wallets from the
  // hackathon docs) rejects writes with this error. Point the wallet's Arc
  // network at the Arc-official RPC instead.
  if (
    s.includes("version of json-rpc protocol is not supported") ||
    s.includes("json-rpc protocol is not supported") ||
    s.includes("jsonrpc version")
  )
    return "Your wallet's Arc RPC is rejecting the transaction. In MetaMask → Settings → Networks → Arc Testnet, set the RPC URL to https://rpc.testnet.arc.network and retry.";
  if (s.includes("network") && (s.includes("disconnected") || s.includes("error")))
    return "Network issue. Check your RPC and try again.";
  if (s.includes("nonce too low"))
    return "Nonce out of sync. Refresh and try again.";
  if (s.includes("execution reverted"))
    return "Transaction reverted onchain. The conditions weren't met — try smaller size or different parameters.";

  // Connection
  if (s.includes("no wallet"))
    return "No wallet detected. Install MetaMask or Rabby first.";
  if (s.includes("chain mismatch") || s.includes("unrecognized chain"))
    return "Wrong network. Switch to Arc testnet (chain id 5042002).";

  // Fall through — clip the raw message
  const generic = raw.replace(/\n.*/s, "").slice(0, 140);
  return generic || "Something went wrong.";
}
