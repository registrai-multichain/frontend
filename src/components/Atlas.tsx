import live from "@/lib/live-data.json";
import meta from "@/lib/builder-meta.json";
import {
  aggregateByCountry,
  densityBucket,
  mergeDeclaredMeta,
  MIN_BUILDERS_PER_CELL,
  UNATTRIBUTED,
} from "@/lib/atlas";
import type { BuilderAggregate, DeclaredMeta } from "@/lib/atlas";

type RawBuilder = {
  builderId: number;
  address: string;
  lifetimeProgress: number;
  volume: string;
};

/**
 * Builder density by country.
 *
 * Flat, not a globe: a choropleth is legible at a glance, cheap to render, and
 * screenshots well — which is the actual job. It also degrades gracefully. A
 * city with one building looks broken; a map with one lit cell looks early.
 *
 * Country is SELF-DECLARED and the caption says so. Progress and volume are
 * read from chain, so they are rendered in ink; the declared country only
 * decides which cell a builder lands in.
 */
export function Atlas() {
  const raw = ((live as { builders?: RawBuilder[] }).builders ?? []).map(
    (b): BuilderAggregate => ({
      builderId: b.builderId,
      address: b.address,
      lifetimeProgress: b.lifetimeProgress,
      volume: BigInt(b.volume),
      country: null,
    }),
  );

  const cells = aggregateByCountry(mergeDeclaredMeta(raw, meta as DeclaredMeta));
  const max = cells.reduce((m, c) => Math.max(m, c.builders), 0);
  const totalBuilders = cells.reduce((s, c) => s + c.builders, 0);
  const totalProgress = cells.reduce((s, c) => s + c.progress, 0);
  const totalVolume = cells.reduce((s, c) => s + c.volume, 0n);

  return (
    <section>
      <div className="flex items-baseline justify-between gap-4 mb-1">
        <h1 className="caption">builder atlas</h1>
        <span className="text-2xs text-fg-dim">density by declared country</span>
      </div>
      <p className="font-serif text-[28px] sm:text-[38px] leading-[1.06] tracking-tightest max-w-[20ch] mb-5">
        Where the <span className="italic text-commons">grind</span> is.
      </p>

      <div className="grid grid-cols-3 gap-px bg-line border border-line mb-6">
        <Stat label="builders" value={String(totalBuilders)} />
        <Stat label="verified progress" value={String(totalProgress)} />
        <Stat label="market volume" value={`${(Number(totalVolume) / 1e6).toFixed(2)} USDC`} />
      </div>

      {cells.length === 0 ? (
        <p className="text-[13px] text-fg-mute leading-relaxed max-w-[60ch]">
          No builders registered yet. The map fills in as builders opt in.
        </p>
      ) : (
        <ul className="atlas-cells">
          {cells.map((c) => (
            <li key={c.code} className="atlas-cell" data-density={densityBucket(c.builders, max)}>
              <span className="atlas-code">
                {c.code === UNATTRIBUTED ? "unattributed" : c.code}
              </span>
              <span className="atlas-count tnum">{c.builders}</span>
              <span className="atlas-progress tnum">{c.progress} prog</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-5 text-[12px] text-fg-dim leading-relaxed max-w-[64ch]">
        Country is self-declared, opt-in and unverified — it decides which cell a builder
        sits in and nothing else. Progress and volume are read from chain. Countries with
        fewer than {MIN_BUILDERS_PER_CELL} builders are grouped as unattributed, so the map
        never narrows down to one person.
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-elev px-4 py-3">
      <div className="caption text-fg-dim mb-1">{label}</div>
      <div className="tnum text-[18px]">{value}</div>
    </div>
  );
}
