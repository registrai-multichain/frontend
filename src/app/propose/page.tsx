import { PerennialShell } from "@/components/PerennialShell";
import { ProposeForm } from "@/components/proposals/ProposeForm";

export const metadata = { title: "Propose a market · Registrai", description: "Suggest a question people can bet on; approved markets open on Arc mainnet." };

export default function ProposePage() {
  return (
    <PerennialShell>
      <ProposeForm />
    </PerennialShell>
  );
}
