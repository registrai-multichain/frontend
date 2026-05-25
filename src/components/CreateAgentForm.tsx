"use client";

import { useEffect, useMemo, useState } from "react";
import { keccak256, maxUint256, parseUnits, stringToHex, type Hex } from "viem";
import { useWallet } from "./WalletProvider";
import { CONTRACTS, txUrl, addrUrl } from "@/lib/chain";
import { registryAbi, usdcAbi, agentIdentityAbi } from "@/lib/abi";
import { humanizeError } from "@/lib/humanize-error";
import {
  methodologyLocalKey,
  postFeedMethodology,
} from "@/lib/hooks/useFeedMethodology";
import { FaucetHint } from "./FaucetHint";
import { MethodologyLive } from "./MethodologyLive";

type Status =
  | "idle"
  | "approving"
  | "creating-feed"
  | "registering"
  | "success"
  | "error";

type RuleChoice = "none" | "median" | "trim10" | "custom";

const MIN_BOND_USDC = 10;
const MIN_DISPUTE_WINDOW_HOURS = 1;

// Starter scaffold shown in the methodology textarea. We refuse submission
// if the user hits register without editing it — otherwise the feed would
// be registered with literal placeholder text as its committed methodology.
const METHODOLOGY_TEMPLATE = `Sources
  - [list each public source you aggregate]

Aggregation
  - [median / trimmed mean / custom — how you derive the value]

Cadence
  - [how often you attest, e.g., daily at 14:00 UTC]

Quality controls
  - [outlier handling, fallback rules, anything that prevents bad attestations]`;

