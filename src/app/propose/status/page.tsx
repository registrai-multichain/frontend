import { Suspense } from "react";
import { PerennialShell } from "@/components/PerennialShell";
import { ProposalStatus } from "@/components/proposals/ProposalStatus";

export const metadata = { title: "Proposal status · Registrai" };

export default function ProposalStatusPage() {
  return (
    <PerennialShell>
      <Suspense fallback={null}>
        <ProposalStatus />
      </Suspense>
    </PerennialShell>
  );
}
