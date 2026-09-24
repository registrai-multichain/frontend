"use client";

import { useMemo, useState, type ReactNode } from "react";
import useSWR from "swr";
import {
  createPublicClient,
  createWalletClient,
  custom,
  isAddress,
  recoverMessageAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { useWallet } from "@/components/WalletProvider";
import { transportFor, txUrl } from "@/lib/chains";
import { shortAddr } from "@/lib/format";
import { explainMinedRevert, humanizeError } from "@/lib/humanize-error";
import { PERENNIAL_WRITES_ENABLED } from "@/lib/perennial";
import { PERENNIAL } from "@/lib/perennial-network";
import {
  canonicalClaimMessage,
  issuedToday,
  normalizeSource,
  profileURIFor,
  proofLocation,
  proofUrl,
  sourceLabel,
  validateProof,
  type Claim,
  type ProofFile,
} from "@/lib/verified-builders";
import { verifiedBuilderAbi } from "@/lib/verified-builders-chain";

const CHAIN = PERENNIAL.chain;
const REG = PERENNIAL.contracts.BuilderRegistry;
const HUMAN = { testnet: CHAIN.testnet, networkName: PERENNIAL.label };

type Path = "repo" | "domain";
type Check =
  | { state: "idle" | "checking" }
  | { state: "ok" }
  | { state: "invalid"; detail: string }
  | { state: "missing"; detail: string }
  | { state: "unreachable" };

const regionName = (() => {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    return (code: string) => {
      const n = names.of(code);
      return n && n !== code ? n : null;
    };
  } catch {
    return () => null;
  }
})();

function parseDeployers(text: string): { ok: string[]; bad: string[] } {
  const parts = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const ok = [...new Set(parts.filter((p) => isAddress(p, { strict: false })).map((p) => p.toLowerCase()))];
  return { ok, bad: parts.filter((p) => !isAddress(p, { strict: false })) };
}

function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="vf-mini"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          // clipboard blocked — the text is selectable on screen
        }
      }}
    >
      {done ? "copied" : label}
    </button>
  );
}

function Step({ n, title, state, children }: { n: number; title: string; state: "done" | "active" | "todo"; children?: ReactNode }) {
  return (
    <li className="vf-step" data-state={state}>
      <div className="vf-step-num tnum">{String(n).padStart(2, "0")}</div>
      <div className="vf-step-body">
        <h2>
          {title}
          {state === "done" && <span className="vf-done">done</span>}
        </h2>
        {state !== "todo" && children}
      </div>
    </li>
  );
}

