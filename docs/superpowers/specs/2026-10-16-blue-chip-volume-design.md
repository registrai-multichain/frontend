# Index method: count blue-chip asset inflows (draft)

Date: 2026-10-16.

**Owner:**
- "the index score should include their general volume not just the stable coin ones";
- chose **"Add blue-chip assets"** over "all tokens with a liquidity floor" and "show it, don't score it".

**Status: PARKED by the owner on 2026-10-16 ("Not building this yet. We should add x402 to our api&mcp business first").** This is an index-method change for ABI, AII and AEI. Nothing is built.

## What changes

Today, an app's points come from stablecoin payments (USDC, EURC, GBPA, MXNB) into its contracts. After this change,
inflows of a short, fixed list of **blue-chip assets** also count, converted to USD at a reference price:

| Asset | Arc mainnet address | Decimals | Price source |
|---|---|---|---|
| WETH (bridged) | `0x128cC466B61f542da60c70e3aA11c10e19B84EDB` | 18 | ETH/USD |
| cirBTC (Circle) | `0x171A4217b86A807A64eB94757Db6849fb4bDbAA0` | 8 | BTC/USD |
| USYC (Circle tokenized MMF) | `0x8a5D989Bbb96929F689B0200f435f53dA42bF490` | 6 | USYC NAV (Teller rate), about $1.0x |

The list is closed. It is extended only by a published method note. Launchpad tokens, an app's own token, LP/position
NFTs and every other token stay excluded.

## Rules

1. **Same counting as stablecoins.** A blue-chip inflow is converted to USD and then goes through exactly the same
   payment rules: minimum payment, per-wallet-per-hour cap (`cap_per_wallet_hour_usdc`), new-payer rules, the
   `log2(1 + counted) + counted / vol_unit` points, and the rise limits. There is no separate weight, so $1 in WETH
   counts like $1 in USDC.
2. **No self-dealing.** A transfer counts only when the payer is not one of the app's own contracts or deployers. This
   is the same rule as today, applied to the new assets.
3. **Pass-through.** If the same transaction sends the asset back out of the app's contracts (a router hop),
   today's handling for stablecoins applies unchanged.
4. **Price:** the hourly reference price at the hour's close.
   - **Primary:** an onchain oracle feed on Arc (Chainlink or RedStone ETH/USD and BTC/USD, if present on Arc
     mainnet).
   - **Fallback:** the median of two off-chain hourly closes (Coinbase and Kraken) for ETH and BTC.
   - **USYC:** the Teller's onchain conversion rate.
   - A missing price means that asset is not counted for that hour, never estimated. The hour's file records which
     source was used.
5. **Transparency.** Each hour's index file gains `assets: { WETH: {price, source}, cirBTC: …, USYC: … }`. The
   per-app stats gain `blue_chip_usd_24h`. Data API v1 adds these fields (additive, so no v2).

## Impact measurement before switching (required)

The new rule is replayed over the full history since 2 Oct and published as a note before it goes live:
- per app and per index: the new points against the old, and the index level against the old;
- how much blue-chip inflow each app actually receives;
- whether any app moves into or out of the top 10 because of it;
- a pump-cost check: what moving the index 1% costs using WETH instead of USDC. It must be no cheaper than with USDC.

If blue-chip inflows to member contracts turn out negligible, the note says so, and the owner decides whether to
switch anyway, for coverage.

## First sizing (2026-10-16, explorer sample)

The explorer API returns only the newest 3,000 transfers per token, so these are partial windows, not 7 days:
- **WETH:** 3,000 transfers in about 5 h (1,745.7 WETH moved). **545 into member contracts, 31.9 WETH**: Archery
  19.4, Uniswap 5.6, Aerodrome 3.3, KyberSwap 3.0, LI.FI 0.2.
- **cirBTC:** 3,000 transfers in about 3 h (19.9 cirBTC moved). **1,219 into member contracts, 4.7 cirBTC**: Uniswap
  2.8, Aave 1.05, Aerodrome 0.58, Archery 0.15, Morpho 0.10.
- **USYC:** no transfers found.
- **Arclight:** no blue-chip inflow in these windows.

Blue-chip inflows to members are material, not noise. In those few hours they are comparable to a large share of
members' USDC flow, so the impact replay matters.

## Restatement

- Per "How we publish", methods change only with a published note, and history is restated in the open.
- The restated series replaces the old one on the index page and in the API from the switch-over hour, and the old
  series is archived with the note.
- **Genara is told first:** its climate and mine multipliers read `points`. A level shift at the switch-over shows up
  as an hourly change in Genara, so the note gives the exact hour.

## What it does not do

- It doesn't count Arclight's 14.4M staked ARCLIGHT (an app's own token) or ARCLIGHT trading.
- It doesn't count Uniswap liquidity in launchpad tokens.
- For Arclight it adds only WETH, cirBTC or USYC deposits into its builders or vault, if there are any.

## Ownership and open questions

1. **Who implements:** the index pipeline (`compute_live.py` on the index server) and the browser engine
   (`abi-live.ts`, the live-hour replay) must change together and keep parity. The assistant proposes it does this
   with the same parity checks as earlier method changes. The owner may prefer to give it to arc-0a.
2. **Oracle addresses:** confirm that Chainlink or RedStone ETH/USD and BTC/USD feeds exist on Arc mainnet. If not,
   the off-chain fallback becomes primary.
3. **USYC:** Teller access is allowlisted. Check that the conversion rate can be read without an allowlist, or use
   NAV = 1.00 plus the published accrual.
