"use client";

import { Shell } from "@/components/Shell";
import { CommonMarkets } from "@/components/CommonMarkets";

export default function RoundsPage() {
  return (
    <div className="paper-theme">
      <Shell wide>
        <CommonMarkets />
      </Shell>
    </div>
  );
}
