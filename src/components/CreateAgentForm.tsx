"use client";

import { useEffect, useMemo, useState } from "react";
import { keccak256, parseUnits, stringToHex, type Hex } from "viem";
import { useWallet } from "./WalletProvider";
import { CONTRACTS, txUrl, addrUrl } from "@/lib/chain";
import { registryAbi, usdcAbi } from "@/lib/abi";
import { FaucetHint } from "./FaucetHint";

type Mode = "new-feed" | "existing-feed";
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

export function CreateAgentForm() {
  const {
    address,
    isOnSupportedChain,
    walletClient,
    publicClient,
    connect,
    switchChain,
  } = useWallet();

  const [mode, setMode] = useState<Mode>("new-feed");

  // Feed-creation inputs
  const [feedDescription, setFeedDescription] = useState("");
  const [methodologyCid, setMethodologyCid] = useState("");
  const [disputeHours, setDisputeHours] = useState("24");

  // Existing-feed inputs
  const [existingFeedId, setExistingFeedId] = useState("");

  // Bond
  const [bondUsdcStr, setBondUsdcStr] = useState(String(MIN_BOND_USDC));

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
    () => keccak256(stringToHex(methodologyCid || "")),
    [methodologyCid],
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
    (mode === "new-feed"
      ? feedDescription.trim().length > 5 &&
        methodologyCid.trim().length > 0 &&
        disputeWindowSec > 0n
      : existingFeedId.length === 66 && existingFeedId.startsWith("0x"));

  const submit = async () => {
    if (!walletClient || !address || !canSubmit) return;
    setError(undefined);
    try {
      // Rule-bound registrations target v1.1 Registry (which has
      // registerAgentWithRule). v1.0 stays for plain registrations.
      const targetRegistry =
        ruleAddress && CONTRACTS.RegistryV11
          ? CONTRACTS.RegistryV11
          : CONTRACTS.Registry;
      if (ruleAddress && !CONTRACTS.RegistryV11) {
        throw new Error("Rule-bound registration requires Registry v1.1, not configured on this chain.");
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
        const approveHash = await walletClient.writeContract({
          address: CONTRACTS.USDC,
          abi: usdcAbi,
          functionName: "approve",
          args: [targetRegistry, bondWei],
          chain: walletClient.chain,
          account: walletClient.account!,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      // 2. If creating new feed, do that first.
      let resolvedFeedId: Hex;
      if (mode === "new-feed") {
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
        });
        const r = await publicClient.waitForTransactionReceipt({
          hash: createHash,
        });
        // FeedCreated(bytes32 indexed feedId, ...) — pick the Registry-emitted log.
        const log = r.logs.find(
          (l) => l.address.toLowerCase() === targetRegistry.toLowerCase(),
        );
        if (!log) throw new Error("FeedCreated event not found");
        resolvedFeedId = log.topics[1]! as Hex;
        setFeedId(resolvedFeedId);
      } else {
        resolvedFeedId = existingFeedId as Hex;
        setFeedId(resolvedFeedId);
      }

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
          })
        : await walletClient.writeContract({
            address: targetRegistry,
            abi: registryAbi,
            functionName: "registerAgent",
            args: [resolvedFeedId, methodologyHash, bondWei],
            chain: walletClient.chain,
            account: walletClient.account!,
          });
      await publicClient.waitForTransactionReceipt({ hash: regHash });
      setRegisterTx(regHash);
      setStatus("success");
    } catch (e) {
      setStatus("error");
      setError((e as Error).message);
    }
  };

  if (status === "success") {
    return (
      <SuccessPanel
        feedId={feedId!}
        agent={address!}
        tx={registerTx!}
        rule={ruleAddress}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10">
      {/* LEFT — inputs */}
      <div className="space-y-8">
        <FaucetHint />

        {/* Mode toggle */}
        <div>
          <label className="caption mb-3 block">how to register</label>
          <div className="flex gap-px bg-line">
            <button
              onClick={() => setMode("new-feed")}
              className={`flex-1 caption py-2 transition-colors ${
                mode === "new-feed"
                  ? "bg-bg text-accent"
                  : "bg-bg-elev text-fg-mute"
              }`}
            >
              create a new feed
            </button>
            <button
              onClick={() => setMode("existing-feed")}
              className={`flex-1 caption py-2 transition-colors ${
                mode === "existing-feed"
                  ? "bg-bg text-accent"
                  : "bg-bg-elev text-fg-mute"
              }`}
            >
              join an existing feed
            </button>
          </div>
          <p className="text-2xs text-fg-dim mt-2 leading-relaxed">
            {mode === "new-feed"
              ? "You define a new data feed (e.g. London rents, OPEC output, your local CPI). Anyone — including you — can then register as an agent and attest values."
              : "You attest values for an already-existing feed. Multiple agents on one feed bid for trust; markets pick which agent's attestation to resolve against."}
          </p>
        </div>

        {/* Feed inputs */}
        {mode === "new-feed" ? (
          <div className="space-y-5">
            <Field
              label="feed description"
              hint="One line. Becomes the public name (e.g. 'London average residential price per sqm, monthly')."
            >
              <input
                type="text"
                value={feedDescription}
                onChange={(e) => setFeedDescription(e.target.value)}
                placeholder="…"
                className="w-full bg-bg border border-line px-3 py-2 text-[14px] focus:outline-none focus:border-accent"
              />
            </Field>

            <Field
              label="methodology · IPFS CID or URL"
              hint="Hashed into the feed identity. Pin a markdown doc explaining your data sources, sampling, processing. Use a real CID for production; any string works for testnet."
            >
              <input
                type="text"
                value={methodologyCid}
                onChange={(e) => setMethodologyCid(e.target.value)}
                placeholder="ipfs://… or https://…"
                className="w-full bg-bg border border-line px-3 py-2 text-[14px] focus:outline-none focus:border-accent"
              />
              {methodologyCid && (
                <div className="text-2xs text-fg-dim mt-1.5 tnum break-all">
                  hash · {methodologyHash}
                </div>
              )}
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
        ) : (
          <div className="space-y-5">
            <Field
              label="feed id · bytes32"
              hint="Find on the markets page, or from someone running an existing feed."
            >
              <input
                type="text"
                value={existingFeedId}
                onChange={(e) => setExistingFeedId(e.target.value)}
                placeholder="0x…"
                className="w-full bg-bg border border-line px-3 py-2 text-[13px] tnum focus:outline-none focus:border-accent break-all"
              />
            </Field>
            <Field
              label="your methodology · IPFS CID or URL"
              hint="What's your data source and processing approach? Hashed into your agent record."
            >
              <input
                type="text"
                value={methodologyCid}
                onChange={(e) => setMethodologyCid(e.target.value)}
                placeholder="ipfs://… or https://…"
                className="w-full bg-bg border border-line px-3 py-2 text-[14px] focus:outline-none focus:border-accent"
              />
            </Field>
          </div>
        )}

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
      </div>

      {/* RIGHT — sticky submit */}
      <aside className="lg:sticky lg:top-6 h-fit border border-line p-5 bg-bg-elev/40">
        <div className="caption text-fg-dim mb-4">register</div>

        <Row label="role" value="onchain oracle agent" />
        <Row label="bond" value={`${bondUsdcStr || "—"} USDC`} />
        <Row
          label="feed"
          value={
            mode === "new-feed"
              ? feedDescription.length > 0
                ? `“${feedDescription.slice(0, 24)}${feedDescription.length > 24 ? "…" : ""}”`
                : "(your new feed)"
              : existingFeedId
                ? `${existingFeedId.slice(0, 10)}…${existingFeedId.slice(-6)}`
                : "(pick one)"
          }
        />
        <Row
          label="txs"
          value={mode === "new-feed" ? "≈3 (approve, create, register)" : "≈2"}
        />

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
}: {
  feedId: Hex;
  agent: string;
  tx: Hex;
  rule?: `0x${string}`;
}) {
  // Snippet shape depends on whether the agent is rule-bound. Plain agents
  // return { value, inputHash } from run(); rule-bound agents return the
  // raw input vector and let the onchain rule contract compute the value.
  const snippet = rule
    ? `import { defineAgent } from "@registrai/agent-sdk";

const agent = defineAgent({
  name: "my-agent",
  schedule: "0 14 * * *",
  feedId: "${feedId}",
  registryAddress: "${CONTRACTS.RegistryV11 ?? CONTRACTS.Registry}",      // v1.1
  attestationAddress: "${CONTRACTS.AttestationV11 ?? CONTRACTS.Attestation}", // v1.1
  methodologyCid: "ipfs://your-methodology-cid",
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

const agent = defineAgent({
  name: "my-agent",
  schedule: "0 14 * * *",
  feedId: "${feedId}",
  registryAddress: "${CONTRACTS.Registry}",
  attestationAddress: "${CONTRACTS.Attestation}",
  methodologyCid: "ipfs://your-methodology-cid",
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
