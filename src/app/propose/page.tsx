import { PerennialShell } from "@/components/PerennialShell";
import { PERENNIAL } from "@/lib/perennial-network";
import { ROUNDS, roundsStatusLine } from "@/lib/rounds";
import { ProposeForm } from "@/components/proposals/ProposeForm";

export const metadata = { title: "Propose a market · Registrai", description: "Suggest a question people can bet on; approved markets open on Arc mainnet." };

export default function ProposePage() {
  // Approved proposals open on the common markets: the footer names that network's state.
  return (
    <PerennialShell status={roundsStatusLine(ROUNDS, PERENNIAL.chain.id)}>
      <ProposeForm />
    </PerennialShell>
  );
}
