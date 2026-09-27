import { Suspense } from "react";
import { PerennialShell } from "@/components/PerennialShell";
import { PERENNIAL } from "@/lib/perennial-network";
import { ROUNDS, roundsStatusLine } from "@/lib/rounds";
import { ProposalStatus } from "@/components/proposals/ProposalStatus";

export const metadata = { title: "Proposal status · Registrai" };

export default function ProposalStatusPage() {
  // Approved proposals open on the common markets: the footer names that network's state.
  return (
    <PerennialShell status={roundsStatusLine(ROUNDS, PERENNIAL.chain.id)}>
      <Suspense fallback={null}>
        <ProposalStatus />
      </Suspense>
    </PerennialShell>
  );
}