export function VerifyFlow() {
  const { address, walletChainId, connect, switchChain, isConnecting, error: walletError } = useWallet();

  const [path, setPath] = useState<Path>("repo");
  const [sourceInput, setSourceInput] = useState("");
  const [countryInput, setCountryInput] = useState("");
  const [deployersInput, setDeployersInput] = useState("");

  // Frozen at the builder's signature: every later signature covers these bytes.
  const [claim, setClaim] = useState<Claim | null>(null);
  const [builderSig, setBuilderSig] = useState<Hex>();
  const [deployerSigs, setDeployerSigs] = useState<Record<string, Hex>>({});
  const [signing, setSigning] = useState<string>();
  const [signError, setSignError] = useState<string>();

  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [txState, setTxState] = useState<{ pending?: boolean; hash?: Hex; error?: string; done?: boolean }>({});

  // ───────── inputs ─────────
  const normalized = normalizeSource(sourceInput);
  const kindOk = normalized ? normalized.startsWith(path === "repo" ? "github:" : "domain:") : false;
  const source = normalized && kindOk ? normalized : null;
  const country = countryInput.trim().toUpperCase();
  const countryOk = /^[A-Z]{2}$/.test(country) && regionName(country) !== null;
  const deployers = parseDeployers(deployersInput);
  const inputsOk = Boolean(source) && countryOk && (path === "repo" || deployers.bad.length === 0);

  const builder = (claim?.builder ?? address?.toLowerCase()) as Address | undefined;
  const message = claim ? canonicalClaimMessage(claim) : null;
  const toSign = claim ? claim.deployers.filter((d) => d !== claim.builder) : [];
  const unsigned = toSign.filter((d) => !deployerSigs[d]);
  const complete = Boolean(claim && builderSig && unsigned.length === 0);
  const file: ProofFile | null = complete
    ? { version: 1, claim: claim!, signatures: { builder: builderSig!, deployers: Object.fromEntries(toSign.map((d) => [d, deployerSigs[d]])) } }
    : null;
  const fileText = file ? `${JSON.stringify(file, null, 2)}\n` : "";
  const url = claim ? proofUrl(claim.source) : null;

  async function sign(expected: string): Promise<Hex | undefined> {
    if (!message || !address || typeof window === "undefined" || !window.ethereum) return undefined;
    const wallet = createWalletClient({ chain: CHAIN.viemChain, transport: custom(window.ethereum), account: address });
    const sig = await wallet.signMessage({ account: address, message });
    const who = await recoverMessageAddress({ message, signature: sig });
    if (who.toLowerCase() !== expected) throw new Error(`That signature came from ${shortAddr(who)}, not ${shortAddr(expected)}.`);
    return sig;
  }

  async function signAsBuilder() {
    if (!address || !source) return;
    const frozen: Claim = {
      builder: address.toLowerCase(),
      source,
      deployers: path === "domain" ? deployers.ok : [],
      country,
      chain: CHAIN.id,
      issued: issuedToday(),
    };
    setSignError(undefined);
    setSigning("builder");
    setClaim(frozen);
    try {
      const message = canonicalClaimMessage(frozen);
      const wallet = createWalletClient({ chain: CHAIN.viemChain, transport: custom(window.ethereum!), account: address });
      const sig = await wallet.signMessage({ account: address, message });
      const who = await recoverMessageAddress({ message, signature: sig });
      if (who.toLowerCase() !== frozen.builder) throw new Error(`That signature came from ${shortAddr(who)}, not your builder wallet.`);
      setBuilderSig(sig);
    } catch (e) {
      setClaim(null);
      setSignError(humanizeError(e, HUMAN));
    } finally {
      setSigning(undefined);
    }
  }

  async function signAsDeployer(d: string) {
    setSignError(undefined);
    setSigning(d);
    try {
      const sig = await sign(d);
      if (sig) setDeployerSigs((s) => ({ ...s, [d]: sig }));
    } catch (e) {
      setSignError(humanizeError(e, HUMAN));
    } finally {
      setSigning(undefined);
    }
  }

  async function pickAccount() {
    try {
      await window.ethereum?.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
    } catch {
      // not supported or cancelled — switching in the wallet itself works too
    }
  }

  function startOver() {
    setClaim(null);
    setBuilderSig(undefined);
    setDeployerSigs({});
    setCheck({ state: "idle" });
    setTxState({});
    setSignError(undefined);
  }

  function download() {
    const blob = new Blob([fileText], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "registrai.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ───────── live check ─────────
  async function runCheck() {
    if (!claim || !url) return;
    setCheck({ state: "checking" });
    let body: unknown;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        setCheck({ state: "missing", detail: `${res.status} at ${url}` });
        return;
      }
      body = JSON.parse(await res.text());
    } catch (e) {
      // GitHub raw allows cross-origin reads; a domain may not. A blocked read is
      // not a failure — the sync reads it server-side.
      if (claim.source.startsWith("domain:") && e instanceof TypeError) setCheck({ state: "unreachable" });
      else setCheck({ state: "missing", detail: e instanceof SyntaxError ? "the file is not valid JSON" : humanizeError(e, HUMAN) });
      return;
    }
    const r = await validateProof(body, { expectedSource: claim.source, onchainOwner: claim.builder, chainId: CHAIN.id });
    setCheck(r.valid ? { state: "ok" } : { state: "invalid", detail: r.reason });
  }

  // ───────── registration ─────────
  const publicClient = useMemo(
    () => createPublicClient({ chain: CHAIN.viemChain, transport: transportFor(CHAIN) }) as PublicClient,
    [],
  );
  const profileURI = claim ? profileURIFor(claim.source) : "";
  const { data: reg, error: regError, mutate: refreshReg } = useSWR(
    complete && PERENNIAL.deployed && REG && builder ? ["verify-registration", CHAIN.id, builder, profileURI] : null,
    async () => {
      const id = Number(await publicClient.readContract({ address: REG!, abi: verifiedBuilderAbi, functionName: "builderIdOf", args: [builder!] }));
      const current = id
        ? ((await publicClient.readContract({ address: REG!, abi: verifiedBuilderAbi, functionName: "builders", args: [BigInt(id)] })) as readonly [Address, string, Hex, bigint, boolean])[1]
        : null;
      const [balance, gasPrice] = await Promise.all([publicClient.getBalance({ address: builder! }), publicClient.getGasPrice()]);
      let gas = 250_000n;
      try {
        gas = await publicClient.estimateContractGas(
          id
            ? { address: REG!, abi: verifiedBuilderAbi, functionName: "updateProfile", args: [profileURI], account: builder! }
            : { address: REG!, abi: verifiedBuilderAbi, functionName: "registerBuilder", args: [profileURI], account: builder! },
        );
      } catch {
        // keep the conservative default
      }
      return { id, current, needsGas: balance < (gas * gasPrice * 13n) / 10n };
    },
    { revalidateOnFocus: false },
  );

  const onChain = walletChainId === CHAIN.id;
  const isBuilderWallet = Boolean(address && builder && address.toLowerCase() === builder);
  const alreadyDone = Boolean(reg && reg.current === profileURI);

  async function register() {
    if (!reg || !address || !REG || !window.ethereum) return;
    if (!PERENNIAL_WRITES_ENABLED) return setTxState({ error: "Registrations are paused." });
    setTxState({ pending: true });
    try {
      const wallet = createWalletClient({ chain: CHAIN.viemChain, transport: custom(window.ethereum), account: address });
      const fn = reg.id ? "updateProfile" : "registerBuilder";
      await publicClient.simulateContract({ address: REG, abi: verifiedBuilderAbi, functionName: fn, args: [profileURI], account: address });
      const hash = await wallet.writeContract({ address: REG, abi: verifiedBuilderAbi, functionName: fn, args: [profileURI], chain: CHAIN.viemChain, account: address });
      setTxState({ pending: true, hash });
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error(await explainMinedRevert(publicClient, hash, HUMAN));
      setTxState({ hash, done: true });
      await refreshReg();
    } catch (e) {
      setTxState((s) => ({ hash: s.hash, error: humanizeError(e, HUMAN) }));
    }
  }

  // ───────── view ─────────
  const s1 = address || claim ? "done" : "active";
  const s2 = claim ? "done" : address ? "active" : "todo";
  const s3 = complete ? "done" : claim || (address && inputsOk) ? "active" : "todo";
  const s4 = complete ? (check.state === "ok" || check.state === "unreachable" ? "done" : "active") : "todo";
  const s5 = complete ? (alreadyDone ? "done" : "active") : "todo";

  const gasless = (
    <div className="vf-gasless">
      <strong>No USDC for {PERENNIAL.label} gas? Send us your source.</strong>
      <p>
        Reply to whoever sent you this link with the line below. We register it for you from the Registrai
        multisig after checking your proof. Your wallet stays the owner; nothing is signed on your behalf.
      </p>
      {claim && (
        <div className="vf-copyline">
          <code>{claim.source}</code>
          <CopyButton text={claim.source} />
        </div>
      )}
    </div>
  );

  return (
    <ol className="vf-steps">
      <Step n={1} title="Connect your builder wallet" state={s1}>
        {address ? (
          <p className="vf-note">
            Builder wallet <b className="tnum">{shortAddr(builder ?? address)}</b>. This address becomes the project&apos;s
            owner on-chain; use one you will keep.
          </p>
        ) : (
          <>
            <p className="vf-note">The wallet that will own the project on {PERENNIAL.label}. Signing is free; it sends nothing.</p>
            <button type="button" className="vf-primary" onClick={connect} disabled={isConnecting}>
              {isConnecting ? "connecting…" : "connect wallet"}
            </button>
            {walletError && <p className="vf-error">{walletError}</p>}
          </>
        )}
      </Step>

      <Step n={2} title="Your project" state={s2}>
        <div className="vf-paths" role="radiogroup" aria-label="Proof path">
          {(["repo", "domain"] as Path[]).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={path === p}
              data-active={path === p ? "true" : undefined}
              disabled={Boolean(claim)}
              onClick={() => setPath(p)}
            >
              <b>{p === "repo" ? "Open source" : "Closed source"}</b>
              <span>{p === "repo" ? "a file in your GitHub repo; releases and tags count" : "a file on your domain; contracts your deployers create count"}</span>
            </button>
          ))}
        </div>

        <label className="vf-field">
          <span>{path === "repo" ? "GitHub repository" : "Domain"}</span>
          <input
            value={claim ? sourceLabel(claim.source) : sourceInput}
            onChange={(e) => setSourceInput(e.target.value)}
            placeholder={path === "repo" ? "github.com/you/project" : "app.yourproject.xyz"}
            disabled={Boolean(claim)}
            spellCheck={false}
            autoCapitalize="off"
          />
        </label>
        {sourceInput.trim() && !claim && (
          <p className={source ? "vf-hint" : "vf-error"}>
            {source
              ? `→ ${source}`
              : normalized
                ? `That looks like a ${normalized.startsWith("github:") ? "GitHub repo" : "domain"}; switch the path above.`
                : path === "repo"
                  ? "Enter github.com/owner/repo or owner/repo."
                  : "Enter a domain like app.example.com (no port)."}
          </p>
        )}

        <label className="vf-field vf-field-short">
          <span>Country</span>
          <input
            value={claim ? claim.country : countryInput}
            onChange={(e) => setCountryInput(e.target.value.slice(0, 2))}
            placeholder="PL"
            maxLength={2}
            disabled={Boolean(claim)}
            autoCapitalize="characters"
          />
          <em>{countryOk ? regionName(country) : "ISO code, 2 letters"}</em>
        </label>
        {countryInput.trim().length === 2 && !countryOk && !claim && <p className="vf-error">Not an ISO 3166-1 country code.</p>}

        {path === "domain" && (
          <>
            <label className="vf-field">
              <span>Deployer addresses</span>
              <textarea
                value={claim ? claim.deployers.join("\n") : deployersInput}
                onChange={(e) => setDeployersInput(e.target.value)}
                placeholder={"0x… one per line (your builder wallet can be one of them)"}
                rows={3}
                disabled={Boolean(claim)}
                spellCheck={false}
              />
            </label>
            <p className={deployers.bad.length && !claim ? "vf-error" : "vf-hint"}>
              {deployers.bad.length && !claim
                ? `Not addresses: ${deployers.bad.join(", ")}`
                : "Wallets that deploy your contracts directly. Each one signs this claim; your milestone is the number of contracts they create (factory / CREATE2 deploys don't count yet). Leave empty to verify the domain only."}
            </p>
          </>
        )}
      </Step>

      <Step n={3} title="Sign the claim" state={s3}>
        {!claim ? (
          <>
            <p className="vf-note">Your wallet signs a plain-text statement. It costs nothing and sends nothing.</p>
            <button type="button" className="vf-primary" disabled={!inputsOk || !address || Boolean(signing)} onClick={signAsBuilder}>
              {signing === "builder" ? "check your wallet…" : "sign as builder"}
            </button>
          </>
        ) : (
          <>
            <pre className="vf-pre" aria-label="The message you sign">{message}</pre>
            <ul className="vf-signers">
              <li data-signed={builderSig ? "true" : undefined}>
                <span className="tnum">{shortAddr(claim.builder)}</span>
                <span>builder</span>
                <b>{builderSig ? "signed" : signing === "builder" ? "check your wallet…" : "—"}</b>
              </li>
              {toSign.map((d) => {
                const here = address?.toLowerCase() === d;
                return (
                  <li key={d} data-signed={deployerSigs[d] ? "true" : undefined}>
                    <span className="tnum">{shortAddr(d)}</span>
                    <span>deployer</span>
                    {deployerSigs[d] ? (
                      <b>signed</b>
                    ) : here ? (
                      <button type="button" className="vf-mini vf-mini-strong" disabled={Boolean(signing)} onClick={() => signAsDeployer(d)}>
                        {signing === d ? "check your wallet…" : "sign"}
                      </button>
                    ) : (
                      <button type="button" className="vf-mini" onClick={pickAccount}>switch account</button>
                    )}
                  </li>
                );
              })}
            </ul>
            {unsigned.length > 0 && (
              <p className="vf-note">
                Each deployer signs in turn: switch your wallet to <b className="tnum">{shortAddr(unsigned[0])}</b>, then press sign.
                Switch back to the builder wallet afterwards to register.
              </p>
            )}
            <button type="button" className="vf-link" onClick={startOver}>start over</button>
          </>
        )}
        {signError && <p className="vf-error">{signError}</p>}
      </Step>

      <Step n={4} title="Publish the proof" state={s4}>
        {file && claim && url && (
          <>
            <p className="vf-note">
              Put this file, exactly as it is, at <b>{proofLocation(claim.source)}</b>
              {claim.source.startsWith("github:") ? ". The file name starts with a dot." : "."} It is read from:
            </p>
            <div className="vf-copyline">
              <code>{url}</code>
              <CopyButton text={url} />
            </div>
            <div className="vf-file">
              <div className="vf-file-head">
                <span>{claim.source.startsWith("github:") ? ".registrai.json" : "registrai.json"}</span>
                <span>
                  <CopyButton text={fileText} />
                  <button type="button" className="vf-mini" onClick={download}>download</button>
                </span>
              </div>
              <pre className="vf-pre">{fileText}</pre>
            </div>
            <button type="button" className="vf-primary" onClick={runCheck} disabled={check.state === "checking"}>
              {check.state === "checking" ? "checking…" : "check it's live"}
            </button>
            {check.state === "ok" && <p className="vf-ok">Found and valid. Your claim checks out.</p>}
            {check.state === "invalid" && <p className="vf-error">The file is there but does not check out: {check.detail}.</p>}
            {check.state === "missing" && (
              <p className="vf-error">
                Not found yet ({check.detail}).
                {claim.source.startsWith("github:") ? " GitHub can take a few minutes to serve a new push; try again shortly." : ""}
              </p>
            )}
            {check.state === "unreachable" && (
              <p className="vf-hint">
                Your domain doesn&apos;t let this page read the file (CORS), so we can&apos;t check it from here. That&apos;s fine:
                it is checked server-side, and you&apos;ll show as verified at the next sync.
              </p>
            )}
          </>
        )}
      </Step>

      <Step n={5} title={`Register on ${PERENNIAL.label}`} state={s5}>
        {!PERENNIAL.deployed || !REG ? (
          <>
            <p className="vf-note">Registration opens here once Perennial is live on {PERENNIAL.label}. Keep your proof file published.</p>
            {gasless}
          </>
        ) : regError ? (
          <p className="vf-error">Couldn&apos;t read {PERENNIAL.label}: {humanizeError(regError, HUMAN)}</p>
        ) : !reg ? (
          <p className="vf-note">Reading your registration…</p>
        ) : alreadyDone ? (
          <>
            <p className="vf-ok">
              Registered as builder #{reg.id} with {claim?.source}.
            </p>
            <p className="vf-note">
              Next, the Registrai multisig assigns our milestone operator as your caretaker in its next onboarding batch. From
              then on you show as verified on the atlas and season boards, and your milestone feed is bonded. Markets on it are
              opened by the community, not by us.
            </p>
            {txState.hash && <a className="vf-link" href={txUrl(CHAIN, txState.hash)} target="_blank" rel="noreferrer">view transaction ↗</a>}
          </>
        ) : (
          <>
            <p className="vf-note">
              {reg.id
                ? <>This wallet is already builder #{reg.id}. Registering points its profile link at your claim, replacing <code>{reg.current || "an empty link"}</code>.</>
                : <>Your profile link will be <code>{profileURI}</code>. Registration is what makes the claim count.</>}
            </p>
            {reg.needsGas ? (
              gasless
            ) : !isBuilderWallet ? (
              <p className="vf-error">Switch your wallet back to the builder wallet {builder ? shortAddr(builder) : ""} to register.</p>
            ) : !onChain ? (
              <button type="button" className="vf-primary" onClick={() => switchChain(CHAIN.id)}>switch to {PERENNIAL.label}</button>
            ) : (
              <button type="button" className="vf-primary" onClick={register} disabled={txState.pending || !PERENNIAL_WRITES_ENABLED}>
                {txState.pending ? "registering…" : reg.id ? "update profile link" : "register"}
              </button>
            )}
            {!reg.needsGas && (
              <details className="vf-details">
                <summary>No USDC for gas?</summary>
                {gasless}
              </details>
            )}
            {txState.error && <p className="vf-error">{txState.error}</p>}
            {txState.hash && <a className="vf-link" href={txUrl(CHAIN, txState.hash)} target="_blank" rel="noreferrer">view transaction ↗</a>}
          </>
        )}
      </Step>
    </ol>
  );
}
