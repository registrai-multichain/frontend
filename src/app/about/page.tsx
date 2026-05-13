import { Shell } from "@/components/Shell";

export default function AboutPage() {
  return (
    <Shell>
      <article className="pt-12 sm:pt-20 fade-up max-w-[72ch]">
        <div className="caption mb-4">about</div>
        <h1 className="font-serif text-[40px] sm:text-[54px] leading-[1.02] tracking-tightest mb-10">
          What this is.
        </h1>

        <Prose>
          <p>
            <span className="font-serif italic text-fg">Registrai</span> is a
            permissionless onchain registry of agents and the data they attest
            to.
            The contracts do three things and nothing else: they record who is
            attesting to what, hold the bonds, and resolve disputes.
          </p>
          <p>
            There is no admin key, no pause switch, no fee toggle, no
            governance, no token. The deployer is the first agent registering
            the first feed, nothing more. Whatever ships is what runs.
          </p>
          <p>
            The model is optimistic. Anyone can post an attestation if they
            have bonded USDC. Anyone can challenge an attestation during its
            dispute window by matching the agent&apos;s bond. The per-feed
            resolver decides; bonds move accordingly. Symmetric stakes mean
            no free option to grief, and no free option to lie.
          </p>
          <p>
            What the protocol does <em className="font-serif">not</em> do is
            tell you which agent to trust. That is a market decision. A
            consumer integrating a feed picks the agent whose methodology,
            bond, dispute history, and operator they find credible. If they
            don&apos;t like the available agents, they register their own —
            same permissionless rails.
          </p>
        </Prose>

        <div className="hr my-12" />

        <h2 className="caption mb-5">why now</h2>
        <Prose>
          <p>
            Real-world assets are coming onchain. Most of them — regional
            property, illiquid commodities, niche indices — will never have
            Chainlink-grade aggregator coverage. The economics don&apos;t work
            for long-tail data.
          </p>
          <p>
            What does work is a permissionless layer where domain operators
            stand behind their own data with their own bonds. A real estate
            agent in Warsaw stands behind a Warsaw index. A power trader in
            ERCOT stands behind a Texas spot price. A statistician with
            credibility stands behind a regional CPI. The protocol is the
            trust scaffolding, not the data source.
          </p>
        </Prose>

        <div className="hr my-12" />

        <h2 className="caption mb-5">design choices</h2>
        <Prose>
          <p>
            <strong className="text-fg">Optimistic, not committee.</strong> A
            committee of n attesters has n trust assumptions and n failure
            modes. A single bonded agent with a public methodology and a
            slashing surface has one of each.
          </p>
          <p>
            <strong className="text-fg">USDC, not protocol token.</strong>{" "}
            Bonds in USDC are denominated in the same units consumers price
            risk in. A token would add launch theatre and dilute the trust
            signal. No $REGI, ever.
          </p>
          <p>
            <strong className="text-fg">Per-feed resolver, not global.</strong>{" "}
            Different domains need different arbitrators. The protocol does not
            adjudicate; it pipes disputes to the resolver the feed creator
            chose.
          </p>
          <p>
            <strong className="text-fg">Oracle free, markets earn.</strong> The
            registry layer charges nothing — reading a feed, registering an
            agent, posting a bond is free forever. The markets layer takes a
            0.70% trading fee, split <span className="text-up">0.40% to the
            creator</span>, <span className="text-up">0.20% to the agent</span>,
            and <span className="text-fg-mute">0.10% to the protocol</span>.
            Every layer is paid by real economic activity, not by token
            speculation.
          </p>
        </Prose>

        <div className="hr my-12" />

        <h2 className="caption mb-5">who</h2>
        <Prose>
          <p>
            Built for the Circle developer program on Arc testnet, Q2 2026.
            Source on <a href="https://github.com/registrai" className="underline decoration-fg-dim underline-offset-4">GitHub</a>. The Warsaw real estate
            feed is the first demonstration agent; we are also the deployer.
            That bootstrap role ends after the protocol is live and other
            agents can register.
          </p>
        </Prose>
      </article>
    </Shell>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5 text-[14px] leading-[1.7] text-fg-mute [&_strong]:font-medium">
      {children}
    </div>
  );
}
