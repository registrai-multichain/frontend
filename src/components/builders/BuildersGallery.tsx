"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createPublicClient, type PublicClient } from "viem";
import useSWR from "swr";
import { BUILDERS, buildersStatusLine } from "@/lib/builders-network";
import { transportFor } from "@/lib/chains";
import {
  FILTERS,
  browserProofCheck,
  builderAnchor,
  claimHref,
  filterGallery,
  galleryCounts,
  initialOf,
  labelOf,
  mergeGallery,
  mergeNominees,
  overlayLive,
  parsePublicInvites,
  projectChipKind,
  projectsNeedingCheck,
  proofHref,
  readLiveGallery,
  sourceHref,
  toneOf,
  xHref,
  type GalleryBuilder,
  type GalleryEntry,
  type GalleryFilter,
  type GalleryProject,
  type GalleryReader,
  type GallerySnapshot,
  type LiveProof,
  type Nominee,
  type ProjectChip,
} from "@/lib/builders-gallery";
import { badgeImageBase, parseBuilderParam } from "@/lib/verified-builder-badge";
import { BuilderBadgeSection } from "@/components/BuilderBadgeSection";
import type { BadgeNet } from "@/components/BuilderBadgeCard";
import { useWallet } from "@/components/WalletProvider";
import { sourceLabel } from "@/lib/verified-builders";
import { BuilderEconomyFacts } from "@/components/builders/BuilderEconomyFacts";

const REG = BUILDERS.contracts.BuilderRegistry;
const BADGE = BUILDERS.contracts.VerifiedBuilderBadge;
/** The builders network's badge, for the detail view. */
const BADGE_NET: BadgeNet = { chain: BUILDERS.chain, badge: BADGE, network: BUILDERS.badgeNetwork };

const regionName = (() => {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    return (code: string) => {
      const n = names.of(code);
      return n && n !== code ? n : code;
    };
  } catch {
    return (code: string) => code;
  }
})();

/** Run `fn` over `items`, at most `limit` at a time. */
async function eachLimited<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let t = queue.shift(); t !== undefined; t = queue.shift()) await fn(t);
    }),
  );
}

/**
 * The snapshot, then the chain: builders and projects added after the sync
 * appear (their proofs checked in the browser), caretakers, badges and project
 * flags refreshed. Any RPC failure leaves the snapshot on screen, silently.
 */
function useLiveBuilders(snapshot: GallerySnapshot | null): GalleryBuilder[] {
  const base = useMemo(() => snapshot?.builders ?? [], [snapshot]);
  const { data } = useSWR(
    REG ? ["builders-gallery-live", BUILDERS.chainId, REG, snapshot?.syncedAt ?? ""] : null,
    async () => {
      const client = createPublicClient({
        chain: BUILDERS.chain.viemChain,
        transport: transportFor(BUILDERS.chain, { batch: true }),
      }) as PublicClient;
      const rows = await readLiveGallery(client as unknown as GalleryReader, {
        registry: REG!,
        caretakers: BUILDERS.contracts.CaretakerRegistry,
        badge: BUILDERS.badgesOn ? BADGE : null,
        imageBase: badgeImageBase(BUILDERS.badgeNetwork ?? "arc"),
      });
      const snapById = new Map(base.map((b) => [b.id, b]));
      const proofs = new Map<number, LiveProof>();
      const checks = rows.flatMap((r) => projectsNeedingCheck(r, snapById.get(r.id)).map((p) => ({ owner: r.owner, id: p.id, source: p.source })));
      await eachLimited(checks, 4, async (c) => {
        proofs.set(c.id, await browserProofCheck({ owner: c.owner, source: c.source }, { chainId: BUILDERS.chainId }));
      });
      return overlayLive(base, rows, proofs, BUILDERS.operator);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false, dedupingInterval: 60_000 },
  );
  return data ?? base;
}

/**
 * The invites the owner made in /admin (builder.registrai.cc's GET
 * /api/invites, public fields only), merged into the file's nominees. Where
 * the API does not exist (registrai.cc, a local static build) or fails, the
 * file alone is shown, silently.
 */
function useNominees(file: Nominee[]): Nominee[] {
  const { data } = useSWR(
    "builders-api-invites",
    async () => {
      const res = await fetch("/api/invites", { headers: { accept: "application/json" } });
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/json")) throw new Error(`invites ${res.status}`);
      return parsePublicInvites(await res.json());
    },
    { revalidateOnFocus: false, shouldRetryOnError: false, dedupingInterval: 60_000 },
  );
  return useMemo(() => (data?.length ? mergeNominees(file, data) : file), [file, data]);
}

