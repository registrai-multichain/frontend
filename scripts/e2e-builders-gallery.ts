/**
 * LOCAL MAINNET-FORK E2E ONLY (contracts/e2e/mainnet_fork_e2e.py). Reads a local
 * anvil fork of Arc mainnet the way the /builders gallery and /admin do, with the
 * SHIPPED mainnet builder config (src/lib/builders-network.ts BUILDERS, i.e.
 * deployments/arc-mainnet.json) — only the RPC is the fork's.
 *
 *   npx tsx scripts/e2e-builders-gallery.ts '<json>'
 *
 * <json>: { rpc, action, githubBase?, domainPort?, ...args }
 *   info       BUILDERS as shipped (network, chain, contracts, operator, deploy block, badge base)
 *   gallery    readLiveGallery -> checkLiveProofs(browserProofCheck) -> overlayLive, per builder:
 *              status, displayKind, greyReason, builderName, chips, badge; plus the /admin
 *              onboarding queue (readRevokedBuilders + onboardingQueue)
 *   revokeFile / startRecoveryFile   the /admin Safe files (revokeSafeFile, startRecoverySafeFile)
 *
 * Proof reads go through the page's own direct-read path (readProofDirect via
 * browserProofCheck's fetchImpl); that fetch maps ONLY https://raw.githubusercontent.com
 * and https://127.0.0.1|localhost to the e2e's local stand-in servers and refuses
 * every other URL, so nothing leaves this machine.
 *
 * Refuses unless the RPC is http://127.0.0.1|localhost, answers anvil_nodeInfo
 * (an anvil, i.e. a fork, never a real node) and reports BUILDERS.chainId (5042).
 * Prints one JSON line.
 */
import { createPublicClient, getAddress, http, type Address, type PublicClient } from "viem";
import { BUILDERS } from "../src/lib/builders-network";
import {
  browserProofCheck,
  builderName,
  checkLiveProofs,
  displayKind,
  greyReason,
  overlayLive,
  projectChips,
  readLiveGallery,
  type GalleryReader,
} from "../src/lib/builders-gallery";
import { onboardingQueue, revokeSafeFile, startRecoverySafeFile } from "../src/lib/builders-admin-chain";
import { readRevokedBuilders, type LogReader } from "../src/lib/badge-revocations";
import { badgeImageBase } from "../src/lib/verified-builder-badge";

type Args = { rpc: string; action: string; githubBase?: string; domainPort?: number } & Record<string, unknown>;
const args = JSON.parse(process.argv[2] ?? "{}") as Args;

const out = (o: unknown) => console.log(JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
function die(msg: string, extra: Record<string, unknown> = {}): never {
  out({ ok: false, error: msg, ...extra });
  process.exit(1);
}

const LOCAL = new Set(["127.0.0.1", "localhost"]);

function localRpc(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return die(`not a URL: ${raw}`);
  }
  if (u.protocol !== "http:" || !LOCAL.has(u.hostname)) die(`refusing: ${raw} is not a local fork RPC (http://127.0.0.1:<port>)`);
  return raw;
}

/** The page's fetch, pointed at the e2e's stand-ins; anything else is refused. */
function localFetch(githubBase: string, domainPort: number): typeof fetch {
  const gh = new URL(githubBase);
  if (gh.protocol !== "http:" || !LOCAL.has(gh.hostname)) die(`githubBase must be a local http stand-in: ${githubBase}`);
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    let mapped: string;
    if (u.protocol === "https:" && u.hostname === "raw.githubusercontent.com") {
      mapped = `${githubBase.replace(/\/+$/, "")}${u.pathname}${u.search}`;
    } else if (u.protocol === "https:" && LOCAL.has(u.hostname)) {
      mapped = `http://${u.hostname}:${domainPort}${u.pathname}${u.search}`;
    } else {
      throw new Error(`e2e fetch refused (never leaves localhost): ${u.href}`);
    }
    return fetch(mapped, init);
  }) as typeof fetch;
}

