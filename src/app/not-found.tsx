import Link from "next/link";
import { Shell } from "@/components/Shell";

export default function NotFound() {
  return (
    <Shell>
      <article className="pt-16 sm:pt-24 fade-up">
        <div className="caption text-fg-dim mb-3">404</div>
        <h1 className="font-serif text-[42px] sm:text-[58px] leading-[1.04] tracking-tightest mb-6 max-w-[20ch]">
          That page isn&apos;t{" "}
          <span className="italic text-accent">here</span>.
        </h1>
        <p className="text-fg-mute text-[15px] max-w-[58ch] leading-relaxed mb-10">
          Either the URL is mistyped, or — if you got here from a market
          link — the market was created after this site was last built and
          hasn&apos;t propagated to a static page yet. The protocol still
          knows about it; it&apos;s readable on ArcScan, and your trade
          would still work via the contract.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-line">
          <Tile href="/" title="home" />
          <Tile href="/markets/" title="markets" />
          <Tile href="/agents/" title="agents" />
        </div>
      </article>
    </Shell>
  );
}

function Tile({ href, title }: { href: string; title: string }) {
  return (
    <Link
      href={href}
      className="bg-bg p-6 flex items-center justify-between hover:bg-bg-elev/40 transition-colors group"
    >
      <span className="caption text-fg">{title}</span>
      <span className="text-accent group-hover:tracking-widest transition-all">
        →
      </span>
    </Link>
  );
}
