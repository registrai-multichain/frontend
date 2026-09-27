"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { RoundsPage } from "@/components/RoundsPage";

/** /rounds/market/?id=<marketId>: a market opened from an approved proposal. One static
 *  route for all of them (they are discovered on chain, not known at build time); it
 *  renders the event page layout. */
function Inner() {
  const id = useSearchParams().get("id") ?? "";
  return <RoundsPage view={{ kind: "proposed", marketId: id as `0x${string}` }} />;
}

export default function ProposedMarketPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
