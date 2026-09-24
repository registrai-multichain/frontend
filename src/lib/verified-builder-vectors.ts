/**
 * Builds the shared verified-builders test vectors (see
 * scripts/gen-verified-builder-vectors.ts). Kept in src/lib so the test can
 * rebuild them and fail on drift. Test-support only — never imported by the app.
 */
import { privateKeyToAccount } from "viem/accounts";
import { parseSignature, serializeCompactSignature, signatureToCompactSignature, type Hex } from "viem";
import {
  builderStatus,
  canonicalClaimMessage,
  createDeployAddress,
  normalizeSource,
  parseProofText,
  proofUrl,
  validateProof,
  type Claim,
  type ProofFetchConfig,
} from "./verified-builders";

/**
 * A number the fixture must carry as a literal JSON can only spell in text
 * (`1.0`, `5042002.0`): JSON.stringify would print `1`. serializeVectors
 * writes the literal; parseProofText (TS) and Python's json read it back as a
 * float. Only inside proof files.
 */
const RAW_NUMBER = "__raw_json_number__:";
const rawNumber = (literal: string) => `${RAW_NUMBER}${literal}`;

/** The fixture file's exact text (what scripts/gen-verified-builder-vectors.ts writes). */
export function serializeVectors(v: unknown): string {
  return `${JSON.stringify(v, null, 2).replace(new RegExp(`"${RAW_NUMBER}(-?[0-9.eE+-]+)"`, "g"), "$1")}\n`;
}

/** A proof file exactly as its JSON text reads (raw numbers included). */
const asFetched = (file: unknown) => parseProofText(JSON.stringify(file).replace(new RegExp(`"${RAW_NUMBER}(-?[0-9.eE+-]+)"`, "g"), "$1"));

/** The 64-byte EIP-2098 form of a 65-byte signature. */
const compact = (sig: Hex): Hex => serializeCompactSignature(signatureToCompactSignature(parseSignature(sig)));

/** Anvil's first two dev keys — public, test-only. */
export const DEV_KEYS = {
  anvil0: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  anvil1: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
} as const satisfies Record<string, Hex>;

const A0 = privateKeyToAccount(DEV_KEYS.anvil0);
const A1 = privateKeyToAccount(DEV_KEYS.anvil1);
const TESTNET = 5042002;

type Ctx = { expectedSource: string; onchainOwner: string; chainId: number };

async function signed(claim: Claim, signers: { builder: typeof A0; deployers: (typeof A0)[] }) {
  const message = canonicalClaimMessage(claim);
  const deployers: Record<string, Hex> = {};
  for (const d of signers.deployers) deployers[d.address.toLowerCase()] = await d.signMessage({ message });
  return {
    version: 1,
    claim,
    signatures: { builder: await signers.builder.signMessage({ message }), deployers },
  };
}