/** `?builder=<id>` (the badge's on-chain external_url): the open detail view. Suspense leaf for the static export. */
function BuilderParam({ onBuilder }: { onBuilder: (id: number | null) => void }) {
  const id = parseBuilderParam(useSearchParams()?.get("builder"));
  useEffect(() => {
    onBuilder(id ?? null);
  }, [id, onBuilder]);
  return null;
}

const detailHref = (id: number) => `/builders/?builder=${id}`;

/** The builder's avatar (first verified GitHub project's owner), else (domain, none, or a failed load) the name's initial. */
function Avatar({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="bld-avatar" aria-hidden="true">
      {url && !failed ? (
        // Static export: next/image optimisation is off; a plain lazy img is the same thing.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" width={56} height={56} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span>{initialOf(name)}</span>
      )}
    </div>
  );
}

const CHIP_TITLE: Record<ProjectChip["kind"], string> = {
  verified: "verified project",
  nominated: "verified project · builder awaiting onboarding",
  lapsed: "proof missing or no longer valid",
};

/** The builder's active projects as chips: verified / nominated in colour, lapsed greyed. */
function ProjectChips({ chips }: { chips: ProjectChip[] }) {
  if (!chips.length) return null;
  return (
    <ul className="bld-projects" aria-label="Projects">
      {chips.map((c) => (
        <li key={`${c.id}-${c.source}`}>
          <a
            className="bld-pchip"
            data-kind={c.kind}
            href={sourceHref(c.source)}
            target="_blank"
            rel="noreferrer"
            title={`${c.source}: ${CHIP_TITLE[c.kind]}${c.unchecked ? " (proof check at next sync)" : ""}`}
          >
            {c.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** What a card and the detail view both say about a builder's state. */
function StatusNote({ e }: { e: GalleryEntry }) {
  const b = e.builder;
  if (e.kind === "nominated")
    return <p className="bld-note">{b?.proofUnchecked ? "Nominated · proof check at next sync" : "Claimed and registered · awaiting onboarding"}</p>;
  if (e.kind === "lapsed") return <p className="bld-note">No project proof checks out right now</p>;
  if (e.kind === "invited") return <p className="bld-note">Invited · not claimed yet</p>;
  return null;
}

function BuilderCard({ e, highlighted }: { e: GalleryEntry; highlighted: boolean }) {
  const b = e.builder;
  const proof = !b && e.source ? proofHref(e.source) : null;
  const projects = b ? b.projects.filter((p) => p.active).length : 0;
  return (
    <li
      id={b ? builderAnchor(b.id) : e.key}
      className="bld-card"
      data-kind={e.kind}
      data-tone={toneOf(e.kind)}
      data-highlight={highlighted ? "true" : undefined}
    >
      <div className="bld-card-top">
        <Avatar url={e.avatar} name={e.name} />
        <div className="bld-card-title">
          <h2 title={e.name}>
            {b ? (
              <Link href={detailHref(b.id)} scroll={false} className="bld-card-open">
                {e.name}
              </Link>
            ) : (
              e.name
            )}
          </h2>
          {!b && e.source && (
            <a href={sourceHref(e.source)} target="_blank" rel="noreferrer">
              {sourceLabel(e.source)} ↗
            </a>
          )}
          {b && <span className="bld-card-sub">{projects === 1 ? "1 project" : `${projects} projects`}</span>}
        </div>
        <span className="bld-chip" data-kind={e.kind}>{labelOf(e.kind)}</span>
      </div>

      <ProjectChips chips={e.chips} />

      {(b || e.x) && (
        <dl className="bld-facts">
          {b && (
            <div>
              <dt>builder</dt>
              <dd className="tnum">#{b.id}</dd>
            </div>
          )}
          {b?.country && (e.kind === "verified" || e.kind === "nominated") && (
            <div>
              <dt>country</dt>
              <dd title={regionName(b.country)}>{b.country}</dd>
            </div>
          )}
          {e.x && (
            <div>
              <dt>X</dt>
              <dd>
                <a href={xHref(e.x)} target="_blank" rel="noreferrer">{e.x}</a>
              </dd>
            </div>
          )}
        </dl>
      )}

      <StatusNote e={e} />

      <div className="bld-card-foot">
        {proof && (
          <a href={proof} target="_blank" rel="noreferrer">
            proof ↗
          </a>
        )}
        {e.kind === "invited" && e.source && (
          <Link className="bld-claim" href={claimHref(e.source)}>
            Claim this project →
          </Link>
        )}
        {b && (
          <Link className="bld-claim" href={detailHref(b.id)} scroll={false}>
            details →
          </Link>
        )}
      </div>
    </li>
  );
}

const PROJECT_STATUS_LABEL = { verified: "Verified", nominated: "Nominated", lapsed: "Lapsed" } as const;

/** Every project of a builder (removed ones too): source, proof, status. */
function ProjectList({ b }: { b: GalleryBuilder }) {
  if (!b.projects.length) return <p className="bld-note">No projects on chain.</p>;
  return (
    <div className="bld-plist" role="table" aria-label="Projects">
      {b.projects.map((p: GalleryProject) => {
        const kind = projectChipKind(p, b);
        const proof = p.proofUrl ?? proofHref(p.source);
        return (
          <div role="row" key={`${p.id}-${p.source}`} className="bld-plist-row" data-kind={kind ?? "inactive"}>
            <span role="cell" className="bld-plist-name">
              <a href={sourceHref(p.source)} target="_blank" rel="noreferrer">
                {sourceLabel(p.source)} ↗
              </a>
              <small>
                {p.source.startsWith("github:") ? "open source · repo" : "closed source · domain"}
                {p.id ? ` · project #${p.id}` : ""}
              </small>
            </span>
            <span role="cell">
              {proof && p.active ? (
                <a href={proof} target="_blank" rel="noreferrer">
                  proof ↗
                </a>
              ) : null}
            </span>
            <span role="cell">
              <span className="bld-pchip" data-kind={kind ?? "inactive"}>
                {kind ? PROJECT_STATUS_LABEL[kind] : "Removed"}
                {p.proofUnchecked ? " · unchecked" : ""}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const isoDate = (s: number) => (s > 0 ? new Date(s * 1000).toISOString().slice(0, 10) : null);

/**
 * One builder, opened from its card or from `?builder=<id>` (where the badge's
 * explorer link lands): the facts, the proof, and — for verified builders —
 * the badge itself, plus the X share card when the connected wallet is theirs.
 */
function BuilderDetail({ e, onClose }: { e: GalleryEntry; onClose: () => void }) {
  const b = e.builder!;
  const { address } = useWallet();
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  const registered = isoDate(b.createdAt);
  return (
    <div className="bld-detail-backdrop" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${e.name}: builder #${b.id}`}
        className="bld-detail"
        data-kind={e.kind}
        data-tone={toneOf(e.kind)}
        onClick={(ev) => ev.stopPropagation()}
      >
        <button type="button" className="bld-detail-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="bld-card-top">
          <Avatar url={e.avatar} name={e.name} />
          <div className="bld-card-title">
            <h2 title={e.name}>{e.name}</h2>
            <span className="bld-card-sub">builder #{b.id}</span>
          </div>
          <span className="bld-chip" data-kind={e.kind}>{labelOf(e.kind)}</span>
        </div>

        <dl className="bld-facts">
          <div>
            <dt>builder</dt>
            <dd className="tnum">#{b.id}</dd>
          </div>
          {b.country && (e.kind === "verified" || e.kind === "nominated") && (
            <div>
              <dt>country</dt>
              <dd>{regionName(b.country)}</dd>
            </div>
          )}
          {registered && (
            <div>
              <dt>registered</dt>
              <dd className="tnum">{registered}</dd>
            </div>
          )}
          <div>
            <dt>wallet</dt>
            <dd>
              <a href={`${BUILDERS.explorer.url}/address/${b.owner}`} target="_blank" rel="noreferrer">{shortAddr(b.owner)} ↗</a>
            </dd>
          </div>
          {e.x && (
            <div>
              <dt>X</dt>
              <dd>
                <a href={xHref(e.x)} target="_blank" rel="noreferrer">{e.x}</a>
              </dd>
            </div>
          )}
        </dl>

        <BuilderEconomyFacts builderId={b.id} />

        <StatusNote e={e} />

        <ProjectList b={b} />

        {BADGE && (
          <BuilderBadgeSection
            builderId={b.id}
            owner={b.owner}
            name={e.name}
            source={e.source}
            snapshot={b.badge}
            viewer={address}
            net={BADGE_NET}
          />
        )}
      </section>
    </div>
  );
}

export function BuildersGallery({ snapshot, nominees: fileNominees }: { snapshot: GallerySnapshot | null; nominees: Nominee[] }) {
  const builders = useLiveBuilders(snapshot);
  const nominees = useNominees(fileNominees);
  const entries = useMemo(() => mergeGallery(builders, nominees), [builders, nominees]);
  const counts = useMemo(() => galleryCounts(entries), [entries]);

  const [filter, setFilter] = useState<GalleryFilter>("all");
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterGallery(entries, filter, query), [entries, filter, query]);

  // ?builder=<id>: the detail view of that builder (the card stays highlighted underneath).
  const router = useRouter();
  const [target, setTarget] = useState<number | null>(null);
  const openEntry = useMemo(() => (target ? entries.find((e) => e.builder?.id === target) ?? null : null), [target, entries]);
  const closeDetail = useCallback(() => {
    setTarget(null);
    router.replace("/builders/", { scroll: false });
  }, [router]);

  const chipCount = (f: GalleryFilter) => (f === "all" ? counts.all : counts[f]);

  return (
    <>
      <Suspense fallback={null}>
        <BuilderParam onBuilder={setTarget} />
      </Suspense>

      <header className="perennial-app-header bld-header">
        <div>
          <div className="perennial-app-status">
            <i /> {buildersStatusLine(BUILDERS)}
          </div>
          <h1>Verified builders</h1>
          <p className="bld-deck">
            Builders on Arc and their projects, each project claimed by the builder&apos;s wallet with a signed proof in
            its repo or on its domain, and registered on-chain.
          </p>
          <div className="vf-invite mt-3">
            Building on Arc? <Link href="/verify">Claim your project →</Link>
          </div>
        </div>
        <dl className="bld-stats" aria-label="Gallery counts">
          <div>
            <dt>verified</dt>
            <dd className="tnum">{counts.verified}</dd>
          </div>
          <div>
            <dt>nominated</dt>
            <dd className="tnum">{counts.nominated}</dd>
          </div>
          <div>
            <dt>invited</dt>
            <dd className="tnum">{counts.invited}</dd>
          </div>
          <div>
            <dt>countries</dt>
            <dd className="tnum">{counts.countries}</dd>
          </div>
        </dl>
      </header>

      {entries.length === 0 ? (
        <div className="bld-empty">
          <p>No builders yet. The first ones appear here as soon as they claim their project.</p>
          <Link className="vf-link" href="/verify">Building on Arc? Claim your project →</Link>
        </div>
      ) : (
        <>
          <div className="bld-toolbar">
            <div className="bld-chips" role="group" aria-label="Filter builders">
              {FILTERS.map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} data-kind={f} onClick={() => setFilter(f)}>
                  {f === "all" ? "All" : labelOf(f)} <span className="tnum">{chipCount(f)}</span>
                </button>
              ))}
            </div>
            <label className="bld-search">
              <span className="sr-only">Search builders</span>
              <input
                type="search"
                value={query}
                onChange={(ev) => setQuery(ev.target.value)}
                placeholder="search builder, project, @handle, country, No."
                spellCheck={false}
                autoCapitalize="off"
              />
            </label>
          </div>

          {shown.length === 0 ? (
            <div className="bld-empty">
              <p>Nothing matches.</p>
              <button
                type="button"
                className="vf-mini"
                onClick={() => {
                  setFilter("all");
                  setQuery("");
                }}
              >
                clear filters
              </button>
            </div>
          ) : (
            <ul className="bld-grid">
              {shown.map((e) => (
                <BuilderCard key={e.key} e={e} highlighted={Boolean(target && e.builder?.id === target)} />
              ))}
            </ul>
          )}
        </>
      )}

      {openEntry && <BuilderDetail e={openEntry} onClose={closeDetail} />}

      <p className="bld-legend">
        In colour: claimed builders (verified, or nominated and awaiting the multisig&apos;s onboarding batch). In
        grayscale: builders with no project proof that checks out, and invited projects that haven&apos;t claimed yet.
        Project chips: verified, nominated, or greyed when that project&apos;s proof has lapsed.
        {snapshot?.syncedAt ? ` Snapshot ${snapshot.syncedAt.slice(0, 10)}, updated live from ${BUILDERS.label}.` : ""}
      </p>
    </>
  );
}
