import Link from "next/link";
import type { Feed } from "@/lib/types";
import { Sparkline } from "./Sparkline";
import { StatusBadge } from "./StatusBadge";
import { AnimatedNumber } from "./AnimatedNumber";
import { LiveCountdown } from "./LiveCountdown";
import { LIVE_META } from "@/lib/demo";
import {
  fmtDuration,
  fmtInt,
  fmtPct,
  isoDate,
  isoDateTime,
  relTime,
  shortAddr,
  shortHash,
} from "@/lib/format";

export function FeedDetail({ feed }: { feed: Feed }) {
  const agent = feed.agents[0]!;
  const history = agent.attestations;
  const latest = history[history.length - 1]!;
  const prev24h = history[history.length - 2] ?? latest;
  const delta = latest.value - prev24h.value;
  const deltaPct = history.length >= 2 ? (delta / prev24h.value) * 100 : 0;
  const values = history.map((a) => a.value);
  const hasHistory = values.length >= 2;

  return (
    <article className="pt-10 sm:pt-14 fade-up">
      {/* Header strip: symbol + meta */}
      <div className="flex items-end justify-between gap-6 mb-10">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="caption">feed · {shortHash(feed.id)}</div>
            <StatusBadge kind="beta" />
          </div>
          <h1 className="text-[26px] sm:text-[30px] tracking-tightest font-medium leading-none">
            {feed.symbol}
          </h1>
          <p className="font-serif italic text-fg-mute text-[17px] mt-3 max-w-[58ch] leading-snug">
            {feed.description}
          </p>
        </div>
        <div className="hidden sm:flex flex-col items-end gap-1.5 text-right">
          <div className="text-2xs caption">
            finalized {relTime(latest.timestamp + feed.disputeWindowSec)}
          </div>
          <LiveCountdown />
        </div>
      </div>

      {/* Hero value */}
      <section className="border-t border-b border-line py-10 sm:py-14 mb-10">
        <div className="flex items-baseline gap-3 sm:gap-5">
          <div className="text-[64px] sm:text-[88px] leading-none tracking-tightest font-medium">
            <AnimatedNumber value={latest.value} duration={1100} />
          </div>
          <div className="text-fg-mute text-[14px] tracking-wide pb-2">{feed.unit}</div>
          <a
            href={`${LIVE_META.explorer}/tx/${latest.id}`}
            target="_blank"
            rel="noreferrer"
            className="hidden sm:flex items-center gap-1.5 text-2xs caption text-up hover:text-accent border border-up/40 hover:border-accent px-2 py-1 ml-2 mb-2 transition-colors"
          >
            <span className="w-1 h-1 rounded-full bg-up dot-pulse" />
            verified onchain ↗
          </a>
        </div>
        {hasHistory ? (
          <>
            <div className="mt-4 flex items-center gap-4 text-[13px] tnum">
              <span className={delta >= 0 ? "text-up" : "text-down"}>
                {delta >= 0 ? "▲" : "▼"} {fmtInt(Math.abs(delta))}{" "}
                <span className="text-fg-mute">({fmtPct(deltaPct)})</span>
              </span>
              <span className="text-fg-dim">·</span>
              <span className="text-fg-mute">24h</span>
            </div>
            <div className="mt-8">
              <Sparkline values={values} />
            </div>
          </>
        ) : (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-6 items-end">
            <p className="text-fg-mute text-[13.5px] leading-relaxed max-w-[60ch]">
              First attestation logged on Arc testnet · attestation history grows
              daily. The agent computes a new value each day at 14:00 UTC and
              publishes it onchain; this chart fills in with each release.
            </p>
            <div className="caption text-fg-dim text-right">
              attestation #{history.length} · next in 23h
            </div>
          </div>
        )}
      </section>

      {/* Spec grid */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-y-6 gap-x-8 mb-12 text-[13px]">
        <Spec
          label="agent"
          value={
            <a
              href={`${LIVE_META.explorer}/address/${agent.address}`}
              target="_blank"
              rel="noreferrer"
              className="hover:text-accent"
            >
              {shortAddr(agent.address)} ↗
            </a>
          }
        />
        <Spec label="bond" value={`${agent.bond} USDC`} />
        <Spec label="window" value={fmtDuration(feed.disputeWindowSec)} />
        <Spec label="resolver" value={feed.resolverLabel} hint={shortAddr(feed.resolver)} />
        <Spec
          label="methodology"
          value={
            <a
              href="https://github.com/registrai-multichain/contracts/blob/main/methodology/warsaw-resi-v1.md"
              target="_blank"
              rel="noreferrer"
              className="hover:text-accent underline decoration-fg-dim underline-offset-4"
            >
              view spec ↗
            </a>
          }
          hint="IPFS pin coming · v1 doc on GitHub"
        />
        <Spec label="min bond" value={`${feed.minBond} USDC`} />
        <Spec label="cadence" value="daily · 14:00 UTC" />
        <Spec
          label="dispute"
          value={
            <span className="text-up">
              <span className="text-up">●</span> none open
            </span>
          }
        />
      </section>

      {/* History */}
      <section>
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="caption">attestation history</h2>
          <span className="text-2xs text-fg-dim">
            showing 12 of {history.length}
          </span>
        </div>
        <div className="border border-line">
          <Row
            head
            cells={["date", "value", "Δ", "status", "tx"]}
          />
          {[...history]
            .slice(-12)
            .reverse()
            .map((a, i, arr) => {
              const prior = arr[i + 1];
              const d = prior ? a.value - prior.value : 0;
              return (
                <Row
                  key={a.id}
                  cells={[
                    <span className="text-fg-mute" key="d">
                      {isoDateTime(a.timestamp)}
                    </span>,
                    <span className="tnum" key="v">
                      {fmtInt(a.value)}
                    </span>,
                    <span
                      className={`tnum ${d > 0 ? "text-up" : d < 0 ? "text-down" : "text-fg-dim"}`}
                      key="dl"
                    >
                      {d === 0 ? "—" : `${d > 0 ? "+" : ""}${fmtInt(d)}`}
                    </span>,
                    <span className="text-up text-2xs caption" key="s">
                      ● finalized
                    </span>,
                    <Link
                      href={`/attestation/${a.id}`}
                      className="text-fg-dim hover:text-accent text-2xs"
                      key="t"
                    >
                      {shortHash(a.id)}
                    </Link>,
                  ]}
                />
              );
            })}
        </div>
        <div className="mt-3 text-2xs text-fg-dim text-right">
          full history on{" "}
          <a className="underline decoration-fg-dim underline-offset-4 hover:text-accent">
            arc explorer ↗
          </a>
        </div>
      </section>

      {/* Integration */}
      <section className="mt-16">
        <h2 className="caption mb-4">integrate this feed</h2>
        <div className="border border-line bg-bg-elev p-5 text-[12.5px] leading-relaxed overflow-x-auto">
          <span className="text-fg-dim">{"// Solidity · three lines"}</span>
          {"\n"}
          <span className="text-accent">{"IAttestation"}</span> oracle ={" "}
          <span className="text-accent">{"IAttestation"}</span>(
          <span className="text-fg-mute">0x…attestation</span>);{"\n"}(
          <span className="text-fg">int256</span> value,{" "}
          <span className="text-fg">uint256</span> at,{" "}
          <span className="text-fg">bool</span> finalized) ={"\n"}
          {"  "}oracle.<span className="text-accent">latestValue</span>(
          <span className="text-fg-mute">{shortHash(feed.id)}</span>,{" "}
          <span className="text-fg-mute">{shortAddr(agent.address)}</span>);
        </div>
      </section>

      <div className="mt-12 text-2xs text-fg-dim flex items-center gap-3">
        <span>last update {isoDate(latest.timestamp)}</span>
        <span className="text-fg-dim/60">·</span>
        <span>input {shortHash(latest.inputHash)}</span>
      </div>
    </article>
  );
}

function Spec({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="caption mb-1.5">{label}</div>
      <div className={`text-fg ${mono ? "" : ""}`}>{value}</div>
      {hint && <div className="text-2xs text-fg-dim mt-0.5">{hint}</div>}
    </div>
  );
}

function Row({ head, cells }: { head?: boolean; cells: React.ReactNode[] }) {
  return (
    <div
      className={`grid grid-cols-[1.4fr_1fr_0.8fr_1fr_1fr] gap-2 px-4 py-2.5 items-center ${
        head ? "caption border-b border-line bg-bg-elev/40" : "border-b border-line/60 last:border-0 hover:bg-bg-elev/40 transition-colors"
      } text-[12.5px]`}
    >
      {cells.map((c, i) => (
        <div key={i} className={i === 0 ? "" : ""}>
          {c}
        </div>
      ))}
    </div>
  );
}
