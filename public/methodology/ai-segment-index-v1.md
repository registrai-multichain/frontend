# Registrai `.ai` Segment Index — Methodology v1

**Feed:** `.ai` aftermarket price index, bucketed by domain segment
**Status:** v1 (keystone prototype) — drives **junior ($aiLP) NAV only**, never the senior ($ai) floor
**Consumer:** Suffix Pool (`domainmarket.registrai.cc`) — see the suffix-pool design spec
**Computation:** `agent/src/agents/ai-index.ts` (pure, deterministic, unit-tested)

---

## What it measures

A coarse price level for `.ai` domains by **segment**, where a segment is the
second-level-domain **length class** (`1, 2, 3, 4, 5, 6-7, 8-12, 13+`) optionally
crossed with a **structural type** (`numeric` / `alphanumeric` / `alpha`). For
each segment we publish a robust central price `Ĩ_seg` (the median of sales in a
trailing window) and dispersion (MAD / median).

Marks drift by the **ratio of the segment index over time**:

```
mark_i,t = paid_i × ( Ĩ_seg,t / Ĩ_seg,at_buy_i )
```

This is intentionally coarse: a unique domain has no objective per-asset ground
truth, and a market-wide median is too heterogeneous. A length/type segment is
the finest unit the data can support.

## Why this is junior-only (not floor backing)

Per the suffix-pool design (v2), the senior `$ai` floor is backed **only** by
hard, liquid, objective value (USDC reserve + realized gains + on-chain/Doma
domains at strict cost basis). This index marks **unrealized** value of held
domains, which colors **junior ($aiLP) NAV and the acquisition shortlist** — not
the defended floor. A wrong or stale index therefore mis-prices speculation, it
does not break a floor. If the index attestation is in dispute, junior marks
**freeze at the last finalized value**.

## Robustness rules

- **Per-segment median**, not mean — resistant to a single outlier sale.
- A segment is **markable** only with `n ≥ 8` sales in the window; sparser
  segments are reported but not used to mark.
- **Drift** (`Ĩ_seg,t / Ĩ_seg,buy`) is trusted only between periods where the
  segment clears the markable threshold in **both** periods.
- Bonded + challengeable like any Registrai feed; freeze-on-dispute.

## Data sources (in fidelity order)

1. **On-chain Doma `.ai` trades** — objective, on-chain ground truth (the
   trustless path; adopt as inventory grows).
2. **NameBio full sales feed** (paid API) — the canonical aggregator, including
   the long tail below the public highlights.
3. **dnjournal / public top-sales lists** — top-of-market only; **insufficient
   alone** (see keystone result).

v1 ships an embedded sample of public reported sales for offline/deterministic
runs (`agent/src/sources/ai-sales.ts`).

## Keystone falsification result (2026-06-06)

Run: `npm run falsify:ai-index`. Against the best **public** `.ai` sales data
(71 reported sales, 2023–2026):

- **Static coverage is adequate** — 96% of sales sit in length segments with
  `n ≥ 8`; a *snapshot* segment median is computable for `3, 4, 5, 6-7, 8-12`.
- **Drift signal is absent** — **zero** length segments have `n ≥ 8` in two
  consecutive years, so there are **0 trustworthy year-over-year moves**. Since
  marking needs *drift* (`Ĩ_seg,t / Ĩ_seg,buy`), the public top-of-market data
  **cannot honestly drift marks**. Verdict: **NOT ATTESTABLE** on public data.

**Conclusion.** The keystone test shows the index is viable *in principle* (the
math and segmentation work and static medians are clean) but requires **denser,
higher-frequency data than public highlights** — the NameBio full feed and/or
on-chain Doma trades — to produce a trustworthy *drift*. Critically, this is a
**data-procurement** finding, not a design failure: under spec v2 the floor does
not depend on this index, so the project is unblocked regardless. The index
ships as **junior-upside signal**, with its fidelity gated on the data source.

## Parameters (v1)

| Param | Value | Note |
|---|---|---|
| `MARKABLE_MIN` | 8 | min sales for a segment to be markable |
| coverage thresholds | 5 / 8 / 15 | reported for transparency |
| `MIN_ATTESTABLE_COVERAGE` | 0.60 | sales-coverage gate to attest |
| type taxonomy | structural | numeric / alphanumeric / alpha (dictionary split is a v2 refinement; needs a wordlist) |

All subject to tuning against the production data feed before any mainnet use.
