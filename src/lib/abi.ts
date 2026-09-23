/**
 * Minimal ABI fragments for the UI's chain interactions. Add functions as
 * the surface grows — keep this lean to minimize bundle size.
 */
export const usdcAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export const agentIdentityAbi = [
  { type: "function", name: "setProfile", stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" },
      { name: "description", type: "string" },
      { name: "url", type: "string" },
      { name: "contact", type: "string" },
    ],
    outputs: [] },
  { type: "function", name: "getProfile", stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ type: "tuple", components: [
      { name: "name", type: "string" },
      { name: "description", type: "string" },
      { name: "url", type: "string" },
      { name: "contact", type: "string" },
      { name: "registeredAt", type: "uint64" },
      { name: "updatedAt", type: "uint64" },
      { name: "exists", type: "bool" },
    ] }] },
  { type: "function", name: "hasProfile", stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ type: "bool" }] },
] as const;

export const vaultAbi = [
  { type: "function", name: "deposit", stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable",
    inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nav", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalShares", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "sharesOf", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pricePerShare", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "operator", stateMutability: "view",
    inputs: [], outputs: [{ type: "address" }] },
] as const;

export const marketsAbi = [
  {
    type: "function",
    name: "createMarket",
    stateMutability: "nonpayable",
    inputs: [
      { name: "feedId", type: "bytes32" },
      { name: "agent", type: "address" },
      { name: "threshold", type: "int256" },
      { name: "comparator", type: "uint8" },
      { name: "expiry", type: "uint256" },
      { name: "liquidity", type: "uint256" },
    ],
    outputs: [{ name: "marketId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "buy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "outcome", type: "uint8" },
      { name: "collateralIn", type: "uint256" },
      { name: "minSharesOut", type: "uint256" },
    ],
    outputs: [{ name: "sharesOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "outcome", type: "uint8" },
      { name: "sharesIn", type: "uint256" },
      { name: "minCollateralOut", type: "uint256" },
    ],
    outputs: [{ name: "collateralOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [{ name: "payout", type: "uint256" }],
  },
  {
    type: "function",
    name: "resolve",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getMarket",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "feedId", type: "bytes32" },
          { name: "agent", type: "address" },
          { name: "threshold", type: "int256" },
          { name: "comparator", type: "uint8" },
          { name: "expiry", type: "uint256" },
          { name: "creator", type: "address" },
          { name: "yesReserve", type: "uint256" },
          { name: "noReserve", type: "uint256" },
          { name: "phase", type: "uint8" },
          { name: "yesWon", type: "bool" },
          { name: "createdAt", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "yesBalance",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "noBalance",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "feeEarnings",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "addLiquidity",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claimLP",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "lpShares",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const registryAbi = [
  {
    type: "function",
    name: "getAgent",
    stateMutability: "view",
    inputs: [
      { name: "feedId", type: "bytes32" },
      { name: "agent", type: "address" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "agentMethodologyHash", type: "bytes32" },
          { name: "bond", type: "uint256" },
          { name: "lockedBond", type: "uint256" },
          { name: "registeredAt", type: "uint256" },
          { name: "lastAttestationAt", type: "uint256" },
          { name: "active", type: "bool" },
          { name: "slashed", type: "bool" },
        ],
      },
    ],
  },
  { type: "function", name: "createFeed", stateMutability: "nonpayable",
    inputs: [
      { name: "description", type: "string" },
      { name: "methodologyHash", type: "bytes32" },
      { name: "minBond", type: "uint256" },
      { name: "disputeWindow", type: "uint256" },
      { name: "resolver", type: "address" },
    ],
    outputs: [{ type: "bytes32" }] },
  { type: "function", name: "registerAgent", stateMutability: "nonpayable",
    inputs: [
      { name: "feedId", type: "bytes32" },
      { name: "agentMethodologyHash", type: "bytes32" },
      { name: "bondAmount", type: "uint256" },
    ],
    outputs: [] },
  { type: "function", name: "registerAgentWithRule", stateMutability: "nonpayable",
    inputs: [
      { name: "feedId", type: "bytes32" },
      { name: "agentMethodologyHash", type: "bytes32" },
      { name: "bondAmount", type: "uint256" },
      { name: "ruleContract", type: "address" },
    ],
    outputs: [] },
  { type: "function", name: "ruleOf", stateMutability: "view",
    inputs: [
      { name: "feedId", type: "bytes32" },
      { name: "agent", type: "address" },
    ],
    outputs: [{ type: "address" }] },
  { type: "function", name: "getFeed", stateMutability: "view",
    inputs: [{ name: "feedId", type: "bytes32" }],
    outputs: [{ type: "tuple", components: [
      { name: "creator", type: "address" },
      { name: "description", type: "string" },
      { name: "methodologyHash", type: "bytes32" },
      { name: "minBond", type: "uint256" },
      { name: "disputeWindow", type: "uint256" },
      { name: "resolver", type: "address" },
      { name: "createdAt", type: "uint256" },
      { name: "exists", type: "bool" },
    ] }] },
  { type: "function", name: "MIN_BOND", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "MIN_DISPUTE_WINDOW", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export const attestationAbi = [{"type":"constructor","inputs":[{"name":"registry_","type":"address","internalType":"contract Registry"}],"stateMutability":"nonpayable"},{"type":"function","name":"DEPLOYER","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"REGISTRY","inputs":[],"outputs":[{"name":"","type":"address","internalType":"contract Registry"}],"stateMutability":"view"},{"type":"function","name":"attest","inputs":[{"name":"feedId","type":"bytes32","internalType":"bytes32"},{"name":"value","type":"int256","internalType":"int256"},{"name":"inputHash","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"attestationId","type":"bytes32","internalType":"bytes32"}],"stateMutability":"nonpayable"},{"type":"function","name":"attestWithRule","inputs":[{"name":"feedId","type":"bytes32","internalType":"bytes32"},{"name":"rawInputs","type":"int256[]","internalType":"int256[]"}],"outputs":[{"name":"attestationId","type":"bytes32","internalType":"bytes32"}],"stateMutability":"nonpayable"},{"type":"function","name":"dispute","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"firstInWindow","inputs":[{"name":"feedId","type":"bytes32","internalType":"bytes32"},{"name":"agent","type":"address","internalType":"address"},{"name":"from","type":"uint256","internalType":"uint256"},{"name":"to","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"found","type":"bool","internalType":"bool"},{"name":"value","type":"int256","internalType":"int256"},{"name":"timestamp","type":"uint256","internalType":"uint256"},{"name":"finalized","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"getAttestation","inputs":[{"name":"attestationId","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"tuple","internalType":"struct Attestation.AttestationData","components":[{"name":"feedId","type":"bytes32","internalType":"bytes32"},{"name":"agent","type":"address","internalType":"address"},{"name":"value","type":"int256","internalType":"int256"},{"name":"timestamp","type":"uint256","internalType":"uint256"},{"name":"inputHash","type":"bytes32","internalType":"bytes32"},{"name":"methodologyHash","type":"bytes32","internalType":"bytes32"},{"name":"status","type":"uint8","internalType":"enum Attestation.DisputeStatus"},{"name":"finalizedAt","type":"uint256","internalType":"uint256"}]}],"stateMutability":"view"},{"type":"function","name":"historyAt","inputs":[{"name":"feedId","type":"bytes32","internalType":"bytes32"},{"name":"agent","type":"address","internalType":"address"},{"name":"index","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"stateMutability":"view"},{"type":"function","name":"historyLength","inputs":[{"name":"feedId","type":"bytes32","internalType":"bytes32"},{"name":"agent","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"isFinalized","inputs":[{"name":"attestationId","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"latestValue","inputs":[{"name":"feedId","type":"bytes32","internalType":"bytes32"},{"name":"agent","type":"address","internalType":"address"}],"outputs":[{"name":"value","type":"int256","internalType":"int256"},{"name":"timestamp","type":"uint256","internalType":"uint256"},{"name":"finalized","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"points","inputs":[],"outputs":[{"name":"","type":"address","internalType":"contract IRegistraiPoints"}],"stateMutability":"view"},{"type":"function","name":"pointsSet","inputs":[],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"setPoints","inputs":[{"name":"points_","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"setStatus","inputs":[{"name":"attestationId","type":"bytes32","internalType":"bytes32"},{"name":"status","type":"uint8","internalType":"enum Attestation.DisputeStatus"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"valueAt","inputs":[{"name":"feedId","type":"bytes32","internalType":"bytes32"},{"name":"agent","type":"address","internalType":"address"},{"name":"atTimestamp","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"value","type":"int256","internalType":"int256"},{"name":"finalized","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"wire","inputs":[{"name":"dispute_","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"event","name":"Attested","inputs":[{"name":"attestationId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"feedId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"agent","type":"address","indexed":true,"internalType":"address"},{"name":"value","type":"int256","indexed":false,"internalType":"int256"},{"name":"inputHash","type":"bytes32","indexed":false,"internalType":"bytes32"},{"name":"finalizedAt","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"PointsContractSet","inputs":[{"name":"oldPoints","type":"address","indexed":true,"internalType":"address"},{"name":"newPoints","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},{"type":"event","name":"StatusUpdated","inputs":[{"name":"attestationId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"status","type":"uint8","indexed":false,"internalType":"enum Attestation.DisputeStatus"}],"anonymous":false},{"type":"error","name":"AgentHasNoRule","inputs":[]},{"type":"error","name":"AgentHasRule","inputs":[]},{"type":"error","name":"AgentInactive","inputs":[]},{"type":"error","name":"AlreadyWired","inputs":[]},{"type":"error","name":"AttestationMissing","inputs":[]},{"type":"error","name":"DuplicateAttestation","inputs":[]},{"type":"error","name":"FeedMissing","inputs":[]},{"type":"error","name":"InsufficientAvailableBond","inputs":[]},{"type":"error","name":"InvalidStatusTransition","inputs":[]},{"type":"error","name":"NotAuthorized","inputs":[]}] as const;

// ───────────────── v0.5 alpha: CirqueLending + AttestedBTCOracle ─────────────

export const cirqueLendingAbi = [
  // Supply side
  {
    type: "function", name: "supplyUSDC", stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [{ name: "sharesMinted", type: "uint256" }],
  },
  {
    type: "function", name: "withdrawUSDC", stateMutability: "nonpayable",
    inputs: [{ name: "shareAmount", type: "uint256" }],
    outputs: [{ name: "usdcOut", type: "uint256" }],
  },
  // Borrow side
  {
    type: "function", name: "borrow", stateMutability: "nonpayable",
    inputs: [
      { name: "collateralAmount", type: "uint256" },
      { name: "usdcAmount", type: "uint256" },
    ],
    outputs: [{ name: "openingHealthBps", type: "uint256" }],
  },
  {
    type: "function", name: "repay", stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function", name: "liquidate", stateMutability: "nonpayable",
    inputs: [{ name: "borrower", type: "address" }],
    outputs: [],
  },
  // Views
  {
    type: "function", name: "shares", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "totalShares", stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "totalBorrowedPrincipal", stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "balanceOfUSDC", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "totalPoolValueUSDC", stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "availableUSDC", stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "loans", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "collateral", type: "uint256" },
      { name: "principal", type: "uint256" },
      { name: "borrowedAt", type: "uint256" },
      { name: "active", type: "bool" },
      { name: "marketId", type: "bytes32" },
      { name: "betYes", type: "bool" },
      { name: "betShares", type: "uint256" },
    ],
  },
  {
    type: "function", name: "healthBps", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "interestOwed", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "maxBorrow", stateMutability: "view",
    inputs: [{ name: "cirBTCAmount", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "MAX_LTV_BPS", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "LIQ_LTV_BPS", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "INTEREST_BPS_PER_YEAR", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "MAX_COLLATERAL_PER_USER", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "MAX_USDC_SUPPLY_PER_USER", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  // ── leverage (v0.5 beta) ──
  {
    type: "function", name: "leverageAndBet", stateMutability: "nonpayable",
    inputs: [
      { name: "collateralAmount", type: "uint256" },
      { name: "usdcToBorrow", type: "uint256" },
      { name: "marketId", type: "bytes32" },
      { name: "betYes", type: "bool" },
      { name: "minSharesOut", type: "uint256" },
    ],
    outputs: [
      { name: "openingHealthBps", type: "uint256" },
      { name: "sharesOut", type: "uint256" },
    ],
  },
  {
    type: "function", name: "closePosition", stateMutability: "nonpayable",
    inputs: [{ name: "minProceeds", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function", name: "redeemAtExpiry", stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function", name: "sweepToTreasury", stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "betYes", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function", name: "treasuryYesShares", stateMutability: "view",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "treasuryNoShares", stateMutability: "view",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const attestedBtcOracleAbi = [
  {
    type: "function", name: "getBTCPrice", stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "priceUSDC18", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
    ],
  },
] as const;

/// Minimal cirBTC ERC-20 + Circle-specific guards used in integrity probe.
export const cirBtcAbi = [
  {
    type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "decimals", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint8" }],
  },
  {
    type: "function", name: "approve", stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function", name: "allowance", stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "paused", stateMutability: "view",
    inputs: [], outputs: [{ type: "bool" }],
  },
  {
    type: "function", name: "owner", stateMutability: "view",
    inputs: [], outputs: [{ type: "address" }],
  },
  {
    type: "function", name: "totalSupply", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "isBlacklisted", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

// ─────────── Borrow-against-bet: MarketsV3 share-transfer + CirqueBetLending ──

/// MarketsV3 share-transfer primitive (everything else — buy/sell/priceOf/
/// getMarket — is in marketsAbi, called against the MarketsV3 address).
export const marketsV3ShareAbi = [
  {
    type: "function", name: "setShareOperator", stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function", name: "shareOperatorApproved", stateMutability: "view",
    inputs: [
      { name: "holder", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export const cirqueBetLendingAbi = [
  // Supply side
  {
    type: "function", name: "supplyUSDC", stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [{ name: "sharesMinted", type: "uint256" }],
  },
  {
    type: "function", name: "withdrawUSDC", stateMutability: "nonpayable",
    inputs: [{ name: "shareAmount", type: "uint256" }],
    outputs: [{ name: "usdcOut", type: "uint256" }],
  },
  // Borrow against a held bet
  {
    type: "function", name: "borrowAgainstBet", stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "betYes", type: "bool" },
      { name: "collateralShares", type: "uint256" },
      { name: "usdcAmount", type: "uint256" },
    ],
    outputs: [{ name: "openingHealthBps", type: "uint256" }],
  },
  {
    type: "function", name: "repayBet", stateMutability: "nonpayable",
    inputs: [], outputs: [],
  },
  {
    type: "function", name: "liquidateBet", stateMutability: "nonpayable",
    inputs: [{ name: "borrower", type: "address" }], outputs: [],
  },
  {
    type: "function", name: "writeOffBadDebt", stateMutability: "nonpayable",
    inputs: [{ name: "borrower", type: "address" }], outputs: [],
  },
  // Views — supply
  {
    type: "function", name: "shares", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "totalShares", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "balanceOfUSDC", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "totalPoolValueUSDC", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "availableUSDC", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "totalBorrowedPrincipal", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "totalBadDebtRealizedUSDC", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  // Views — loan
  {
    type: "function", name: "loans", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "marketId", type: "bytes32" },
      { name: "betYes", type: "bool" },
      { name: "shares", type: "uint256" },
      { name: "principal", type: "uint256" },
      { name: "borrowedAt", type: "uint256" },
      { name: "active", type: "bool" },
      { name: "markValueAtBorrow", type: "uint256" },
    ],
  },
  {
    type: "function", name: "healthBps", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "interestOwed", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "collateralValueUSDC", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "isWriteOffable", stateMutability: "view",
    inputs: [{ name: "borrower", type: "address" }], outputs: [{ type: "bool" }],
  },
  {
    type: "function", name: "maxBorrow", stateMutability: "view",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "betYes", type: "bool" },
      { name: "collateralShares", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  // Constants
  {
    type: "function", name: "MAX_LTV_BPS", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "LIQ_LTV_BPS", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "LIQ_BONUS_BPS", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "INTEREST_BPS_PER_YEAR", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "MAX_BORROW_PER_USER", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "MIN_POOL_DEPTH", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "FORCE_CLOSE_WINDOW", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
] as const;

// ───────────── Suffix Pool — SuffixTreasury (read-only views) ─────────────
// Read-only surface for the explainer/dashboard. No write methods exposed here:
// $aiLP is a security; trading UI is gated on counsel.
export const suffixTreasuryAbi = [
  { type: "function", name: "floorPar", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "seniorFloorPrice", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "aiSpotPrice", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "frothPriceUSDC", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "externalSeniorSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "seniorClaimUSDC", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "juniorEquityUSDC", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "juniorNAVPerToken", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "cushionBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "seniorSolvent", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "totalUSDC", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "poolAi", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "poolUsdc", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "feesBankUsdc", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "seniorCap", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "minCushionBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "K_FLOOR_BPS", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "M_FROTH_BPS", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "SWAP_FEE_BPS", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

// Suffix — $ai memecoin trade methods (senior only; $aiLP is NOT traded here).
export const suffixTradeAbi = [
  { type: "function", name: "buyAi", stateMutability: "nonpayable",
    inputs: [{ name: "usdcIn", type: "uint256" }, { name: "minAiOut", type: "uint256" }],
    outputs: [{ name: "aiOut", type: "uint256" }] },
  { type: "function", name: "sellAi", stateMutability: "nonpayable",
    inputs: [{ name: "aiIn", type: "uint256" }, { name: "minUsdcOut", type: "uint256" }],
    outputs: [{ name: "usdcOut", type: "uint256" }] },
  { type: "function", name: "redeemSeniorAtFloor", stateMutability: "nonpayable",
    inputs: [{ name: "seniorAmount", type: "uint256" }],
    outputs: [{ name: "usdcOut", type: "uint256" }] },
] as const;

// OracleStake — tiered pooled oracle stake (deployed 2026-06-15).
export const oracleStakeAbi = [{"type":"function","name":"ATTESTATION","inputs":[],"outputs":[{"name":"","type":"address","internalType":"contract Attestation"}],"stateMutability":"view"},{"type":"function","name":"REGISTRY","inputs":[],"outputs":[{"name":"","type":"address","internalType":"contract Registry"}],"stateMutability":"view"},{"type":"function","name":"USDC","inputs":[],"outputs":[{"name":"","type":"address","internalType":"contract IERC20"}],"stateMutability":"view"},{"type":"function","name":"accountedBonded","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"accountedDeposits","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"activeOf","inputs":[{"name":"","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"attest","inputs":[{"name":"feedId","type":"bytes32","internalType":"bytes32"},{"name":"value","type":"int256","internalType":"int256"},{"name":"inputHash","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"stateMutability":"nonpayable"},{"type":"function","name":"attestWithRule","inputs":[{"name":"feedId","type":"bytes32","internalType":"bytes32"},{"name":"rawInputs","type":"int256[]","internalType":"int256[]"}],"outputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"stateMutability":"nonpayable"},{"type":"function","name":"bondedOf","inputs":[{"name":"","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"delegateOf","inputs":[{"name":"","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"deployFeed","inputs":[{"name":"description","type":"string","internalType":"string"},{"name":"methHash","type":"bytes32","internalType":"bytes32"},{"name":"minBond","type":"uint256","internalType":"uint256"},{"name":"disputeWindow","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"feedId","type":"bytes32","internalType":"bytes32"}],"stateMutability":"nonpayable"},{"type":"function","name":"deployFeedWithRule","inputs":[{"name":"description","type":"string","internalType":"string"},{"name":"methHash","type":"bytes32","internalType":"bytes32"},{"name":"minBond","type":"uint256","internalType":"uint256"},{"name":"disputeWindow","type":"uint256","internalType":"uint256"},{"name":"ruleContract","type":"address","internalType":"address"}],"outputs":[{"name":"feedId","type":"bytes32","internalType":"bytes32"}],"stateMutability":"nonpayable"},{"type":"function","name":"depositOf","inputs":[{"name":"","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"exitFeed","inputs":[{"name":"feedId","type":"bytes32","internalType":"bytes32"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"feeSink","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"feedDead","inputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"feedExited","inputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"floorConst","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"freeOf","inputs":[{"name":"d","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"lastReserved","inputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"liveFeeds","inputs":[{"name":"d","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"bytes32[]","internalType":"bytes32[]"}],"stateMutability":"view"},{"type":"function","name":"neutralResolver","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"ownerOf","inputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"perOracleFloorFor","inputs":[{"name":"feedId","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"quotaOf","inputs":[{"name":"d","type":"address","internalType":"address"}],"outputs":[{"name":"quota","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"setDelegate","inputs":[{"name":"delegate","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"skimFees","inputs":[],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"slashPenaltyBps","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"stake","inputs":[{"name":"amount","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"strandedOf","inputs":[{"name":"","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"syncFeed","inputs":[{"name":"feedId","type":"bytes32","internalType":"bytes32"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"tierCount","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"tiers","inputs":[{"name":"","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"minStake","type":"uint256","internalType":"uint256"},{"name":"maxOracles","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"topUp","inputs":[{"name":"amount","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"topUpFeed","inputs":[{"name":"feedId","type":"bytes32","internalType":"bytes32"},{"name":"amount","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"withdraw","inputs":[{"name":"amount","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"event","name":"Attested","inputs":[{"name":"deployer","type":"address","indexed":true,"internalType":"address"},{"name":"feedId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"attestationId","type":"bytes32","indexed":false,"internalType":"bytes32"}],"anonymous":false},{"type":"event","name":"DelegateSet","inputs":[{"name":"deployer","type":"address","indexed":true,"internalType":"address"},{"name":"delegate","type":"address","indexed":false,"internalType":"address"}],"anonymous":false},{"type":"event","name":"FeedDeployed","inputs":[{"name":"deployer","type":"address","indexed":true,"internalType":"address"},{"name":"feedId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"perOracleFloor","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"ruleContract","type":"address","indexed":false,"internalType":"address"}],"anonymous":false},{"type":"event","name":"FeedExited","inputs":[{"name":"deployer","type":"address","indexed":true,"internalType":"address"},{"name":"feedId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"returned","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"FeesSkimmed","inputs":[{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"to","type":"address","indexed":false,"internalType":"address"}],"anonymous":false},{"type":"event","name":"ParamSet","inputs":[{"name":"what","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"value","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"addr","type":"address","indexed":false,"internalType":"address"}],"anonymous":false},{"type":"event","name":"RoleAdminChanged","inputs":[{"name":"role","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"previousAdminRole","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"newAdminRole","type":"bytes32","indexed":true,"internalType":"bytes32"}],"anonymous":false},{"type":"event","name":"RoleGranted","inputs":[{"name":"role","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"account","type":"address","indexed":true,"internalType":"address"},{"name":"sender","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},{"type":"event","name":"RoleRevoked","inputs":[{"name":"role","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"account","type":"address","indexed":true,"internalType":"address"},{"name":"sender","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},{"type":"event","name":"SlashReconciled","inputs":[{"name":"deployer","type":"address","indexed":true,"internalType":"address"},{"name":"feedId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"loss","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"penalty","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"dead","type":"bool","indexed":false,"internalType":"bool"},{"name":"newDeposit","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"Staked","inputs":[{"name":"deployer","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"newDeposit","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"TierTableSet","inputs":[],"anonymous":false},{"type":"event","name":"Withdrawn","inputs":[{"name":"deployer","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"newDeposit","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"error","name":"AccessControlBadConfirmation","inputs":[]},{"type":"error","name":"AccessControlUnauthorizedAccount","inputs":[{"name":"account","type":"address","internalType":"address"},{"name":"neededRole","type":"bytes32","internalType":"bytes32"}]},{"type":"error","name":"BadParam","inputs":[]},{"type":"error","name":"BadTierTable","inputs":[]},{"type":"error","name":"CooldownOrWindowOpen","inputs":[]},{"type":"error","name":"DeployRateLimited","inputs":[]},{"type":"error","name":"FeedIsDead","inputs":[]},{"type":"error","name":"FeedUnderBacked","inputs":[]},{"type":"error","name":"FloorBreach","inputs":[]},{"type":"error","name":"NotLiveFeed","inputs":[]},{"type":"error","name":"NotOwner","inputs":[]},{"type":"error","name":"NotOwnerOrDelegate","inputs":[]},{"type":"error","name":"QuotaExceeded","inputs":[]},{"type":"error","name":"ReentrancyGuardReentrantCall","inputs":[]},{"type":"error","name":"SafeERC20FailedOperation","inputs":[{"name":"token","type":"address","internalType":"address"}]},{"type":"error","name":"WrongAttestPath","inputs":[]},{"type":"error","name":"ZeroAmount","inputs":[]}] as const;

// NanoLedger — fully on-chain nanopayment ledger (deployed 2026-06-16).
export const nanoLedgerAbi = [{"type":"function","name":"USDC","inputs":[],"outputs":[{"name":"","type":"address","internalType":"contract IERC20"}],"stateMutability":"view"},{"type":"function","name":"accrue","inputs":[{"name":"poolId","type":"bytes32","internalType":"bytes32"},{"name":"amount","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"allowance","inputs":[{"name":"","type":"address","internalType":"address"},{"name":"","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"approveSpender","inputs":[{"name":"spender","type":"address","internalType":"address"},{"name":"amount","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"balanceOf","inputs":[{"name":"","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"batchPay","inputs":[{"name":"to","type":"address[]","internalType":"address[]"},{"name":"amount","type":"uint256[]","internalType":"uint256[]"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"cancelStream","inputs":[{"name":"id","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"claim","inputs":[{"name":"poolId","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"owed","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},{"type":"function","name":"claimablePool","inputs":[{"name":"poolId","type":"bytes32","internalType":"bytes32"},{"name":"payee","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"claimableStream","inputs":[{"name":"id","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"createPool","inputs":[{"name":"poolId","type":"bytes32","internalType":"bytes32"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"deposit","inputs":[{"name":"amount","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"depositTo","inputs":[{"name":"to","type":"address","internalType":"address"},{"name":"amount","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"internalTransfer","inputs":[{"name":"to","type":"address","internalType":"address"},{"name":"amount","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"isSource","inputs":[{"name":"","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"openStream","inputs":[{"name":"to","type":"address","internalType":"address"},{"name":"ratePerSec","type":"uint256","internalType":"uint256"},{"name":"cap","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"id","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},{"type":"function","name":"setShares","inputs":[{"name":"poolId","type":"bytes32","internalType":"bytes32"},{"name":"payee","type":"address","internalType":"address"},{"name":"newShares","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"settleStream","inputs":[{"name":"id","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"amount","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},{"type":"function","name":"streamCount","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"streamedSoFar","inputs":[{"name":"id","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"streams","inputs":[{"name":"","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"from","type":"address","internalType":"address"},{"name":"to","type":"address","internalType":"address"},{"name":"ratePerSec","type":"uint256","internalType":"uint256"},{"name":"cap","type":"uint256","internalType":"uint256"},{"name":"settled","type":"uint256","internalType":"uint256"},{"name":"start","type":"uint40","internalType":"uint40"},{"name":"closed","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"totalOwed","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"transferFromInternal","inputs":[{"name":"from","type":"address","internalType":"address"},{"name":"to","type":"address","internalType":"address"},{"name":"amount","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"withdraw","inputs":[{"name":"amount","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"event","name":"Accrued","inputs":[{"name":"poolId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"Approval","inputs":[{"name":"owner","type":"address","indexed":true,"internalType":"address"},{"name":"spender","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"Claimed","inputs":[{"name":"poolId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"payee","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"Deposit","inputs":[{"name":"payer","type":"address","indexed":true,"internalType":"address"},{"name":"to","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"InternalTransfer","inputs":[{"name":"from","type":"address","indexed":true,"internalType":"address"},{"name":"to","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"PoolCreated","inputs":[{"name":"poolId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"source","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},{"type":"event","name":"RoleAdminChanged","inputs":[{"name":"role","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"previousAdminRole","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"newAdminRole","type":"bytes32","indexed":true,"internalType":"bytes32"}],"anonymous":false},{"type":"event","name":"RoleGranted","inputs":[{"name":"role","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"account","type":"address","indexed":true,"internalType":"address"},{"name":"sender","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},{"type":"event","name":"RoleRevoked","inputs":[{"name":"role","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"account","type":"address","indexed":true,"internalType":"address"},{"name":"sender","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},{"type":"event","name":"SharesSet","inputs":[{"name":"poolId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"payee","type":"address","indexed":true,"internalType":"address"},{"name":"shares","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"SourceSet","inputs":[{"name":"source","type":"address","indexed":true,"internalType":"address"},{"name":"allowed","type":"bool","indexed":false,"internalType":"bool"}],"anonymous":false},{"type":"event","name":"StreamClosed","inputs":[{"name":"id","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"returnedToSender","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"StreamOpened","inputs":[{"name":"id","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"from","type":"address","indexed":true,"internalType":"address"},{"name":"to","type":"address","indexed":true,"internalType":"address"},{"name":"ratePerSec","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"cap","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"StreamSettled","inputs":[{"name":"id","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"to","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"Withdraw","inputs":[{"name":"owner","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"error","name":"AccessControlBadConfirmation","inputs":[]},{"type":"error","name":"AccessControlUnauthorizedAccount","inputs":[{"name":"account","type":"address","internalType":"address"},{"name":"neededRole","type":"bytes32","internalType":"bytes32"}]},{"type":"error","name":"InsufficientAllowance","inputs":[]},{"type":"error","name":"InsufficientBalance","inputs":[]},{"type":"error","name":"LengthMismatch","inputs":[]},{"type":"error","name":"NoPool","inputs":[]},{"type":"error","name":"NoShares","inputs":[]},{"type":"error","name":"NoStream","inputs":[]},{"type":"error","name":"NotPoolSource","inputs":[]},{"type":"error","name":"NotSource","inputs":[]},{"type":"error","name":"NotStreamOwner","inputs":[]},{"type":"error","name":"PoolExists","inputs":[]},{"type":"error","name":"ReentrancyGuardReentrantCall","inputs":[]},{"type":"error","name":"SafeERC20FailedOperation","inputs":[{"name":"token","type":"address","internalType":"address"}]},{"type":"error","name":"StreamIsClosed","inputs":[]},{"type":"error","name":"ZeroAddress","inputs":[]},{"type":"error","name":"ZeroAmount","inputs":[]}] as const;

// MarketsV4 — binary prediction market settled on NanoLedger (deployed 2026-06-16).
export const marketsV4Abi = [{"type":"constructor","inputs":[{"name":"ledger_","type":"address","internalType":"contract NanoLedger"},{"name":"registry_","type":"address","internalType":"contract Registry"},{"name":"attestation_","type":"address","internalType":"contract Attestation"},{"name":"treasury_","type":"address","internalType":"address"},{"name":"forfeitSink_","type":"address","internalType":"address"},{"name":"settlementWindow_","type":"uint256","internalType":"uint256"},{"name":"resolutionGrace_","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},{"type":"function","name":"ATTESTATION","inputs":[],"outputs":[{"name":"","type":"address","internalType":"contract Attestation"}],"stateMutability":"view"},{"type":"function","name":"FEE_BPS_AGENT","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"FEE_BPS_CREATOR","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"FEE_BPS_TOTAL","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"FEE_BPS_TREASURY","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"FORFEIT_SINK","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"LEDGER","inputs":[],"outputs":[{"name":"","type":"address","internalType":"contract NanoLedger"}],"stateMutability":"view"},{"type":"function","name":"MAX_RESOLUTION_GRACE","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"MAX_SETTLEMENT_WINDOW","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"MIN_LIQUIDITY","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"MIN_RESOLUTION_GRACE","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"MIN_SETTLEMENT_WINDOW","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"REGISTRY","inputs":[],"outputs":[{"name":"","type":"address","internalType":"contract Registry"}],"stateMutability":"view"},{"type":"function","name":"RESOLUTION_GRACE","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"SETTLEMENT_WINDOW","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"TREASURY","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"agentEscrow","inputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"buy","inputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"},{"name":"outcome","type":"uint8","internalType":"enum MarketsV4.Outcome"},{"name":"collateralIn","type":"uint256","internalType":"uint256"},{"name":"minSharesOut","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"sharesOut","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},{"type":"function","name":"claimLP","inputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"payout","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},{"type":"function","name":"createMarket","inputs":[{"name":"feedId","type":"bytes32","internalType":"bytes32"},{"name":"agent","type":"address","internalType":"address"},{"name":"threshold","type":"int256","internalType":"int256"},{"name":"comparator","type":"uint8","internalType":"enum MarketsV4.Comparator"},{"name":"expiry","type":"uint256","internalType":"uint256"},{"name":"liquidity","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"}],"stateMutability":"nonpayable"},{"type":"function","name":"createdBy","inputs":[{"name":"","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"getMarket","inputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"tuple","internalType":"struct MarketsV4.Market","components":[{"name":"feedId","type":"bytes32","internalType":"bytes32"},{"name":"agent","type":"address","internalType":"address"},{"name":"threshold","type":"int256","internalType":"int256"},{"name":"comparator","type":"uint8","internalType":"enum MarketsV4.Comparator"},{"name":"expiry","type":"uint256","internalType":"uint256"},{"name":"creator","type":"address","internalType":"address"},{"name":"yesReserve","type":"uint256","internalType":"uint256"},{"name":"noReserve","type":"uint256","internalType":"uint256"},{"name":"phase","type":"uint8","internalType":"enum MarketsV4.Phase"},{"name":"yesWon","type":"bool","internalType":"bool"},{"name":"createdAt","type":"uint256","internalType":"uint256"}]}],"stateMutability":"view"},{"type":"function","name":"lpPotAtResolution","inputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"lpShares","inputs":[{"name":"","type":"bytes32","internalType":"bytes32"},{"name":"","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"noBalance","inputs":[{"name":"","type":"bytes32","internalType":"bytes32"},{"name":"","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"priceOf","inputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"},{"name":"outcome","type":"uint8","internalType":"enum MarketsV4.Outcome"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"redeem","inputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"payout","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},{"type":"function","name":"resolve","inputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"sell","inputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"},{"name":"outcome","type":"uint8","internalType":"enum MarketsV4.Outcome"},{"name":"sharesIn","type":"uint256","internalType":"uint256"},{"name":"minCollateralOut","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"collateralOut","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},{"type":"function","name":"settlementState","inputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"state","type":"uint8","internalType":"enum SettlementPolicy.Settlement"},{"name":"value","type":"int256","internalType":"int256"}],"stateMutability":"view"},{"type":"function","name":"totalLpShares","inputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"voidMarket","inputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"yesBalance","inputs":[{"name":"","type":"bytes32","internalType":"bytes32"},{"name":"","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"event","name":"AgentFeeForfeited","inputs":[{"name":"marketId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"sink","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"AgentFeeReleased","inputs":[{"name":"marketId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"agent","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"Bought","inputs":[{"name":"marketId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"buyer","type":"address","indexed":true,"internalType":"address"},{"name":"outcome","type":"uint8","indexed":false,"internalType":"enum MarketsV4.Outcome"},{"name":"collateralIn","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"sharesOut","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"fee","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"LPClaimed","inputs":[{"name":"marketId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"lp","type":"address","indexed":true,"internalType":"address"},{"name":"payout","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"MarketCreated","inputs":[{"name":"marketId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"creator","type":"address","indexed":true,"internalType":"address"},{"name":"feedId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"agent","type":"address","indexed":false,"internalType":"address"},{"name":"threshold","type":"int256","indexed":false,"internalType":"int256"},{"name":"comparator","type":"uint8","indexed":false,"internalType":"enum MarketsV4.Comparator"},{"name":"expiry","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"liquidity","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"MarketVoided","inputs":[{"name":"marketId","type":"bytes32","indexed":true,"internalType":"bytes32"}],"anonymous":false},{"type":"event","name":"Redeemed","inputs":[{"name":"marketId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"holder","type":"address","indexed":true,"internalType":"address"},{"name":"payout","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"Resolved","inputs":[{"name":"marketId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"yesWon","type":"bool","indexed":false,"internalType":"bool"},{"name":"value","type":"int256","indexed":false,"internalType":"int256"}],"anonymous":false},{"type":"event","name":"Sold","inputs":[{"name":"marketId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"seller","type":"address","indexed":true,"internalType":"address"},{"name":"outcome","type":"uint8","indexed":false,"internalType":"enum MarketsV4.Outcome"},{"name":"sharesIn","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"collateralOut","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"fee","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"error","name":"AgentNotRegistered","inputs":[]},{"type":"error","name":"AlreadyResolved","inputs":[]},{"type":"error","name":"AmountTooLow","inputs":[]},{"type":"error","name":"BadExpiry","inputs":[]},{"type":"error","name":"BadSettlementParams","inputs":[]},{"type":"error","name":"FeedUnsettleable","inputs":[]},{"type":"error","name":"InsufficientShares","inputs":[]},{"type":"error","name":"LiquidityTooLow","inputs":[]},{"type":"error","name":"MarketExists","inputs":[]},{"type":"error","name":"MarketExpired","inputs":[]},{"type":"error","name":"MarketMissing","inputs":[]},{"type":"error","name":"MarketNotExpired","inputs":[]},{"type":"error","name":"NoLPShares","inputs":[]},{"type":"error","name":"NotResolved","inputs":[]},{"type":"error","name":"NotTrading","inputs":[]},{"type":"error","name":"NotVoidable","inputs":[]},{"type":"error","name":"ReentrancyGuardReentrantCall","inputs":[]},{"type":"error","name":"SettlementPending","inputs":[]},{"type":"error","name":"SlippageExceeded","inputs":[]},{"type":"error","name":"ZeroAddress","inputs":[]}] as const;

// Dispute — optimistic challenge + slash.
export const disputeAbi = [{"type":"function","name":"challenge","inputs":[{"name":"attestationId","type":"bytes32","internalType":"bytes32"},{"name":"evidenceHash","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"disputeId","type":"bytes32","internalType":"bytes32"}],"stateMutability":"nonpayable"},{"type":"function","name":"disputeOf","inputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"stateMutability":"view"},{"type":"function","name":"getDispute","inputs":[{"name":"disputeId","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"tuple","internalType":"struct Dispute.DisputeData","components":[{"name":"attestationId","type":"bytes32","internalType":"bytes32"},{"name":"challenger","type":"address","internalType":"address"},{"name":"challengerBond","type":"uint256","internalType":"uint256"},{"name":"evidenceHash","type":"bytes32","internalType":"bytes32"},{"name":"openedAt","type":"uint256","internalType":"uint256"},{"name":"resolver","type":"address","internalType":"address"},{"name":"outcome","type":"uint8","internalType":"enum Dispute.DisputeOutcome"}]}],"stateMutability":"view"},{"type":"function","name":"resolve","inputs":[{"name":"disputeId","type":"bytes32","internalType":"bytes32"},{"name":"outcome","type":"uint8","internalType":"enum Dispute.DisputeOutcome"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"event","name":"Challenged","inputs":[{"name":"disputeId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"attestationId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"challenger","type":"address","indexed":true,"internalType":"address"},{"name":"bond","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"evidenceHash","type":"bytes32","indexed":false,"internalType":"bytes32"}],"anonymous":false},{"type":"event","name":"Resolved","inputs":[{"name":"disputeId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"outcome","type":"uint8","indexed":false,"internalType":"enum Dispute.DisputeOutcome"}],"anonymous":false},{"type":"error","name":"AlreadyChallenged","inputs":[]},{"type":"error","name":"AlreadyResolved","inputs":[]},{"type":"error","name":"AttestationMissing","inputs":[]},{"type":"error","name":"BadOutcome","inputs":[]},{"type":"error","name":"DisputeMissing","inputs":[]},{"type":"error","name":"NoAvailableBond","inputs":[]},{"type":"error","name":"NotResolver","inputs":[]},{"type":"error","name":"SafeERC20FailedOperation","inputs":[{"name":"token","type":"address","internalType":"address"}]},{"type":"error","name":"WindowClosed","inputs":[]}] as const;

// Perennial — builder funding (deployed 2026-06-29).
export const builderRegistryAbi = [{"type":"function","name":"builderIdOf","inputs":[{"name":"","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"builders","inputs":[{"name":"","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"owner","type":"address","internalType":"address"},{"name":"profileURI","type":"string","internalType":"string"},{"name":"linkedIdentity","type":"bytes","internalType":"bytes"},{"name":"createdAt","type":"uint64","internalType":"uint64"},{"name":"active","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"isRegistered","inputs":[{"name":"who","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"isUniqueBuilder","inputs":[{"name":"who","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"linkIdentity","inputs":[{"name":"kyaProof","type":"bytes","internalType":"bytes"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"ownerOf","inputs":[{"name":"id","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"registerBuilder","inputs":[{"name":"profileURI","type":"string","internalType":"string"}],"outputs":[{"name":"id","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},{"type":"function","name":"updateProfile","inputs":[{"name":"profileURI","type":"string","internalType":"string"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"event","name":"BuilderRegistered","inputs":[{"name":"id","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"owner","type":"address","indexed":true,"internalType":"address"},{"name":"profileURI","type":"string","indexed":false,"internalType":"string"}],"anonymous":false},{"type":"event","name":"IdentityLinked","inputs":[{"name":"id","type":"uint256","indexed":true,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"ProfileUpdated","inputs":[{"name":"id","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"profileURI","type":"string","indexed":false,"internalType":"string"}],"anonymous":false},{"type":"error","name":"AlreadyRegistered","inputs":[]},{"type":"error","name":"NotOwner","inputs":[]},{"type":"error","name":"NotRegistered","inputs":[]}] as const;
export const progressPoolAbi = [{"type":"function","name":"addProgress","inputs":[{"name":"builder","type":"address","internalType":"address"},{"name":"weight","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"claim","inputs":[{"name":"epoch","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"amount","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},{"type":"function","name":"claimFor","inputs":[{"name":"epoch","type":"uint256","internalType":"uint256"},{"name":"builder","type":"address","internalType":"address"}],"outputs":[{"name":"amount","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},{"type":"function","name":"claimable","inputs":[{"name":"epoch","type":"uint256","internalType":"uint256"},{"name":"builder","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"closeEpoch","inputs":[],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"currentEpoch","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"epochLength","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"epochPot","inputs":[{"name":"","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"pendingPot","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"progressWeight","inputs":[{"name":"","type":"uint256","internalType":"uint256"},{"name":"","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"totalWeight","inputs":[{"name":"","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"streamWindow","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"streamIdOf","inputs":[{"name":"epoch","type":"uint256","internalType":"uint256"},{"name":"builder","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"setStreamWindow","inputs":[{"name":"w","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"claimed","inputs":[{"name":"epoch","type":"uint256","internalType":"uint256"},{"name":"builder","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"event","name":"Claimed","inputs":[{"name":"epoch","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"builder","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"ClaimStreamed","inputs":[{"name":"epoch","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"builder","type":"address","indexed":true,"internalType":"address"},{"name":"streamId","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"ratePerSec","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"EpochClosed","inputs":[{"name":"epoch","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"pot","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"totalWeight","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"EpochLengthSet","inputs":[{"name":"epochLength","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"ProgressAdded","inputs":[{"name":"epoch","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"builder","type":"address","indexed":true,"internalType":"address"},{"name":"weight","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"RoleAdminChanged","inputs":[{"name":"role","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"previousAdminRole","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"newAdminRole","type":"bytes32","indexed":true,"internalType":"bytes32"}],"anonymous":false},{"type":"event","name":"RoleGranted","inputs":[{"name":"role","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"account","type":"address","indexed":true,"internalType":"address"},{"name":"sender","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},{"type":"event","name":"RoleRevoked","inputs":[{"name":"role","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"account","type":"address","indexed":true,"internalType":"address"},{"name":"sender","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},{"type":"error","name":"AccessControlBadConfirmation","inputs":[]},{"type":"error","name":"AccessControlUnauthorizedAccount","inputs":[{"name":"account","type":"address","internalType":"address"},{"name":"neededRole","type":"bytes32","internalType":"bytes32"}]},{"type":"error","name":"AlreadyClaimed","inputs":[]},{"type":"error","name":"EpochNotClosed","inputs":[]},{"type":"error","name":"EpochNotOver","inputs":[]},{"type":"error","name":"NoProgress","inputs":[]},{"type":"error","name":"ZeroAddress","inputs":[]}] as const;
export const marketsPerennialAbi = [{"type":"constructor","inputs":[{"name":"ledger_","type":"address","internalType":"contract NanoLedger"},{"name":"registry_","type":"address","internalType":"contract Registry"},{"name":"attestation_","type":"address","internalType":"contract Attestation"},{"name":"builders_","type":"address","internalType":"contract BuilderRegistry"},{"name":"admin","type":"address","internalType":"address"},{"name":"commons_","type":"address","internalType":"address"},{"name":"settlementWindow_","type":"uint256","internalType":"uint256"},{"name":"resolutionGrace_","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},{"type":"function","name":"ATTESTATION","inputs":[],"outputs":[{"name":"","type":"address","internalType":"contract Attestation"}],"stateMutability":"view"},{"type":"function","name":"BUILDERS","inputs":[],"outputs":[{"name":"","type":"address","internalType":"contract BuilderRegistry"}],"stateMutability":"view"},{"type":"function","name":"DEFAULT_ADMIN_ROLE","inputs":[],"outputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"stateMutability":"view"},{"type":"function","name":"FEE_BPS_TOTAL","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"GOVERNOR_ROLE","inputs":[],"outputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"stateMutability":"view"},{"type":"function","name":"LEDGER","inputs":[],"outputs":[{"name":"","type":"address","internalType":"contract NanoLedger"}],"stateMutability":"view"},{"type":"function","name":"MAX_RESOLUTION_GRACE","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"MAX_SETTLEMENT_WINDOW","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"MIN_LIQUIDITY","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"MIN_RESOLUTION_GRACE","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"MIN_SETTLEMENT_WINDOW","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"REGISTRY","inputs":[],"outputs":[{"name":"","type":"address","internalType":"contract Registry"}],"stateMutability":"view"},{"type":"function","name":"RESOLUTION_GRACE","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"SETTLEMENT_WINDOW","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"agentBps","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"agentEscrow","inputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"buy","inputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"},{"name":"outcome","type":"uint8","internalType":"enum MarketsPerennial.Outcome"},{"name":"collateralIn","type":"uint256","internalType":"uint256"},{"name":"minSharesOut","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"sharesOut","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},{"type":"function","name":"claimLP","inputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"payout","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},{"type":"function","name":"commons","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"createMarket","inputs":[{"name":"builderId","type":"uint256","internalType":"uint256"},{"name":"feedId","type":"bytes32","internalType":"bytes32"},{"name":"agent","type":"address","internalType":"address"},{"name":"threshold","type":"int256","internalType":"int256"},{"name":"comparator","type":"uint8","internalType":"enum MarketsPerennial.Comparator"},{"name":"expiry","type":"uint256","internalType":"uint256"},{"name":"liquidity","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"}],"stateMutability":"nonpayable"},{"type":"function","name":"createdBy","inputs":[{"name":"","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"creatorBps","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"forfeitSink","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"getMarket","inputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"tuple","internalType":"struct MarketsPerennial.Market","components":[{"name":"feedId","type":"bytes32","internalType":"bytes32"},{"name":"agent","type":"address","internalType":"address"},{"name":"threshold","type":"int256","internalType":"int256"},{"name":"comparator","type":"uint8","internalType":"enum MarketsPerennial.Comparator"},{"name":"expiry","type":"uint256","internalType":"uint256"},{"name":"creator","type":"address","internalType":"address"},{"name":"builderId","type":"uint256","internalType":"uint256"},{"name":"yesReserve","type":"uint256","internalType":"uint256"},{"name":"noReserve","type":"uint256","internalType":"uint256"},{"name":"phase","type":"uint8","internalType":"enum MarketsPerennial.Phase"},{"name":"yesWon","type":"bool","internalType":"bool"},{"name":"createdAt","type":"uint256","internalType":"uint256"}]}],"stateMutability":"view"},{"type":"function","name":"getRoleAdmin","inputs":[{"name":"role","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"stateMutability":"view"},{"type":"function","name":"grantRole","inputs":[{"name":"role","type":"bytes32","internalType":"bytes32"},{"name":"account","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"hasRole","inputs":[{"name":"role","type":"bytes32","internalType":"bytes32"},{"name":"account","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"lpPotAtResolution","inputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"lpShares","inputs":[{"name":"","type":"bytes32","internalType":"bytes32"},{"name":"","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"noBalance","inputs":[{"name":"","type":"bytes32","internalType":"bytes32"},{"name":"","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"priceOf","inputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"},{"name":"outcome","type":"uint8","internalType":"enum MarketsPerennial.Outcome"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"redeem","inputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"payout","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},{"type":"function","name":"renounceRole","inputs":[{"name":"role","type":"bytes32","internalType":"bytes32"},{"name":"callerConfirmation","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"resolve","inputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"revokeRole","inputs":[{"name":"role","type":"bytes32","internalType":"bytes32"},{"name":"account","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"sell","inputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"},{"name":"outcome","type":"uint8","internalType":"enum MarketsPerennial.Outcome"},{"name":"sharesIn","type":"uint256","internalType":"uint256"},{"name":"minCollateralOut","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"collateralOut","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},{"type":"function","name":"setCommons","inputs":[{"name":"commons_","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"setFeeSplit","inputs":[{"name":"creatorBps_","type":"uint256","internalType":"uint256"},{"name":"treasuryBps_","type":"uint256","internalType":"uint256"},{"name":"agentBps_","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"setForfeitSink","inputs":[{"name":"sink","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"settlementState","inputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"state","type":"uint8","internalType":"enum SettlementPolicy.Settlement"},{"name":"value","type":"int256","internalType":"int256"}],"stateMutability":"view"},{"type":"function","name":"supportsInterface","inputs":[{"name":"interfaceId","type":"bytes4","internalType":"bytes4"}],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"},{"type":"function","name":"totalLpShares","inputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"treasuryBps","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"function","name":"voidMarket","inputs":[{"name":"marketId","type":"bytes32","internalType":"bytes32"}],"outputs":[],"stateMutability":"nonpayable"},{"type":"function","name":"yesBalance","inputs":[{"name":"","type":"bytes32","internalType":"bytes32"},{"name":"","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},{"type":"event","name":"AgentFeeForfeited","inputs":[{"name":"marketId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"sink","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"AgentFeeReleased","inputs":[{"name":"marketId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"agent","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"Bought","inputs":[{"name":"marketId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"buyer","type":"address","indexed":true,"internalType":"address"},{"name":"outcome","type":"uint8","indexed":false,"internalType":"enum MarketsPerennial.Outcome"},{"name":"collateralIn","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"sharesOut","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"fee","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"CommonsSet","inputs":[{"name":"commons","type":"address","indexed":false,"internalType":"address"}],"anonymous":false},{"type":"event","name":"FeeSplitSet","inputs":[{"name":"creatorBps","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"treasuryBps","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"agentBps","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"FeesPaid","inputs":[{"name":"marketId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"creatorFee","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"commonsFee","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"agentFee","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"ForfeitSinkSet","inputs":[{"name":"sink","type":"address","indexed":false,"internalType":"address"}],"anonymous":false},{"type":"event","name":"LPClaimed","inputs":[{"name":"marketId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"lp","type":"address","indexed":true,"internalType":"address"},{"name":"payout","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"MarketCreated","inputs":[{"name":"marketId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"builderId","type":"uint256","indexed":true,"internalType":"uint256"},{"name":"creator","type":"address","indexed":true,"internalType":"address"},{"name":"feedId","type":"bytes32","indexed":false,"internalType":"bytes32"},{"name":"agent","type":"address","indexed":false,"internalType":"address"},{"name":"threshold","type":"int256","indexed":false,"internalType":"int256"},{"name":"comparator","type":"uint8","indexed":false,"internalType":"enum MarketsPerennial.Comparator"},{"name":"expiry","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"MarketVoided","inputs":[{"name":"marketId","type":"bytes32","indexed":true,"internalType":"bytes32"}],"anonymous":false},{"type":"event","name":"Redeemed","inputs":[{"name":"marketId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"holder","type":"address","indexed":true,"internalType":"address"},{"name":"payout","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"event","name":"Resolved","inputs":[{"name":"marketId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"yesWon","type":"bool","indexed":false,"internalType":"bool"},{"name":"value","type":"int256","indexed":false,"internalType":"int256"}],"anonymous":false},{"type":"event","name":"RoleAdminChanged","inputs":[{"name":"role","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"previousAdminRole","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"newAdminRole","type":"bytes32","indexed":true,"internalType":"bytes32"}],"anonymous":false},{"type":"event","name":"RoleGranted","inputs":[{"name":"role","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"account","type":"address","indexed":true,"internalType":"address"},{"name":"sender","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},{"type":"event","name":"RoleRevoked","inputs":[{"name":"role","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"account","type":"address","indexed":true,"internalType":"address"},{"name":"sender","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},{"type":"event","name":"Sold","inputs":[{"name":"marketId","type":"bytes32","indexed":true,"internalType":"bytes32"},{"name":"seller","type":"address","indexed":true,"internalType":"address"},{"name":"outcome","type":"uint8","indexed":false,"internalType":"enum MarketsPerennial.Outcome"},{"name":"sharesIn","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"collateralOut","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"fee","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},{"type":"error","name":"AccessControlBadConfirmation","inputs":[]},{"type":"error","name":"AccessControlUnauthorizedAccount","inputs":[{"name":"account","type":"address","internalType":"address"},{"name":"neededRole","type":"bytes32","internalType":"bytes32"}]},{"type":"error","name":"AgentNotRegistered","inputs":[]},{"type":"error","name":"AlreadyResolved","inputs":[]},{"type":"error","name":"AmountTooLow","inputs":[]},{"type":"error","name":"BadExpiry","inputs":[]},{"type":"error","name":"BadSettlementParams","inputs":[]},{"type":"error","name":"BadSplit","inputs":[]},{"type":"error","name":"BuilderInactive","inputs":[]},{"type":"error","name":"FeedUnsettleable","inputs":[]},{"type":"error","name":"InsufficientShares","inputs":[]},{"type":"error","name":"LiquidityTooLow","inputs":[]},{"type":"error","name":"MarketExists","inputs":[]},{"type":"error","name":"MarketExpired","inputs":[]},{"type":"error","name":"MarketMissing","inputs":[]},{"type":"error","name":"MarketNotExpired","inputs":[]},{"type":"error","name":"NoLPShares","inputs":[]},{"type":"error","name":"NotResolved","inputs":[]},{"type":"error","name":"NotTrading","inputs":[]},{"type":"error","name":"NotVoidable","inputs":[]},{"type":"error","name":"ReentrancyGuardReentrantCall","inputs":[]},{"type":"error","name":"SettlementPending","inputs":[]},{"type":"error","name":"SlippageExceeded","inputs":[]},{"type":"error","name":"ZeroAddress","inputs":[]}] as const;

export const caretakerRegistryAbi = [{"type":"function","name":"caretakerOf","inputs":[{"name":"builderId","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"payoutOf","inputs":[{"name":"builderId","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},{"type":"function","name":"isCaretaker","inputs":[{"name":"builderId","type":"uint256","internalType":"uint256"},{"name":"who","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"bool","internalType":"bool"}],"stateMutability":"view"}] as const;
