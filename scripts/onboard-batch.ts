/**
 * Onboarding batch for the multisig (REGISTRAR + GOVERNOR). Reads the chain,
 * fetches and validates every active project's proof, and writes — never signs,
 * never sends — a Safe Transaction Builder file plus a plain calldata list with
 * (per BUILDER; spec docs/superpowers/specs/2026-09-24-builder-projects-design.md):
 *
 *   setCaretaker(id, operator)       for every PENDING builder (≥1 verified
 *                                    project, caretaker not ours yet)
 *   registerFor(builder, "")         for each --register source whose proof is
 *                                    valid and whose wallet is not registered yet
 *                                    (claims DM'd by builders without Arc gas)
 *   addProjectFor(id, source)        for each --register source whose wallet is
 *                                    already builder #id and not yet holding it
 *   issue(id)                        with --badge <address>: the Verified Builder
 *                                    Badge, for every PENDING builder (right after
 *                                    its setCaretaker) and every VERIFIED builder
 *                                    whose serialOf(id) == 0 — only while it has
 *                                    an active project (activeProjectCount > 0).
 *                                    On --network mainnet the badge is on by
 *                                    default (builders.VerifiedBuilderBadge);
 *                                    --no-badge turns it off.
 *
 * A builder whose badge was REVOKED (a Revoked event with no
 * BuilderStatusSet(id, true) after it) is never onboarded or issued again: the
 * logs are read from the deploy block (--from-block overrides) whenever a
 * badge is in play.
 *
 * Mainnet phase 1 fills only the `builders` block of
 * src/lib/deployments/arc-mainnet.json; every default falls back to it.
 *
 * A wallet registered by this batch gets its project (addProjectFor), then its
 * caretaker, in the NEXT batches (its id exists only after registration): run
 * the script again, with the same --register, once this one executes.
 *
 *   npx tsx scripts/onboard-batch.ts [--network testnet|mainnet|local] [--rpc URL]
 *     [--register <source> ...] [--badge 0x.. | --no-badge] [--from-block N] [--out <dir>]
 *     [--builder-registry 0x..] [--caretaker-registry 0x..] [--operator 0x..] [--chain-id N]
 *
 * <source> is anything /verify accepts: github.com/owner/repo, owner/repo,
 * github:owner/repo, https://host, host, domain:host. Several may follow one
 * --register, or repeat the flag.
 *
 * Without --out: the Safe JSON and the calldata list go to stdout (delimited);
 * the per-builder report goes to stderr. With --out <dir>: writes
 * <dir>/onboard-batch.safe.json and <dir>/onboard-batch.calldata.txt.
 *
 * Env (tests only): PROOF_GITHUB_BASE, PROOF_DOMAIN_SCHEME — see the spec.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createPublicClient, defineChain, getAddress, http, isAddress, type Address } from "viem";
import {
  calldataList,
  mainnetOnboardDefaults,
  planOnboarding,
  safeBatchJson,
  verifiedSourcesOf,
  type OnboardNetworkDefaults,
  type RegistrationCandidate,
} from "../src/lib/onboard-batch";
import { readRevokedBuilders, type LogReader } from "../src/lib/badge-revocations";
import { makeFetchJson, readBuilderRecords, verifiedBuilderAbi, type RegistryReader } from "../src/lib/verified-builders-chain";
import { normalizeSource, proofConfigFromEnv, proofUrl, validateProof } from "../src/lib/verified-builders";
import { badgeAbi, serialLabel } from "../src/lib/verified-builder-badge";

type Network = "testnet" | "mainnet" | "local";
const die = (msg: string): never => {
  console.error(`onboard-batch: ${msg}`);
  process.exit(1);
};
const log = (msg = "") => console.error(msg);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    network: { type: "string", default: "testnet" },
    rpc: { type: "string" },
    register: { type: "string", multiple: true, default: [] },
    out: { type: "string" },
    "builder-registry": { type: "string" },
    "caretaker-registry": { type: "string" },
    operator: { type: "string" },
    "chain-id": { type: "string" },
    badge: { type: "string" },
    "no-badge": { type: "boolean" },
    "from-block": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.error(readFileSync(__filename, "utf8").split("*/")[0].replace(/^\/\*\*?/, "").replace(/^ \* ?/gm, ""));
  process.exit(0);
}

const network = values.network as Network;
if (!["testnet", "mainnet", "local"].includes(network)) die(`--network must be testnet, mainnet or local (got ${network})`);