async function main() {
  const rpc = localRpc(args.rpc);
  if (BUILDERS.network !== "mainnet") die(`BUILDERS resolves to ${BUILDERS.network}, not mainnet`);
  const client = createPublicClient({ chain: BUILDERS.chain.viemChain, transport: http(rpc) }) as PublicClient;
  const live = await client.getChainId();
  if (live !== BUILDERS.chainId) die(`fork reports chain ${live}, BUILDERS says ${BUILDERS.chainId}`);
  try {
    await client.request({ method: "anvil_nodeInfo" as never } as never);
  } catch {
    die(`refusing: ${rpc} is not an anvil (no anvil_nodeInfo)`);
  }
  const REG = BUILDERS.contracts.BuilderRegistry!;
  const CT = BUILDERS.contracts.CaretakerRegistry;
  const BADGE = BUILDERS.contracts.VerifiedBuilderBadge;
  const imageBase = badgeImageBase(BUILDERS.badgeNetwork ?? "arc");

  switch (args.action) {
    case "info":
      return out({
        ok: true,
        network: BUILDERS.network,
        chainId: BUILDERS.chainId,
        rpc: BUILDERS.rpc,
        contracts: BUILDERS.contracts,
        operator: BUILDERS.operator,
        deployBlock: BUILDERS.deployBlock,
        badgeNetwork: BUILDERS.badgeNetwork,
        badgesOn: BUILDERS.badgesOn,
        imageBase,
      });
    case "gallery": {
      const f = localFetch(String(args.githubBase), Number(args.domainPort));
      const rows = await readLiveGallery(client as unknown as GalleryReader, {
        registry: REG,
        caretakers: CT,
        badge: BUILDERS.badgesOn ? BADGE : null,
        imageBase,
      });
      const proofs = await checkLiveProofs(rows, (p) => browserProofCheck(p, { chainId: BUILDERS.chainId, fetchImpl: f }));
      const builders = overlayLive([], rows, proofs, BUILDERS.operator);
      const revoked = BADGE && BUILDERS.deployBlock !== null
        ? await readRevokedBuilders(client as unknown as LogReader, { badge: BADGE, registry: REG, fromBlock: BUILDERS.deployBlock })
        : { ok: false as const, error: "no badge / deploy block" };
      const q = onboardingQueue(builders, {
        builderRegistry: REG,
        caretakerRegistry: CT!,
        operator: getAddress(BUILDERS.operator!),
        badge: BADGE,
        revoked: revoked.ok ? revoked.revoked : null,
      });
      return out({
        ok: true,
        builders: builders.map((b) => {
          const kind = displayKind(b);
          return {
            id: b.id,
            owner: b.owner,
            status: b.status,
            display: kind,
            grey: greyReason(b),
            name: builderName(b, [], kind === "verified"),
            onboarded: Boolean(b.onboarded),
            badge: b.badge,
            unchecked: Boolean(b.proofUnchecked),
            projects: b.projects.map((p) => ({ id: p.id, source: p.source, active: p.active, status: p.status })),
            chips: projectChips(b).map((c) => ({ id: c.id, kind: c.kind })),
          };
        }),
        admin: {
          revokedRead: revoked.ok,
          revoked: revoked.ok ? [...revoked.revoked] : [],
          included: q.included.map((b) => b.id),
          held: q.revoked.map((r) => r.builder.id),
          excluded: q.excluded.map((b) => b.id),
          txs: q.plan.txs.map((t) => ({ kind: t.kind, to: t.to, data: t.data })),
        },
      });
    }
    case "revokeFile":
      return out({
        ok: true,
        file: revokeSafeFile({
          badge: BADGE!, registry: REG, builderId: Number(args.builderId), serial: Number(args.serial),
          chainId: BUILDERS.chainId, createdAt: Date.now(),
        }),
      });
    case "startRecoveryFile":
      return out({
        ok: true,
        file: startRecoverySafeFile({
          registry: REG, builderId: Number(args.builderId), newOwner: getAddress(String(args.newOwner)) as Address,
          chainId: BUILDERS.chainId, createdAt: Date.now(),
        }),
      });
    default:
      die(`unknown action ${args.action}`);
  }
}

main().catch((e) => die(e instanceof Error ? e.message.split("\n").slice(0, 6).join(" | ") : String(e)));