export function CreateAgentForm() {
  const {
    address,
    isOnSupportedChain,
    walletClient,
    publicClient,
    connect,
    switchChain,
  } = useWallet();

  // v2: feed creator and agent are the same wallet. One flow only — define a
  // feed and register as its agent in the same session. The old "join an
  // existing feed" mode is gone; the v2 Registry would revert anyway.
  const [feedDescription, setFeedDescription] = useState("");
  // Starter template — users overwrite each section instead of pinning a
  // markdown doc to IPFS just to claim a hash. The full text is hashed into
  // the feed identity and (separately, post-register) persisted to the
  // worker KV so anyone can read it from the feed page.
  const [methodologyText, setMethodologyText] = useState(
    METHODOLOGY_TEMPLATE,
  );
  const [disputeHours, setDisputeHours] = useState("24");

  // Bond
  const [bondUsdcStr, setBondUsdcStr] = useState(String(MIN_BOND_USDC));

  // Identity (optional global profile, written to AgentIdentity contract).
  const [identityName, setIdentityName] = useState("");
  const [identityDesc, setIdentityDesc] = useState("");
  const [identityUrl, setIdentityUrl] = useState("");
  const [identityContact, setIdentityContact] = useState("");

  // Rule choice
  const [ruleChoice, setRuleChoice] = useState<RuleChoice>("none");
  const [customRuleAddr, setCustomRuleAddr] = useState("");
  const ruleAddress = useMemo<`0x${string}` | undefined>(() => {
    if (ruleChoice === "median") return CONTRACTS.MedianRule;
    if (ruleChoice === "trim10") return CONTRACTS.TrimmedMeanRule10;
    if (ruleChoice === "custom") {
      if (customRuleAddr.length === 42 && customRuleAddr.startsWith("0x")) {
        return customRuleAddr as `0x${string}`;
      }
      return undefined;
    }
    return undefined;
  }, [ruleChoice, customRuleAddr]);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | undefined>();
  const [feedId, setFeedId] = useState<Hex | undefined>();
  const [registerTx, setRegisterTx] = useState<Hex | undefined>();
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n);

  const bondWei = useMemo(() => {
    const v = Number(bondUsdcStr);
    if (!Number.isFinite(v) || v < MIN_BOND_USDC) return 0n;
    return parseUnits(String(v), 6);
  }, [bondUsdcStr]);

  const disputeWindowSec = useMemo(() => {
    const h = Number(disputeHours);
    if (!Number.isFinite(h) || h < MIN_DISPUTE_WINDOW_HOURS) return 0n;
    return BigInt(Math.floor(h * 3600));
  }, [disputeHours]);

  const methodologyHash = useMemo(
    () => keccak256(stringToHex(methodologyText || "")),
    [methodologyText],
  );

  // Refresh USDC balance.
  useEffect(() => {
    if (!address) return;
    publicClient
      .readContract({
        address: CONTRACTS.USDC,
        abi: usdcAbi,
        functionName: "balanceOf",
        args: [address],
      })
      .then((b) => setUsdcBalance(b as bigint))
      .catch(() => setUsdcBalance(0n));
  }, [address, publicClient, status]);

  const ruleValid = ruleChoice === "none" || !!ruleAddress;
  const canSubmit =
    address &&
    isOnSupportedChain &&
    bondWei > 0n &&
    usdcBalance >= bondWei &&
    ruleValid &&
    feedDescription.trim().length > 5 &&
    methodologyText.trim().length > 20 &&
    methodologyText.trim() !== METHODOLOGY_TEMPLATE.trim() &&
    disputeWindowSec > 0n;

  const submit = async () => {
    if (!walletClient || !address || !canSubmit) return;
    setError(undefined);
    try {
      // v2 is the current write target — enforces feed-creator-must-be-agent
      // and awards points on registration. Falls back to v1.1 (rule-bound)
      // or v1.0 (plain) only if v2 isn't configured on this chain.
      const targetRegistry =
        CONTRACTS.RegistryV2 ??
        (ruleAddress && CONTRACTS.RegistryV11
          ? CONTRACTS.RegistryV11
          : CONTRACTS.Registry);
      if (ruleAddress && !CONTRACTS.RegistryV2 && !CONTRACTS.RegistryV11) {
        throw new Error("Rule-bound registration requires Registry v2 or v1.1, not configured on this chain.");
      }

      // 1. Approve bond to whichever Registry will pull it.
      setStatus("approving");
      const allowance = (await publicClient.readContract({
        address: CONTRACTS.USDC,
        abi: usdcAbi,
        functionName: "allowance",
        args: [address, targetRegistry],
      })) as bigint;
      if (allowance < bondWei) {
        // Approve max so subsequent feed/agent creations don't require a
        // fresh approve popup. Standard DeFi pattern (Uniswap / Polymarket).
        const approveHash = await walletClient.writeContract({
          address: CONTRACTS.USDC,
          abi: usdcAbi,
          functionName: "approve",
          args: [targetRegistry, maxUint256],
          chain: walletClient.chain,
          account: walletClient.account!,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      // 2. Create the feed. Same wallet will register as agent in step 3.
      // Explicit gas: Arc's USDC blocklist precompile breaks local simulation,
      // so wallet estimates can under-budget the points sub-call. 500k is a
      // safe upper bound for createFeed (real cost ~200k).
      setStatus("creating-feed");
      const createHash = await walletClient.writeContract({
        address: targetRegistry,
        abi: registryAbi,
        functionName: "createFeed",
        args: [
          feedDescription,
          methodologyHash,
          bondWei,
          disputeWindowSec,
          address,
        ],
        chain: walletClient.chain,
        account: walletClient.account!,
        gas: 500_000n,
      });
      const r = await publicClient.waitForTransactionReceipt({
        hash: createHash,
      });
      // FeedCreated(bytes32 indexed feedId, ...) — pick the Registry-emitted log.
      const log = r.logs.find(
        (l) => l.address.toLowerCase() === targetRegistry.toLowerCase(),
      );
      if (!log) throw new Error("FeedCreated event not found");
      const resolvedFeedId = log.topics[1]! as Hex;
      setFeedId(resolvedFeedId);

      // 3. Register as agent — rule-bound path if a rule was picked.
      setStatus("registering");
      const regHash = ruleAddress
        ? await walletClient.writeContract({
            address: targetRegistry,
            abi: registryAbi,
            functionName: "registerAgentWithRule",
            args: [resolvedFeedId, methodologyHash, bondWei, ruleAddress],
            chain: walletClient.chain,
            account: walletClient.account!,
            gas: 500_000n,
          })
        : await walletClient.writeContract({
            address: targetRegistry,
            abi: registryAbi,
            functionName: "registerAgent",
            args: [resolvedFeedId, methodologyHash, bondWei],
            chain: walletClient.chain,
            account: walletClient.account!,
            gas: 500_000n,
          });
      await publicClient.waitForTransactionReceipt({ hash: regHash });
      setRegisterTx(regHash);

      // Save the methodology text locally before attempting the worker
      // upload. If the signature is rejected, worker is down, or the user
      // closes the tab, the next visit to /feed/{feedId} can detect the
      // unsaved text (via localStorage) and offer a "publish methodology"
      // retry button. Cleared once the worker write confirms.
      try {
        localStorage.setItem(
          methodologyLocalKey(resolvedFeedId),
          methodologyText,
        );
      } catch {
        /* private mode / quota — non-fatal */
      }

      // Persist the methodology text to the Worker so anyone can read the
      // spec from /feed/{feedId}. Signature-gated by the feed creator;
      // failure here doesn't undo the registration (the hash is already
      // on chain). Awaited so its signature popup resolves BEFORE the
      // optional identity tx popup — otherwise the two pop in arbitrary
      // order and confuse the user.
      if (walletClient.account) {
        const account = walletClient.account;
        try {
          const r = await postFeedMethodology({
            feedId: resolvedFeedId,
            methodology: methodologyText,
            signMessage: (message) => walletClient.signMessage({ account, message }),
          });
          if (r.ok) {
            // Worker has it — clean up the local retry copy.
            try {
              localStorage.removeItem(methodologyLocalKey(resolvedFeedId));
            } catch {
              /* ignore */
            }
          } else {
            console.warn("methodology not persisted:", r.error);
          }
        } catch (e) {
          // Signature rejected or worker unreachable — local retry copy
          // remains so /feed/{feedId} can offer a publish button.
          console.warn("methodology save threw:", (e as Error).message);
        }
      }

      // Best-effort: if the user filled in an identity profile and
      // AgentIdentity is deployed on this chain, write it. Skipped silently
      // if the user cancels the signature — agent registration is the
      // critical step, identity is enhancement.
      if (identityName.trim().length > 0 && CONTRACTS.AgentIdentity) {
        try {
          const idHash = await walletClient.writeContract({
            address: CONTRACTS.AgentIdentity,
            abi: agentIdentityAbi,
            functionName: "setProfile",
            args: [identityName.trim(), identityDesc.trim(), identityUrl.trim(), identityContact.trim()],
            chain: walletClient.chain,
            account: walletClient.account!,
          });
          await publicClient.waitForTransactionReceipt({ hash: idHash });
        } catch (e) {
          console.warn("AgentIdentity.setProfile failed (non-fatal):", e);
        }
      }

      // Hand off the freshly-registered feed to /markets/create so the user
      // doesn't have to dig around for "paste custom feedId" — the form
      // auto-selects this feed if it sees a fresh entry in localStorage.
      try {
        localStorage.setItem(
          "registrai:last-feed",
          JSON.stringify({
            feedId: resolvedFeedId,
            ruleAddress: ruleAddress ?? null,
            description: feedDescription,
            createdAt: Date.now(),
          }),
        );
      } catch {
        /* ignore quota / private-mode errors */
      }

      setStatus("success");
    } catch (e) {
      setStatus("error");
      setError(humanizeError(e));
    }
  };

  if (status === "success") {
    return (
      <SuccessPanel
        feedId={feedId!}
        agent={address!}
        tx={registerTx!}
        rule={ruleAddress}
        methodologyText={methodologyText}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10">
      {/* LEFT — inputs */}
      <div className="space-y-8">
        <FaucetHint />

        {/* Intro */}
        <div>
          <label className="caption mb-3 block">define your oracle</label>
          <p className="text-2xs text-fg-dim leading-relaxed max-w-[60ch]">
            You define a new data feed (London rents, OPEC output, your local CPI)
            and register as its agent in the same session. Feed creator and agent
            are the same wallet — one accountable party owns the spec and the
            data.
          </p>
        </div>

        {/* Feed inputs */}
        <div className="space-y-5">
          <Field
            label="feed description"
            hint="One line. Becomes the public name (e.g. 'London average residential price per sqm, monthly')."
          >
            <input
              type="text"
              value={feedDescription}
              onChange={(e) => setFeedDescription(e.target.value)}
              placeholder="e.g. PLN per USD reference rate, daily NBP fix"
              className="w-full bg-bg border border-line px-3 py-2 text-[14px] focus:outline-none focus:border-accent"
            />
          </Field>

          <Field
            label="methodology"
            hint="Sources, math, cadence, controls. Hashed into the feed identity onchain and saved verbatim to the worker so anyone can read it from your feed page. The starter template is a guide — overwrite each section with your specifics."
          >
            <textarea
              value={methodologyText}
              onChange={(e) => setMethodologyText(e.target.value)}
              rows={9}
              // Lock during tx submission so the user can't edit the text
              // mid-flight — the onchain hash is already computed from the
              // text at submit time, and edits would cause the worker's
              // methodology-save signature check to mismatch.
              disabled={status !== "idle" && status !== "error"}
              className="w-full bg-bg border border-line px-3 py-2 text-[13px] leading-relaxed focus:outline-none focus:border-accent font-mono resize-y disabled:opacity-60 disabled:cursor-not-allowed"
            />
            {methodologyText.trim() === METHODOLOGY_TEMPLATE.trim() && (
              <p className="text-2xs text-down mt-1.5">
                ⚠ replace each <code className="text-fg-mute">[…]</code> placeholder
                with your actual sources, math, cadence, and controls — these
                will be hashed onchain and shown on your feed page.
              </p>
            )}
            <div className="text-2xs text-fg-dim mt-1.5 flex justify-between gap-3 flex-wrap">
              <span className="tnum break-all">hash · {methodologyHash}</span>
              <span>{methodologyText.length} chars</span>
            </div>
          </Field>

          <Field
            label="dispute window · hours"
            hint="Time after each attestation before it finalizes onchain. Longer = safer for traders, slower for resolution. Min 1h."
          >
            <input
              type="number"
              min={MIN_DISPUTE_WINDOW_HOURS}
              step={1}
              value={disputeHours}
              onChange={(e) => setDisputeHours(e.target.value)}
              className="w-full bg-bg border border-line px-3 py-2 text-[14px] tnum focus:outline-none focus:border-accent"
            />
          </Field>
        </div>

        {/* Rule — onchain verifiability tier */}
        <div>
          <label className="caption mb-2 block">aggregation rule</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-line">
            <RuleOption
              active={ruleChoice === "none"}
              onClick={() => setRuleChoice("none")}
              title="none"
              tagline="trust the agent's posted value"
              hint="Existing flow. Off-chain code computes the value, agent EOA posts it. Slashable via dispute if wrong."
            />
            <RuleOption
              active={ruleChoice === "median"}
              onClick={() => setRuleChoice("median")}
              title="Median"
              tagline="verifiable · stateless"
              hint="Agent submits raw int256[] inputs; contract returns the median. Methodology = bytecode."
              disabled={!CONTRACTS.MedianRule}
            />
            <RuleOption
              active={ruleChoice === "trim10"}
              onClick={() => setRuleChoice("trim10")}
              title="Trimmed Mean 10%"
              tagline="verifiable · robust"
              hint="Sorts inputs, drops 10% from each tail, returns the mean of the middle. Resistant to single-point outliers."
              disabled={!CONTRACTS.TrimmedMeanRule10}
            />
            <RuleOption
              active={ruleChoice === "custom"}
              onClick={() => setRuleChoice("custom")}
              title="Custom rule"
              tagline="advanced · BYO contract"
              hint="Paste any address implementing IAgentRule.submit(int256[]) returns (int256)."
            />
          </div>
          {ruleChoice === "custom" && (
            <input
              type="text"
              value={customRuleAddr}
              onChange={(e) => setCustomRuleAddr(e.target.value)}
              placeholder="0x… IAgentRule contract address"
              className="w-full mt-3 bg-bg border border-line px-3 py-2 text-[13px] tnum focus:outline-none focus:border-accent break-all"
            />
          )}
          {ruleAddress && ruleChoice !== "none" && (
            <div className="text-2xs text-fg-dim mt-2 tnum break-all">
              binds to · {ruleAddress}
            </div>
          )}
        </div>

        {/* Bond */}
        <Field
          label="bond · USDC"
          hint={`Locked as slashable collateral against your attestations. Minimum ${MIN_BOND_USDC} USDC. Withdrawable after a 7-day cooldown if you exit and no dispute is pending.`}
        >
          <input
            type="number"
            min={MIN_BOND_USDC}
            step={1}
            value={bondUsdcStr}
            onChange={(e) => setBondUsdcStr(e.target.value)}
            className="w-full bg-bg border border-line px-3 py-2 text-[14px] tnum focus:outline-none focus:border-accent"
          />
          {address && (
            <div className="text-2xs text-fg-dim mt-1.5 tnum">
              wallet · {(Number(usdcBalance) / 1e6).toFixed(2)} USDC
            </div>
          )}
        </Field>

        {/* Identity — optional global profile (AgentIdentity contract) */}
        {CONTRACTS.AgentIdentity && (
          <div className="border-t border-line pt-6 space-y-5">
            <div>
              <label className="caption mb-2 block">identity · optional</label>
              <p className="text-2xs text-fg-dim leading-relaxed max-w-[58ch]">
                A public profile, written to the global{" "}
                <a
                  href={`https://testnet.arcscan.app/address/${CONTRACTS.AgentIdentity}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline tnum"
                >
                  AgentIdentity
                </a>{" "}
                contract — keyed by your address, mutable by you. Browsable on{" "}
                <a href="/agents" className="text-accent hover:underline">/agents</a>.
                Skip if you want; you can set it any time later.
              </p>
            </div>
            <Field label="display name" hint="Shown next to your address everywhere on the site. Max 64 chars.">
              <input
                type="text"
                value={identityName}
                onChange={(e) => setIdentityName(e.target.value)}
                maxLength={64}
                placeholder="e.g. London Resi Watcher"
                className="w-full bg-bg border border-line px-3 py-2 text-[14px] focus:outline-none focus:border-accent"
              />
            </Field>
            <Field
              label="short description"
              hint="One sentence describing what you attest and why anyone should trust you. Max 512 chars."
            >
              <textarea
                value={identityDesc}
                onChange={(e) => setIdentityDesc(e.target.value)}
                maxLength={512}
                rows={2}
                placeholder="e.g. Scrapes Zoopla + Rightmove daily and posts a trimmed median for inner-London zone 1-2 rentals."
                className="w-full bg-bg border border-line px-3 py-2 text-[13.5px] focus:outline-none focus:border-accent resize-y"
              />
            </Field>
            <Field label="url · optional" hint="Methodology doc, agent code, website, or GitHub.">
              <input
                type="text"
                value={identityUrl}
                onChange={(e) => setIdentityUrl(e.target.value)}
                maxLength={512}
                placeholder="https://…"
                className="w-full bg-bg border border-line px-3 py-2 text-[14px] focus:outline-none focus:border-accent"
              />
            </Field>
            <Field label="contact · optional" hint="X handle, telegram, email — for traders / market creators to reach you.">
              <input
                type="text"
                value={identityContact}
                onChange={(e) => setIdentityContact(e.target.value)}
                maxLength={512}
                placeholder="@handle"
                className="w-full bg-bg border border-line px-3 py-2 text-[14px] focus:outline-none focus:border-accent"
              />
            </Field>
            <div className="text-2xs text-fg-dim">
              {identityName.trim().length > 0
                ? "an extra wallet signature will be requested after the agent-register tx confirms"
                : "skip if blank — you can set this anytime later from /agents/create"}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT — sticky submit */}
      <aside className="lg:sticky lg:top-24 h-fit border border-line p-5 bg-bg-elev/40">
        <div className="caption text-fg-dim mb-4">register</div>

        <Row label="role" value="onchain oracle agent" />
        <Row label="bond" value={`${bondUsdcStr || "—"} USDC`} />
        <Row
          label="feed"
          value={
            feedDescription.length > 0
              ? `“${feedDescription.slice(0, 24)}${feedDescription.length > 24 ? "…" : ""}”`
              : "(your new feed)"
          }
        />
        <Row label="signatures" value="approve · createFeed · register" />
        <Row label="reward" value="+1000 pts on register" />

        <div className="mt-5">
          {!address ? (
            <button
              onClick={() => connect().catch(() => {})}
              className="w-full bg-accent text-bg py-2 caption hover:bg-accent/90 transition-colors"
            >
              connect wallet
            </button>
          ) : !isOnSupportedChain ? (
            <button
              onClick={() => switchChain().catch(() => {})}
              className="w-full bg-accent text-bg py-2 caption hover:bg-accent/90 transition-colors"
            >
              switch to Arc
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={
                !canSubmit ||
                status === "approving" ||
                status === "creating-feed" ||
                status === "registering"
              }
              className="w-full bg-accent text-bg py-2 caption hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {status === "approving"
                ? "approving bond…"
                : status === "creating-feed"
                  ? "creating feed…"
                  : status === "registering"
                    ? "registering agent…"
                    : "register as agent"}
            </button>
          )}
        </div>

        {status === "error" && error && (
          <div className="mt-3 text-2xs text-down break-all">{error}</div>
        )}

        {address && usdcBalance < bondWei && bondWei > 0n && (
          <div className="mt-3 text-2xs text-down">
            insufficient USDC for bond
          </div>
        )}
      </aside>
    </div>
  );
}

function RuleOption({
  title,
  tagline,
  hint,
  active,
  disabled,
  onClick,
}: {
  title: string;
  tagline: string;
  hint: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-left p-4 transition-colors ${
        active ? "bg-bg-elev/60 ring-1 ring-accent" : "bg-bg-elev/30 hover:bg-bg-elev/50"
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      <div className="flex items-baseline justify-between mb-1">
        <span className="caption text-fg">{title}</span>
        <span className="text-2xs caption text-fg-dim">{tagline}</span>
      </div>
      <p className="text-2xs text-fg-mute leading-relaxed">{hint}</p>
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="caption mb-2 block">{label}</label>
      {children}
      {hint && (
        <p className="text-2xs text-fg-dim mt-1.5 leading-relaxed max-w-[58ch]">
          {hint}
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between text-[13px] py-1.5 border-b border-line/60 last:border-0">
      <span className="caption text-fg-dim">{label}</span>
      <span className="text-fg tnum text-right max-w-[60%] truncate">
        {value}
      </span>
    </div>
  );
}

function SuccessPanel({
  feedId,
  agent,
  tx,
  rule,
  methodologyText,
}: {
  feedId: Hex;
  agent: string;
  tx: Hex;
  rule?: `0x${string}`;
  methodologyText: string;
}) {
  // The SDK's preflight checks `keccak256(methodologyCid)` against the
  // onchain methodologyHash, so this string must match the text you just
  // registered. We inject it directly into the snippet via a template
  // literal so copy/paste works without surprises.
  const snippet = rule
    ? `import { defineAgent } from "@registrai/agent-sdk";

const METHODOLOGY = \`${methodologyText.replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\`;

const agent = defineAgent({
  name: "my-agent",
  schedule: "0 14 * * *",
  feedId: "${feedId}",
  registryAddress: "${CONTRACTS.RegistryV2 ?? CONTRACTS.RegistryV11 ?? CONTRACTS.Registry}",      // v2
  attestationAddress: "${CONTRACTS.AttestationV2 ?? CONTRACTS.AttestationV11 ?? CONTRACTS.Attestation}", // v2
  methodologyCid: METHODOLOGY, // exact text hashed at registration
  rule: "${rule}", // verifiable bytecode
  run: async () => {
    // Fetch your data. Return ONLY the raw int256[] vector.
    // The onchain rule contract computes the final value.
    return { rawInputs: [/* your int256 values */] };
  },
});

await agent.attest({
  privateKey: process.env.PRIVATE_KEY as \`0x\${string}\`,
  rpcUrl: process.env.RPC_URL!,
});`
    : `import { defineAgent } from "@registrai/agent-sdk";

const METHODOLOGY = \`${methodologyText.replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\`;

const agent = defineAgent({
  name: "my-agent",
  schedule: "0 14 * * *",
  feedId: "${feedId}",
  registryAddress: "${CONTRACTS.RegistryV2 ?? CONTRACTS.RegistryV11 ?? CONTRACTS.Registry}",      // v2
  attestationAddress: "${CONTRACTS.AttestationV2 ?? CONTRACTS.AttestationV11 ?? CONTRACTS.Attestation}", // v2
  methodologyCid: METHODOLOGY, // exact text hashed at registration
  run: async () => {
    // Fetch your data. Compute the final value off-chain.
    return { value: 0n, inputHash: "0x..." };
  },
});

await agent.attest({
  privateKey: process.env.PRIVATE_KEY as \`0x\${string}\`,
  rpcUrl: process.env.RPC_URL!,
});`;

  return (
    <div className="space-y-8 fade-up">
      <div className="border border-accent/40 bg-bg-elev/40 p-6">
        <div className="caption text-accent mb-3">registered ✓</div>
        <h2 className="font-serif text-[24px] leading-snug mb-4">
          Your agent is live onchain.
        </h2>
        <Row label="feed id" value={feedId} />
        <Row label="your agent" value={agent} />
        {rule && <Row label="rule contract" value={rule} />}
        <a
          href={txUrl(tx)}
          target="_blank"
          rel="noreferrer"
          className="block mt-4 text-2xs text-accent hover:underline tnum"
        >
          confirmation tx ↗
        </a>
      </div>

      {/* Methodology — confirms the worker has the published text. If the
          signature was skipped, renders a "publish methodology" retry
          button (reads localStorage). */}
      <div>
        <h3 className="caption mb-3">your published methodology</h3>
        <MethodologyLive feedId={feedId} creator={agent} />
      </div>

      <div>
        <h3 className="caption mb-3">next · start attesting</h3>
        <p className="text-[13px] text-fg-mute leading-relaxed mb-4 max-w-[64ch]">
          Use the SDK to wire your data source to your registered agent. Runs
          in Node, Cloudflare Workers, or Phala TEE — anywhere you can run
          TypeScript on a cron.
        </p>
        <pre className="text-[12px] leading-relaxed text-fg-mute bg-bg-elev/60 border border-line p-4 overflow-x-auto">
          <code>{snippet}</code>
        </pre>
        <div className="mt-4 flex flex-wrap gap-3 text-2xs">
          <a
            href="https://www.npmjs.com/package/@registrai/agent-sdk"
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 border border-accent/60 text-accent hover:bg-accent hover:text-bg transition-colors"
          >
            npm · @registrai/agent-sdk ↗
          </a>
          <a
            href={`https://github.com/registrai-multichain/agent`}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 border border-line text-fg-mute hover:text-fg hover:border-line-strong transition-colors"
          >
            reference agent repo ↗
          </a>
          <a
            href={addrUrl(agent)}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 border border-line text-fg-mute hover:text-fg hover:border-line-strong transition-colors tnum"
          >
            your agent on explorer ↗
          </a>
        </div>
      </div>
    </div>
  );
}
