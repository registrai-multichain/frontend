import type { Metadata } from "next";
import { FreezeNotice } from "@/components/FreezeNotice";
import { PerennialShell } from "@/components/PerennialShell";
import { FREEZE } from "@/lib/freeze";

// Markets are frozen (src/lib/freeze.ts): this page shows the notice instead.
export const metadata: Metadata = {
  title: "Prediction markets frozen · Registrai",
  description: FREEZE.text,
  alternates: { canonical: "/perennial/wonder" },
  robots: { index: false },
};

export default function WonderPage() {
  return (
    <PerennialShell>
      <div className="pu-bridge">
        <FreezeNotice />
      </div>
    </PerennialShell>
  );
}
