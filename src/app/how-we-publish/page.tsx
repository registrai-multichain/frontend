import type { Metadata } from "next";
import { BuildersShell } from "@/components/BuildersShell";

export const metadata: Metadata = {
  title: "How we publish · Registrai",
  description: "Registrai shows proof, not opinions: the same evidenced facts for every project, and no ratings.",
  alternates: { canonical: "/how-we-publish" },
};

/** builder.registrai.cc/how-we-publish: the publication policy (spec §6), static. */
export default function HowWePublishPage() {
  return (
    <BuildersShell>
      <article className="perennial-app-page">
        <header className="mb-6">
          <h1 className="pa-h1">How Registrai publishes what it finds</h1>
          <p className="pa-lede">
            Registrai shows proof, not opinions. For every project in the registry we publish the same facts: what is on chain,
            who controls it, how it is used, and what the project says about itself, each with the evidence behind it. We
            don&apos;t rate projects or flag them. You judge.
          </p>
        </header>
        <p>
          <strong>Same facts for everyone.</strong> Every project gets the same checklist, whether it has ten users or ten
          thousand.
        </p>
        <p>
          <strong>Only what we can show.</strong> Every fact links to the transaction, contract or page that proves it. If we
          can&apos;t link it, we don&apos;t publish it.
        </p>
        <p>
          <strong>Projects can add context.</strong> A team can add its own note next to any fact, and we publish it as
          written.
        </p>
        <p>
          <strong>Security issues stay private first.</strong> If we find a leaked key or an exploitable bug, we tell the team
          privately and publish only once it&apos;s fixed, or after 30 days, never with the details an attacker would need.
        </p>
        <p>
          <strong>No personal data.</strong> We look at wallets and contracts, not people.
        </p>
        <p>
          <strong>We correct mistakes in the open.</strong> If a fact is wrong, the correction stays visible in the
          project&apos;s change log. Accuracy disputes are reviewed by Registrai and one independent reviewer. Once the Milli community of verified
          projects is large enough, a random jury of its members will review them instead.
        </p>
        <p>
          <strong>Nobody can pay us to change a fact.</strong> Our paid work is alerts, data access and deeper custom research. None of
          it buys coverage, silence or different wording.
        </p>
      </article>
    </BuildersShell>
  );
}
