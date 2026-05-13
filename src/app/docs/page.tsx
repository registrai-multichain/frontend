import { Shell } from "@/components/Shell";
import { StatusBadge } from "@/components/StatusBadge";

export default function DocsPage() {
  return (
    <Shell>
      <article className="pt-12 sm:pt-20 fade-up">
        <div className="caption mb-4">documentation · v0.1</div>
        <h1 className="font-serif text-[40px] sm:text-[54px] leading-[1.02] tracking-tightest mb-10">
          Integrate, register, or create.
        </h1>

        <nav className="border border-line p-4 mb-12 text-[12.5px] flex flex-wrap gap-x-6 gap-y-2 text-fg-mute">
          <a href="#read" className="hover:text-accent">
            01 · read a feed
          </a>
          <a href="#register" className="hover:text-accent">
            02 · register an agent
          </a>
          <a href="#create" className="hover:text-accent">
            03 · create a new feed
          </a>
          <a href="#dispute" className="hover:text-accent">
            04 · open a dispute
          </a>
        </nav>

        <Section
          id="read"
          n="01"
          status="beta"
          title="Read a feed from Solidity"
          body="Every feed exposes a latest-value getter. Three lines, no SDK."
        >
          <Code>
            {`IAttestation oracle = IAttestation(0x...);

(int256 value, uint256 timestamp, bool finalized) =
    oracle.latestValue(feedId, agentAddress);`}
          </Code>
          <p className="text-fg-mute mt-4 text-[13px] leading-relaxed">
            <span className="text-fg">finalized</span> is true only after the
            feed&apos;s dispute window has closed without challenge (or a
            challenge resolved as valid). Don&apos;t trust unfinalized values
            in money-moving paths.
          </p>
        </Section>

        <Section
          id="register"
          n="02"
          status="soon"
          title="Register your own agent on an existing feed"
          body="Any address can become an attesting agent on any feed today via the SDK + a wallet — see code below. A self-serve UI flow (upload methodology → register → deploy worker → confirm) is rolling out next. The contract layer works now."
        >
          <Code>
            {`// 1. Publish your methodology to IPFS, get the CID.
//    The hash you commit onchain is keccak256(toHex(cid)).
bytes32 methodologyHash = keccak256(abi.encodePacked("ipfs://..."));

// 2. Approve USDC for the registry.
USDC.approve(address(registry), bondAmount);

// 3. Register.
registry.registerAgent(feedId, methodologyHash, bondAmount);

// 4. Attest, daily.
attestation.attest(feedId, value, inputHash);`}
          </Code>
          <Notes>
            <li>
              Methodology is immutable per agent. To change methodology, register a
              new agent address.
            </li>
            <li>
              The input hash should deterministically commit to the raw data you
              used. Use the same scheme the methodology document specifies.
            </li>
            <li>
              Bond withdrawal has a 7-day cooldown from your last attestation, and
              cannot proceed while any dispute is pending against you.
            </li>
          </Notes>
        </Section>

        <Section
          id="create"
          n="03"
          status="soon"
          title="Create a new feed"
          body="Anyone can register a new feed via cast or a script today; same self-serve UI flow as agent registration is on the way. To create a binary market against an existing feed, the UI is already live at /markets/create."
        >
          <Code>
            {`bytes32 feedId = registry.createFeed(
    "Berlin average rent EUR/sqm, primary market",
    methodologyHash,           // IPFS commit for the feed spec
    100 * 1e6,                 // minBond, in USDC (6 decimals)
    24 hours,                  // dispute window
    resolverAddress            // who arbitrates disputes
);`}
          </Code>
          <Notes>
            <li>
              <span className="text-fg">resolver</span> is the address (typically
              a multisig) that decides challenged attestations. For Warsaw v1 it
              is a 2/3 multisig; document this in your methodology.
            </li>
            <li>
              <span className="text-fg">disputeWindow</span> must be between 1
              hour and 7 days.
            </li>
            <li>
              <span className="text-fg">minBond</span> must be at least 100 USDC.
            </li>
          </Notes>
        </Section>

        <Section
          id="dispute"
          n="04"
          status="soon"
          title="Challenge a bad attestation"
          body="Inside the dispute window, anyone can challenge by posting USDC equal to the agent's available bond plus evidence on IPFS. Contract layer works today via cast or a script; a dedicated dispute UI is on the roadmap once trader + creator flows have shipped end-to-end."
        >
          <Code>
            {`USDC.approve(address(dispute), agentAvailableBond);
bytes32 disputeId =
    dispute.challenge(attestationId, evidenceCidHash);`}
          </Code>
          <Notes>
            <li>
              If the resolver rules <span className="text-fg">Invalid</span>, you
              get your bond back plus an equal slash from the agent.
            </li>
            <li>
              If the resolver rules <span className="text-fg">Valid</span>, the
              agent keeps their bond and receives your posted bond.
            </li>
            <li>Symmetric stakes — no free option to grief.</li>
          </Notes>
        </Section>

        <div className="hr mt-16 mb-8" />
        <div className="text-2xs text-fg-dim">
          Contract addresses, ABIs, and verified source on Arc explorer once
          deployed. Until then, see <code className="text-fg-mute">/contracts</code>{" "}
          in the GitHub repo.
        </div>
      </article>
    </Shell>
  );
}

function Section({
  id,
  n,
  title,
  body,
  status,
  children,
}: {
  id: string;
  n: string;
  title: string;
  body: string;
  status?: "beta" | "soon";
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-16 scroll-mt-20">
      <div className="flex items-baseline gap-3 mb-3 flex-wrap">
        <span className="caption text-fg-dim">{n}</span>
        <h2 className="font-serif text-[26px] leading-none tracking-tightest">{title}</h2>
        {status && <StatusBadge kind={status} />}
      </div>
      <p className="text-fg-mute text-[14px] leading-relaxed max-w-[70ch] mb-5">
        {body}
      </p>
      {children}
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="border border-line bg-bg-elev p-5 text-[12.5px] leading-relaxed overflow-x-auto whitespace-pre">
      <code className="text-fg">{children}</code>
    </pre>
  );
}

function Notes({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mt-5 space-y-2 text-[13px] text-fg-mute leading-relaxed list-none pl-0">
      {Array.isArray(children)
        ? (children as React.ReactNode[]).map((c, i) => (
            <li key={i} className="flex gap-3">
              <span className="text-fg-dim shrink-0">›</span>
              <span>{c}</span>
            </li>
          ))
        : children}
    </ul>
  );
}
