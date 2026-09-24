/**
 * Onboarding batch for the multisig (REGISTRAR + GOVERNOR). Reads the chain,
 * fetches and validates every builder's proof, and writes — never signs, never
 * sends — a Safe Transaction Builder file plus a plain calldata list with:
 *
 *   setCaretaker(id, operator)            for every PENDING builder
 *   registerFor(builder, "registrai:"+src) for each --register source whose proof
 *                                          is valid and whose builder is not yet
 *                                          registered (claims DM'd by builders
 *                                          without Arc gas)
 *
 * A builder registered by this batch gets its caretaker in the NEXT batch (its id
 * exists only after registration): run the script again once this one executes.
 *
 *   npx tsx scripts/onboard-batch.ts [--network testnet|mainnet|local] [--rpc URL]
 *     [--register <source> ...] [--out <dir>]
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
import { calldataList, planOnboarding, safeBatchJson, type RegistrationCandidate } from "../src/lib/onboard-batch";
import { makeFetchJson, readBuilderRecords, verifiedBuilderAbi, type RegistryReader } from "../src/lib/verified-builders-chain";
import { normalizeSource, proofConfigFromEnv, proofUrl, validateProof } from "../src/lib/verified-builders";

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
function defaults(n: Network): { rpc: string; chainId: number; builderRegistry?: string | null; caretakerRegistry?: string | null; operator?: string | null } {
  if (n === "local") return { rpc: "http://127.0.0.1:8545", chainId: 31337 };
  if (n === "mainnet") {
    const d = readJson("../src/lib/deployments/arc-mainnet.json");
    return {
      rpc: "https://rpc.mainnet.arc.io",
      chainId: 5042,
      builderRegistry: d.contracts?.BuilderRegistry,
      caretakerRegistry: d.contracts?.CaretakerRegistry,
      operator: d.operator,
    };
  }
  const extras = readJson("../src/lib/deployments/arc-testnet-perennial.json");
  const deploymentPath = resolve(__dirname, "../../contracts/deployments/arc-testnet.json");
  const c = existsSync(deploymentPath)
    ? JSON.parse(readFileSync(deploymentPath, "utf8")).contracts
    : readJson("../src/lib/live-data.json").contracts;
  return {
    rpc: "https://rpc.testnet.arc.io",
    chainId: 5042002,
    builderRegistry: c?.BuilderRegistry,
    caretakerRegistry: c?.CaretakerRegistry,
    operator: extras.operator,
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
  log();

  const records = await readBuilderRecords(client as unknown as RegistryReader, {
    builderRegistry, caretakerRegistry, operator, chainId, proofConfig, fetchJson,
  });
  log(`builders (${records.length}):`);
  for (const r of records) {
    const why = r.proofError ? ` — ${r.proofError}` : "";
    log(`  #${r.builderId} ${r.status.padEnd(10)} ${r.owner} ${r.source ?? r.profileURI}${why}`);
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
    registrations.push({ source, builder, existingId });
  }

  const plan = planOnboarding({ records, registrations, builderRegistry, caretakerRegistry, operator });
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