const readJson = (p: string) => JSON.parse(readFileSync(resolve(__dirname, p), "utf8"));

/** Defaults per network; every one can be overridden on the command line. */
function defaults(n: Network): OnboardNetworkDefaults {
  if (n === "local") {
    return { rpc: "http://127.0.0.1:8545", chainId: 31337, builderRegistry: null, caretakerRegistry: null, operator: null, badge: null, deployBlock: 0 };
  }
  if (n === "mainnet") return mainnetOnboardDefaults(readJson("../src/lib/deployments/arc-mainnet.json"));
  const extras = readJson("../src/lib/deployments/arc-testnet-perennial.json");
  const deploymentPath = resolve(__dirname, "../../contracts/deployments/arc-testnet.json");
  const c = existsSync(deploymentPath)
    ? JSON.parse(readFileSync(deploymentPath, "utf8")).contracts
    : readJson("../src/lib/live-data.json").contracts;
  return {
    rpc: "https://rpc.testnet.arc.io",
    chainId: 5042002,
    builderRegistry: c?.BuilderRegistry ?? null,
    caretakerRegistry: c?.CaretakerRegistry ?? null,
    operator: extras.operator ?? null,
    // Opt-in on testnet (--badge), as before.
    badge: null,
    deployBlock: extras.builders?.deployBlock ?? extras.deployBlock ?? null,
  };
}

function addressArg(name: string, v: string | null | undefined): Address {
  if (!v) return die(`no ${name} for --network ${network}; pass --${name} 0x…`);
  if (!isAddress(v, { strict: false })) return die(`--${name} is not an address: ${v}`);
  return getAddress(v);
}

