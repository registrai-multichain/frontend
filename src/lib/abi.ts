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

export const attestationAbi = [
  {
    type: "function",
    name: "historyLength",
    stateMutability: "view",
    inputs: [
      { name: "feedId", type: "bytes32" },
      { name: "agent", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

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
