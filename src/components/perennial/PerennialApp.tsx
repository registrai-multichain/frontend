"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { parseBuilderParam } from "@/lib/verified-builder-badge";
import { parseMarketParam, parseSide, parseTab, type MarketTab } from "@/lib/perennial-view";
import { MarketPage } from "./MarketPage";
import { MarketsHome } from "./MarketsHome";
import { usePerennialData } from "./usePerennialData";
import { D, usePerennialTx } from "./usePerennialTx";

/** /perennial: the markets home, or one market (?market=), in the paper look. */
export function PerennialApp({ initialTab }: { initialTab?: MarketTab }) {
  if (!D.deployed) {
    return (
      <div className="pa-card max-w-[62ch]">
        <h1 className="pa-h2">Markets open on {D.label} soon</h1>
        <p className="pa-muted mt-2">
          Markets, deposits and builder payouts appear here once the contracts are live. Until then this page makes no {D.label} calls.
          Meanwhile, meet the builders at <a className="pa-link" href="https://builder.registrai.cc">builder.registrai.cc</a>.
        </p>
      </div>
    );
  }
  return (
    <Suspense fallback={<p className="pa-muted">Reading markets…</p>}>
      <Live initialTab={initialTab} />
    </Suspense>
  );
}

function Live({ initialTab }: { initialTab?: MarketTab }) {
  const params = useSearchParams();
  const router = useRouter();
  const tx = usePerennialTx();
  const data = usePerennialData(tx.address);
  const rawMarket = params?.get("market");
  const marketId = parseMarketParam(rawMarket);
  const builder = parseBuilderParam(params?.get("builder"));

  // Old badge links (?builder=<id> on /perennial) now open the builder on the Builders page.
  useEffect(() => {
    if (builder) router.replace(`/perennial/builders/?builder=${builder}`);
  }, [builder, router]);

  if (rawMarket) {
    const m = marketId ? data.markets.find((x) => x.id.toLowerCase() === marketId) : undefined;
    if (m) return <MarketPage data={data} tx={tx} market={m} initialSide={parseSide(params?.get("side"))} />;
    return (
      <div className="pa-card max-w-[62ch]">
        <p>
          {!marketId
            ? "That link doesn't point to a market."
            : !data.ov || data.ovValidating
              ? data.ovError && !data.ov ? `Couldn't read ${D.label} right now. Retrying every 30 seconds.` : "Reading the market…"
              : `This market isn't on ${D.label}.`}
        </p>
        <Link className="pa-link mt-2 inline-block" href="/perennial/">← All markets</Link>
      </div>
    );
  }
  return <MarketsHome data={data} tx={tx} initialTab={initialTab ?? parseTab(params?.get("tab"))} />;
}