async function main() {
  const d = defaults(network);
  const rpc = values.rpc ?? d.rpc;
  const chainId = values["chain-id"] ? Number(values["chain-id"]) : d.chainId;
  if (!Number.isSafeInteger(chainId) || chainId <= 0) die(`--chain-id must be a positive integer`);
  const builderRegistry = addressArg("builder-registry", values["builder-registry"] ?? d.builderRegistry);
  const caretakerRegistry = addressArg("caretaker-registry", values["caretaker-registry"] ?? d.caretakerRegistry);
  const operator = addressArg("operator", values.operator ?? d.operator);
  // Mainnet: the phase-1 badge by default (--no-badge turns it off). Elsewhere opt-in with --badge.
  const badgeRaw = values["no-badge"] ? undefined : (values.badge ?? d.badge ?? undefined);
  const badge = badgeRaw !== undefined ? addressArg("badge", badgeRaw) : undefined;

  const chain = defineChain({
    id: chainId,
    name: `chain ${chainId}`,
    nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  // Read-only: a public client, no account, no wallet.
  const client = createPublicClient({ chain, transport: http(rpc, { retryCount: 6, retryDelay: 800 }) });
  const live = await client.getChainId();
  if (live !== chainId) die(`RPC ${rpc} is chain ${live}, expected ${chainId}`);

  const proofConfig = proofConfigFromEnv(process.env);
  const fetchJson = makeFetchJson({ timeoutMs: 15_000 });

  log(`network ${network} · chain ${chainId} · rpc ${rpc}`);
  log(`BuilderRegistry ${builderRegistry} · CaretakerRegistry ${caretakerRegistry} · operator ${operator}`);
  if (badge) {
    // A badge contract bound to another registry would issue to the wrong owners.
    const bound = (await client.readContract({ address: badge, abi: badgeAbi, functionName: "BUILDERS" })) as Address;
    if (bound.toLowerCase() !== builderRegistry.toLowerCase()) die(`--badge ${badge} is bound to BuilderRegistry ${bound}, not ${builderRegistry}`);
    log(`VerifiedBuilderBadge ${badge}`);
  }
  log();

  const records = await readBuilderRecords(client as unknown as RegistryReader, {
    builderRegistry, caretakerRegistry, operator, chainId, proofConfig, fetchJson,
  });
  log(`builders (${records.length}):`);
  for (const r of records) {
    log(`  #${r.builderId} ${r.status.padEnd(10)} ${r.owner} (${r.activeProjectCount} active project(s))`);
    for (const p of r.projects) {
      const why = p.proofError ? ` — ${p.proofError}` : "";
      log(`      project ${p.projectId} ${p.status.padEnd(8)} ${JSON.stringify(p.source)}${why}`);
    }
  }
  log();

  // --register candidates: normalise, fetch, validate against claim.builder
  // (the owner the registration will create), then look up builderIdOf.
  const inputs = [...(values.register ?? []), ...positionals];
  const registrations: RegistrationCandidate[] = [];
  for (const input of inputs) {
    const source = normalizeSource(input);
    if (!source) {
      registrations.push({ source: input, builder: null, proofError: "not a github repo or domain", existingId: 0 });
      continue;
    }
    const url = proofUrl(source, proofConfig);
    const file = await fetchJson(url);
    const claimed = (file as { claim?: { builder?: unknown } } | null)?.claim?.builder;
    if (file === null || typeof claimed !== "string") {
      registrations.push({ source, builder: null, proofError: `no readable proof at ${url}`, existingId: 0 });
      continue;
    }
    const r = await validateProof(file, { expectedSource: source, onchainOwner: claimed, chainId });
    if (!r.valid) {
      registrations.push({ source, builder: null, proofError: `rule ${r.rule}: ${r.reason} (${url})`, existingId: 0 });
      continue;
    }
    const builder = getAddress(r.claim.builder);
    const existingId = Number(
      await client.readContract({ address: builderRegistry, abi: verifiedBuilderAbi, functionName: "builderIdOf", args: [builder] }),
    );
    const existing = records.find((x) => x.builderId === existingId);
    registrations.push({
      source,
      builder,
      existingId,
      existingSources: existing ? existing.projects.filter((p) => p.active).map((p) => p.source) : [],
      existingProjectCount: existing?.projects.length ?? 0,
      existingActive: existing?.active ?? true,
    });
  }

  // Revoked badges: never re-onboarded (a Revoked event not followed by a reactivation).
  let revoked: Set<number> | undefined;
  if (badge) {
    const from = values["from-block"] !== undefined ? Number(values["from-block"]) : d.deployBlock;
    if (from === null || !Number.isSafeInteger(from) || from < 0) {
      die(`no deploy block for --network ${network} to read badge revocations from: pass --from-block N`);
    }
    const r = await readRevokedBuilders(client as unknown as LogReader, { badge, registry: builderRegistry, fromBlock: BigInt(from as number) });
    if (!r.ok) die(`could not read the badge revocation history: ${r.error}`);
    revoked = (r as { revoked: Set<number> }).revoked;
    log(`revoked badges (not reactivated since block ${from}): ${revoked.size ? [...revoked].map((id) => `#${id}`).join(", ") : "none"}`);
    log();
  }

  // serialOf for the builders a badge could go to (pending + verified).
  let badgePlan: { address: Address; serials: Map<number, number> } | undefined;
  if (badge) {
    const serials = new Map<number, number>();
    for (const r of records) {
      if (r.status !== "pending" && r.status !== "verified") continue;
      const serial = Number(await client.readContract({ address: badge, abi: badgeAbi, functionName: "serialOf", args: [BigInt(r.builderId)] }));
      serials.set(r.builderId, serial);
      log(`  badge #${r.builderId}: ${serial ? serialLabel(serial) : "none"}`);
    }
    log();
    badgePlan = { address: badge, serials };
  }

  const plan = planOnboarding({
    records: records.map((r) => ({ ...r, verifiedSources: verifiedSourcesOf(r) })),
    registrations,
    builderRegistry,
    caretakerRegistry,
    operator,
    badge: badgePlan,
    revoked,
  });
  for (const s of plan.skipped) log(`skip ${s.what}: ${s.reason}`);
  if (plan.skipped.length) log();
  log(`${plan.txs.length} transaction(s) in the batch. Nothing was signed or sent.`);

  const safe = safeBatchJson(plan.txs, { chainId, createdAt: Date.now() });
  const calldata = calldataList(plan.txs);
  if (values.out) {
    const dir = resolve(process.cwd(), values.out);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "onboard-batch.safe.json"), `${JSON.stringify(safe, null, 2)}\n`);
    writeFileSync(resolve(dir, "onboard-batch.calldata.txt"), calldata);
    log(`wrote ${resolve(dir, "onboard-batch.safe.json")}`);
    log(`wrote ${resolve(dir, "onboard-batch.calldata.txt")}`);
  } else {
    process.stdout.write(`=== onboard-batch.safe.json ===\n${JSON.stringify(safe, null, 2)}\n=== onboard-batch.calldata.txt ===\n${calldata}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