export async function buildVerifiedBuilderVectors() {
  const gh: Claim = {
    builder: A0.address.toLowerCase(),
    source: "github:registrai-multichain/oracle-primitives",
    deployers: [],
    country: "PL",
    chain: TESTNET,
    issued: "2026-09-24",
  };
  const dom: Claim = {
    builder: A0.address.toLowerCase(),
    source: "domain:app.example.org",
    // Unsorted and checksummed on purpose: the message sorts and lowercases.
    deployers: [A1.address, A0.address],
    country: "DE",
    chain: TESTNET,
    issued: "2026-09-24",
  };
  const dom1: Claim = { ...dom, builder: A1.address.toLowerCase(), deployers: [A0.address.toLowerCase()], country: "US" };

  const ghFile = await signed(gh, { builder: A0, deployers: [] });
  const domFile = await signed(dom, { builder: A0, deployers: [A1] });
  const dom1File = await signed(dom1, { builder: A1, deployers: [A0] });

  const ghCtx: Ctx = { expectedSource: gh.source, onchainOwner: A0.address, chainId: TESTNET };
  const domCtx: Ctx = { expectedSource: dom.source, onchainOwner: A0.address, chainId: TESTNET };
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

  const proofCases: { id?: string; name: string; file: unknown; context: Ctx }[] = [
    { name: "valid github claim", file: ghFile, context: ghCtx },
    {
      name: "valid github claim with a checksummed builder address in the file",
      file: { ...clone(ghFile), claim: { ...gh, builder: A0.address } },
      context: ghCtx,
    },
    { name: "valid domain claim: builder is also a deployer, second deployer signed", file: domFile, context: domCtx },
    {
      name: "valid domain claim: other builder, one deployer signed",
      file: dom1File,
      context: { ...domCtx, onchainOwner: A1.address },
    },
    {
      name: "valid domain claim with no deployers",
      file: await signed({ ...dom, deployers: [] }, { builder: A0, deployers: [] }),
      context: domCtx,
    },
    { name: "malformed: not an object", file: "nope", context: ghCtx },
    { name: "malformed: claim missing", file: { version: 1, signatures: ghFile.signatures }, context: ghCtx },
    {
      name: "malformed: chain is a string",
      file: { ...clone(ghFile), claim: { ...gh, chain: String(TESTNET) } },
      context: ghCtx,
    },
    {
      name: "malformed: deployer is not an address",
      file: { ...clone(domFile), claim: { ...dom, deployers: ["0x1234"] } },
      context: domCtx,
    },
    { name: "rule 1: version 2", file: { ...clone(ghFile), version: 2 }, context: ghCtx },
    { name: "rule 1: version true is not 1", file: { ...clone(ghFile), version: true }, context: ghCtx },
    {
      name: "rule 1: lowercase country (signed as such)",
      file: await signed({ ...gh, country: "pl" }, { builder: A0, deployers: [] }),
      context: ghCtx,
    },
    {
      name: "rule 1: claim for another chain (signed as such)",
      file: await signed({ ...gh, chain: 5042 }, { builder: A0, deployers: [] }),
      context: ghCtx,
    },
    {
      name: "rule 2: source mismatch (profile names another repo)",
      file: ghFile,
      context: { ...ghCtx, expectedSource: "github:someone/else" },
    },
    {
      name: "rule 2: source not lowercased in the file",
      file: await signed({ ...gh, source: "github:Registrai-Multichain/oracle-primitives" }, { builder: A0, deployers: [] }),
      context: ghCtx,
    },
    {
      name: "rule 3: forged builder signature (signed by another key)",
      file: await signed(gh, { builder: A1, deployers: [] }),
      context: ghCtx,
    },
    {
      name: "rule 3: claim edited after signing",
      file: { ...clone(ghFile), claim: { ...gh, country: "FR" } },
      context: ghCtx,
    },
    {
      name: "rule 3: garbage signature",
      file: { ...clone(ghFile), signatures: { builder: "0xdeadbeef", deployers: {} } },
      context: ghCtx,
    },
    { name: "rule 4: wrong wallet (on-chain owner is someone else)", file: ghFile, context: { ...ghCtx, onchainOwner: A1.address } },
    {
      name: "rule 5: github claim with deployers",
      file: await signed({ ...gh, deployers: [A1.address.toLowerCase()] }, { builder: A0, deployers: [A1] }),
      context: ghCtx,
    },
    {
      name: "rule 5: deployer did not sign",
      file: await signed(dom, { builder: A0, deployers: [] }),
      context: domCtx,
    },
    {
      name: "rule 5: deployer signature made by the builder key (someone else's deployer)",
      file: {
        ...clone(domFile),
        signatures: {
          builder: domFile.signatures.builder,
          deployers: { [A1.address.toLowerCase()]: await A0.signMessage({ message: canonicalClaimMessage(dom) }) },
        },
      },
      context: domCtx,
    },
  ];

  // TS <-> keeper alignment (2026-09-25): integers, 65-byte signatures,
  // signatures.deployers always an object. Each case has a stable `id`.
  const withoutDeployerSigs = clone(ghFile) as { signatures: Record<string, unknown> };
  delete withoutDeployerSigs.signatures.deployers;
  proofCases.push(
    {
      id: "version-float",
      name: "rule 1: version 1.0 is a JSON float, not the integer 1",
      file: { ...clone(ghFile), version: rawNumber("1.0") },
      context: ghCtx,
    },
    { id: "version-string", name: "rule 1: version \"1\" is a string", file: { ...clone(ghFile), version: "1" }, context: ghCtx },
    {
      id: "chain-float",
      name: "malformed: chain 5042002.0 is a JSON float",
      file: { ...clone(ghFile), claim: { ...gh, chain: rawNumber(`${TESTNET}.0`) } },
      context: ghCtx,
    },
    {
      id: "chain-negative",
      name: "malformed: chain is negative (signed as such)",
      file: await signed({ ...gh, chain: -TESTNET }, { builder: A0, deployers: [] }),
      context: ghCtx,
    },
    {
      id: "builder-sig-compact",
      name: "rule 3: builder signature in the 64-byte EIP-2098 compact form",
      file: { ...clone(ghFile), signatures: { builder: compact(ghFile.signatures.builder), deployers: {} } },
      context: ghCtx,
    },
    {
      id: "deployer-sig-compact",
      name: "rule 5: deployer signature in the 64-byte EIP-2098 compact form",
      file: {
        ...clone(domFile),
        signatures: {
          builder: domFile.signatures.builder,
          deployers: { [A1.address.toLowerCase()]: compact(domFile.signatures.deployers[A1.address.toLowerCase()]) },
        },
      },
      context: domCtx,
    },
    { id: "deployer-sigs-missing", name: "malformed: signatures.deployers is missing", file: withoutDeployerSigs, context: ghCtx },
    {
      id: "deployer-sigs-array",
      name: "malformed: signatures.deployers is an array",
      file: { ...clone(ghFile), signatures: { builder: ghFile.signatures.builder, deployers: [] } },
      context: ghCtx,
    },
    { id: "deployer-sigs-empty", name: "valid github claim: signatures.deployers is an empty object", file: ghFile, context: ghCtx },
  );

  const proofs = [];
  for (const c of proofCases) {
    const r = await validateProof(asFetched(c.file), c.context);
    proofs.push({ ...c, expect: r.valid ? { valid: true, rule: null } : { valid: false, rule: r.rule } });
  }

  const sourceInputs = [
    "https://github.com/Registrai-Multichain/Oracle-Primitives",
    "https://github.com/owner/repo.git",
    "http://www.github.com/owner/repo/tree/main/src?x=1#readme",
    "github.com/owner/repo",
    "Owner/Repo",
    "github:Owner/Repo",
    "  owner/my.repo_name-1  ",
    "https://github.com/owner",
    "owner/repo/extra",
    "owner//repo",
    "owner/repo/",
    "-bad/repo",
    "https://App.Example.org:8443/path?q=1",
    "app.example.org",
    "app.example.org/some/page",
    "domain:App.Example.ORG",
    "domain:app.example.org:443",
    "http://localhost:8080/.well-known/registrai.json",
    "127.0.0.1",
    "10.0.0.1",
    "ftp://example.org",
    "https://user@example.org",
    "example",
    "",
  ];
  const sources = sourceInputs.map((input) => ({ input, expected: normalizeSource(input) }));

  const urlCases: { source: string; config: ProofFetchConfig }[] = [
    { source: "github:owner/repo", config: {} },
    { source: "github:owner/repo", config: { githubBase: "http://127.0.0.1:8081/" } },
    { source: "domain:app.example.org", config: {} },
    { source: "domain:app.example.org", config: { domainScheme: "http" } },
    { source: "domain:127.0.0.1", config: { domainScheme: "http" } },
    { source: "domain:localhost", config: { domainScheme: "http" } },
    { source: "github:Owner/Repo", config: {} },
  ];
  const proofUrls = urlCases.map((c) => {
    try {
      return { ...c, url: proofUrl(c.source, c.config) };
    } catch {
      return { ...c, url: null };
    }
  });

  // Builder status over its projects (spec 2026-09-24-builder-projects-design.md).
  const V = { status: "verified" as const };
  const L = { status: "lapsed" as const };
  const I = { status: "inactive" as const };
  const statusInputs = [
    { active: true, projects: [V], caretakerIsOperator: false },
    { active: true, projects: [V], caretakerIsOperator: true },
    { active: true, projects: [L, V], caretakerIsOperator: true },
    { active: true, projects: [L, V], caretakerIsOperator: false },
    { active: true, projects: [L], caretakerIsOperator: true },
    { active: true, projects: [L, I], caretakerIsOperator: false },
    { active: true, projects: [I], caretakerIsOperator: true },
    { active: true, projects: [], caretakerIsOperator: true },
    { active: false, projects: [V], caretakerIsOperator: true },
  ];
  const status = statusInputs.map((input) => ({ input, expected: builderStatus(input) }));

  // Anvil's well-known first deployments from its dev account, plus RLP
  // boundary nonces (1-byte, 0x80 prefix, 2- and 3-byte integers).
  const createAddresses = [0, 1, 2, 127, 128, 255, 256, 65535, 65536, 16777216].flatMap((nonce) =>
    [A0.address, A1.address].map((deployer) => ({ deployer, nonce, address: createDeployAddress(deployer, nonce) })),
  );

  return {
    version: 1,
    note:
      "Shared vectors for docs/superpowers/specs/2026-09-24-verified-builders-design.md. " +
      "Generated by frontend/scripts/gen-verified-builder-vectors.ts from anvil's public dev keys. " +
      "messages[].message is the exact EIP-191 payload (\\n-joined, no trailing newline). " +
      "proofs[].expect.rule: null when valid, 0 when the file is not a well-formed v1 file, else the first failing spec rule (1-5). " +
      "proofs[].file is the proof exactly as served: read it with a JSON parser that keeps floats (a `1.0` is not the integer 1). " +
      "version and claim.chain must be JSON integers (chain >= 0); signatures are 65-byte hex (64-byte EIP-2098 compact is refused); " +
      "signatures.deployers must be an object (it may be empty). " +
      "sources[].expected / proofUrls[].url: null means rejected. createAddresses: CREATE address of (deployer, nonce).",
    keys: Object.entries(DEV_KEYS).map(([name, privateKey]) => ({
      name,
      privateKey,
      address: privateKeyToAccount(privateKey).address,
    })),
    messages: [
      { name: "github", claim: gh, message: canonicalClaimMessage(gh) },
      { name: "domain, unsorted checksummed deployers", claim: dom, message: canonicalClaimMessage(dom) },
      { name: "domain, other builder", claim: dom1, message: canonicalClaimMessage(dom1) },
    ],
    sources,
    proofUrls,
    proofs,
    status,
    createAddresses,
  };
}
