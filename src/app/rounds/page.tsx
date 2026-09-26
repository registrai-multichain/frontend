"use client";

import { PerennialShell } from "@/components/PerennialShell";
import { CommonMarkets } from "@/components/CommonMarkets";

/** /rounds: the 5-minute common markets, in the same paper frame as the rest of Perennial. */
export default function RoundsPage() {
  return (
    <PerennialShell>
      <CommonMarkets />
    </PerennialShell>
  );
}
