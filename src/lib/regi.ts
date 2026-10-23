export const REGI_CONTRACT = "0x93D5b8c53ee763C2c4522bF0d958ce51Af4360ae" as const;

/** The official X account (CoinGecko verifies the team through a post from it, so the site must link it). */
export const REGISTRAI_X_HANDLE = "registraicc" as const;
export const REGISTRAI_X_URL = `https://x.com/${REGISTRAI_X_HANDLE}`;

export const REGI_EXPLORER_URL = `https://explorer.arc.io/address/${REGI_CONTRACT}`;

/** The REGI/USDC Uniswap pool on Arc (verified via the DexScreener API: base token = REGI_CONTRACT). */
export const REGI_POOL = "0x0530f18eb32d732cc8b067bbd0b2ba7e5d807d4f5cf4f7d74429f2a78d3120c8" as const;

export const REGI_DEXSCREENER_URL = `https://dexscreener.com/arc/${REGI_POOL}`;
