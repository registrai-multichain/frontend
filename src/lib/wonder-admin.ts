/**
 * /admin's wonder-market tools: the nominate box and the Safe files. Kept out of
 * wonder.ts so the public pages never load the onboarding batch code.
 */
import { encodeFunctionData, type Address, type Hex } from "viem";
import { singleTxSafeFile, type PlannedTx } from "./onboard-batch";
import { normalizeSource, sourceLabel } from "./verified-builders";
import { sourceKey, wonderEscrowAbi, wonderMarketsAbi } from "./wonder";

/** /admin's nominate box: the canonical source; nominating needs an invite (spec decision 2),
 *  un-nominating (an opt-out) never does — the invite may be gone by then. */
export function nominateInput(
  raw: string,
  invited: ReadonlySet<string>,
  on = true,
): { ok: true; source: string } | { ok: false; error: string } {
  const source = normalizeSource(raw);
  if (!source) return { ok: false, error: "Not a GitHub repo or domain." };
  if (on && !invited.has(source)) return { ok: false, error: `Invite ${sourceLabel(source)} first: only invited projects are nominated.` };
  return { ok: true, source };
}

export function nominateTx(markets: Address, source: string, on: boolean): PlannedTx {
  return {
    kind: "nominate",
    to: markets,
    value: "0",
    data: encodeFunctionData({ abi: wonderMarketsAbi, functionName: "nominate", args: [source, on] }),
    label: `nominate(${source}, ${on})  # ${on ? "opens" : "closes"} wonder markets on ${sourceLabel(source)}`,
  };
}

export function cancelReleaseTx(escrow: Address, key: Hex, source: string): PlannedTx {
  return {
    kind: "cancelRelease",
    to: escrow,
    value: "0",
    data: encodeFunctionData({ abi: wonderEscrowAbi, functionName: "cancelRelease", args: [key] }),
    label: `cancelRelease(${key})  # stops the queued release of ${source}'s escrow`,
  };
}

export function nominateSafeFile(o: { markets: Address; source: string; on: boolean; chainId: number; createdAt: number }) {
  return singleTxSafeFile(nominateTx(o.markets, o.source, o.on), {
    chainId: o.chainId,
    createdAt: o.createdAt,
    name: `Registrai: ${o.on ? "nominate" : "un-nominate"} ${o.source}`,
  });
}

export function cancelReleaseSafeFile(o: { escrow: Address; source: string; chainId: number; createdAt: number }) {
  return singleTxSafeFile(cancelReleaseTx(o.escrow, sourceKey(o.source), o.source), {
    chainId: o.chainId,
    createdAt: o.createdAt,
    name: `Registrai: cancel the wonder release of ${o.source}`,
  });
}

