"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { createWalletClient, custom, isAddress, recoverMessageAddress, type Abi, type Address, type Hex } from "viem";
import { useWallet } from "@/components/WalletProvider";
import { txUrl } from "@/lib/chains";
import { shortAddr } from "@/lib/format";
import { humanizeError } from "@/lib/humanize-error";
import { PERENNIAL_WRITES_ENABLED } from "@/lib/perennial";
import { BUILDERS, MARKETS_OPEN_ON_BUILDERS_NETWORK } from "@/lib/builders-network";
import { browserProjectProof, parseSourceParam } from "@/lib/builders-gallery";
import {
  MAX_PROJECTS_PER_BUILDER,
  MAX_SOURCE_LEN,
  canonicalClaimMessage,
  issuedToday,
  normalizeSource,
  proofLocation,
  proofUrl,
  sourceLabel,
  type Claim,
  type ProofFile,
} from "@/lib/verified-builders";
import { verifiedBuilderAbi } from "@/lib/verified-builders-chain";
import { MAX_NAME_LEN } from "@/lib/builders-gallery";
import { displayNameError, finalStepTitle, planClaim, projectSlots, sourceError, stepStates } from "@/lib/verify-plan";
import { sendBuildersTx } from "./sendTx";
import { buildersClient, useMyBuilder } from "./useMyBuilder";

// Claims register on the BUILDERS network (Arc mainnet in phase 1), which may
// have no markets yet; nothing here reads or needs a market contract.
const CHAIN = BUILDERS.chain;
const REG = BUILDERS.contracts.BuilderRegistry;
const LABEL = BUILDERS.label;
const HUMAN = { testnet: CHAIN.testnet, networkName: LABEL };
/** Milestone feeds and markets exist on the builders network. */
const MARKETS_OPEN = MARKETS_OPEN_ON_BUILDERS_NETWORK;

type Path = "repo" | "domain";
type Check =
  | { state: "idle" | "checking" }
  | { state: "ok" }
  | { state: "invalid"; detail: string }
  | { state: "missing"; detail: string }
  | { state: "unreachable"; detail: string };

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

/**
 * `?source=` (the gallery's "Claim this project" link) prefills the project.
 * useSearchParams needs a Suspense boundary in a static export, so it lives in
 * this leaf and reports up.
 */
function SourceParam({ onSource }: { onSource: (p: { source: string; path: Path }) => void }) {
  const params = useSearchParams();
  const raw = params?.get("source");
  const invite = params?.get("invite");
  useEffect(() => {
    const p = parseSourceParam(raw);
    if (p) onSource(p);
  }, [raw, onSource]);
  useEffect(() => {
    if (raw && invite) reportInviteOpen(raw, invite);
  }, [raw, invite]);
  return null;
}

let inviteOpenReported = false;
/**
 * A personal claim link (`?source=…&invite=<code>`, made in /admin) was
 * opened: tell builder.registrai.cc once per page load. Fire and forget; the
 * API ignores wrong codes, and where it does not exist nothing happens.
 */
function reportInviteOpen(source: string, code: string) {
  if (inviteOpenReported) return;
  inviteOpenReported = true;
  fetch("/api/invites/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source, code }),
    keepalive: true,
  }).catch(() => undefined);
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

/** A project picked elsewhere on the page ("re-sign this proof", "add a project"); `n` changes on every pick. */
export interface ProjectPick {
  source: string;
  n: number;
}

/**
 * The claim flow for ONE project: connect, pick the project, sign the claim,
 * publish the proof, then — for a wallet without a builder —
 * `registerBuilderWithProject(name, source)`, for a builder `addProject(source)`,
 * or nothing at all when the project is already on the builder (a re-sign after
 * an owner change). See src/lib/verify-plan.ts.
 */
export function VerifyFlow({ pick = null }: { pick?: ProjectPick | null }) {
  const { address, walletChainId, connect, switchChain, isConnecting, error: walletError } = useWallet();

  const [path, setPath] = useState<Path>("repo");
  const [sourceInput, setSourceInput] = useState("");
  const [countryInput, setCountryInput] = useState("");
  const [deployersInput, setDeployersInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const top = useRef<HTMLOListElement>(null);

  // Prefill once from ?source=, never over something the builder typed or signed.
  const prefilled = useRef(false);
  const touched = useRef(false);
  const [invitedSource, setInvitedSource] = useState<string | null>(null);
  const onSourceParam = useCallback((p: { source: string; path: Path }) => {
    if (prefilled.current || touched.current) return;
    prefilled.current = true;
    setInvitedSource(p.source);
    setPath(p.path);
    setSourceInput(sourceLabel(p.source));
  }, []);

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
  const tooLong = source ? sourceError(source) : null;
  const nameError = displayNameError(nameInput);

  const builder = (claim?.builder ?? address?.toLowerCase()) as Address | undefined;
  // The builder wallet's registration: none (register with this project) or a
  // builder (add this project / re-sign it). Shared with MyBuilderPanel.
  const { data: me, error: meError, mutate: refreshMe } = useMyBuilder(builder);
  const myBuilder = me?.builder ?? null;
  const slots = projectSlots(myBuilder);
  const inputsOk = Boolean(source) && !tooLong && !nameError && countryOk && (path === "repo" || deployers.bad.length === 0);
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

  // "re-sign this proof" / "add a project" from the panel above: prefill (or
  // clear) the project and start the claim over.
  useEffect(() => {
    if (!pick) return;
    touched.current = true;
    setClaim(null);
    setBuilderSig(undefined);
    setDeployerSigs({});
    setCheck({ state: "idle" });
    setTxState({});
    setSignError(undefined);
    if (pick.source) {
      setPath(pick.source.startsWith("github:") ? "repo" : "domain");
      setSourceInput(sourceLabel(pick.source));
    } else {
      setSourceInput("");
    }
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pick]);

  function download() {
    const blob = new Blob([fileText], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "registrai.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ───────── live check ─────────
  // Read through the builders site's proof API (server-side: a domain's CORS
  // does not matter), else directly with the cache-buster. Only a file that
  // was read AND validates counts as live; a read that failed never does.
  async function runCheck() {
    if (!claim || !url) return;
    setCheck({ state: "checking" });
    try {
      const r = await browserProjectProof({ owner: claim.builder, source: claim.source }, { chainId: CHAIN.id });
      if (r.state === "valid") setCheck({ state: "ok" });
      else if (r.state === "missing") setCheck({ state: "missing", detail: `nothing at ${url}` });
      else if (r.state === "unchecked") setCheck({ state: "unreachable", detail: r.reason ?? "no answer" });
      else if (r.state === "resign") setCheck({ state: "invalid", detail: `it is signed by ${shortAddr(r.signer)}, not this builder wallet` });
      else setCheck({ state: "invalid", detail: r.reason });
    } catch (e) {
      setCheck({ state: "unreachable", detail: humanizeError(e, HUMAN) });
    }
  }

  // ───────── registration ─────────
  const target = claim && me ? planClaim({ source: claim.source, displayName: nameInput, builder: myBuilder }) : null;
  const call =
    target?.kind === "register" || target?.kind === "addProject"
      ? { address: REG!, abi: verifiedBuilderAbi as Abi, functionName: target.functionName, args: target.args }
      : null;
  const { data: gas } = useSWR(
    complete && REG && builder && call ? ["verify-gas", CHAIN.id, builder, call.functionName, ...call.args] : null,
    async () => {
      const pc = buildersClient();
      const [balance, gasPrice] = await Promise.all([pc.getBalance({ address: builder! }), pc.getGasPrice()]);
      let units = 400_000n;
      try {
        units = await pc.estimateContractGas({ ...call!, account: builder! } as never);
      } catch {
        // keep the conservative default
      }
      return { needsGas: balance < (units * gasPrice * 13n) / 10n };
    },
    { revalidateOnFocus: false },
  );

  const onChain = walletChainId === CHAIN.id;
  const isBuilderWallet = Boolean(address && builder && address.toLowerCase() === builder);

  async function register() {
    if (!call || !address || !REG) return;
    if (!PERENNIAL_WRITES_ENABLED) return setTxState({ error: "Registrations are paused." });
    setTxState({ pending: true });
    try {
      const hash = await sendBuildersTx({ ...call, account: address, onHash: (h) => setTxState({ pending: true, hash: h }) });
      setTxState({ hash, done: true });
      await refreshMe();
    } catch (e) {
      setTxState((s) => ({ hash: s.hash, error: humanizeError(e, HUMAN) }));
    }
  }

  // ───────── view ─────────
  const proofLive = check.state === "ok";
  const [s1, s2, s3, s4, s5] = stepStates({
    connected: Boolean(address),
    claimFrozen: Boolean(claim),
    inputsOk,
    signed: complete,
    proofLive,
    target,
    finished: Boolean(txState.done),
  });
  const onBuilder = target?.kind === "resign" ? target.projectId : null;

  const gasless = (
    <div className="vf-gasless">
      <strong>No USDC for {LABEL} gas? Send us your source.</strong>
      <p>
        Reply to whoever sent you this link with the line below. We register it for you from the Registrai
        multisig after checking your proof (a new builder first, then the project). Your wallet stays the owner;
        nothing is signed on your behalf.
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
    <>
    <Suspense fallback={null}>
      <SourceParam onSource={onSourceParam} />
    </Suspense>
    <ol className="vf-steps" ref={top}>
      <Step n={1} title="Connect your builder wallet" state={s1}>
        {address ? (
          <p className="vf-note">
            Builder wallet <b className="tnum">{shortAddr(builder ?? address)}</b>
            {myBuilder ? (
              <>, builder #{myBuilder.id}. This claim adds a project to it.</>
            ) : (
              <>. This address becomes your builder&apos;s owner on-chain, for every project you add; use one you will keep.</>
            )}
          </p>
        ) : (
          <>
            {invitedSource && (
              <p className="vf-hint">Claiming {sourceLabel(invitedSource)}. Connect to continue; it&apos;s prefilled below.</p>
            )}
            <p className="vf-note">The wallet that will own the project on {LABEL}. Signing is free; it sends nothing.</p>
            <button type="button" className="vf-primary" onClick={connect} disabled={isConnecting}>
              {isConnecting ? "connecting…" : "connect wallet"}
            </button>
            {walletError && <p className="vf-error">{walletError}</p>}
          </>
        )}
      </Step>

      <Step n={2} title={myBuilder ? "Add a project" : "Your project"} state={s2}>
        <div className="vf-paths" role="radiogroup" aria-label="Proof path">
          {(["repo", "domain"] as Path[]).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={path === p}
              data-active={path === p ? "true" : undefined}
              disabled={Boolean(claim)}
              onClick={() => {
                touched.current = true;
                setPath(p);
              }}
            >
              <b>{p === "repo" ? "Open source" : "Closed source"}</b>
              <span>
                {p === "repo" ? "a file in your GitHub repo" : "a file on your domain"}
                {MARKETS_OPEN
                  ? p === "repo" ? "; releases and tags count" : "; contracts your deployers create count"
                  : p === "repo" ? "; releases and tags count once milestone tracking starts" : "; contracts your deployers create count once milestone tracking starts"}
              </span>
            </button>
          ))}
        </div>

        <label className="vf-field">
          <span>{path === "repo" ? "GitHub repository" : "Domain"}</span>
          <input
            value={claim ? sourceLabel(claim.source) : sourceInput}
            onChange={(e) => {
              touched.current = true;
              setSourceInput(e.target.value);
            }}
            placeholder={path === "repo" ? "github.com/you/project" : "app.yourproject.xyz"}
            disabled={Boolean(claim)}
            spellCheck={false}
            autoCapitalize="off"
          />
        </label>
        {tooLong && !claim && <p className="vf-error">{tooLong}</p>}
        {sourceInput.trim() && !claim && !tooLong && (
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

        <p className="vf-hint">
          {myBuilder
            ? `Builder #${myBuilder.id}: ${slots.used} of ${MAX_PROJECTS_PER_BUILDER} project slots used. `
            : `A builder holds up to ${MAX_PROJECTS_PER_BUILDER} projects, each with its own proof. `}
          A project source is at most {MAX_SOURCE_LEN} bytes.
        </p>

        {me && !myBuilder && (
          <>
            <label className="vf-field">
              <span>Builder name</span>
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="optional, shown in the gallery"
                maxLength={MAX_NAME_LEN}
                disabled={Boolean(claim) && Boolean(txState.done)}
                spellCheck={false}
              />
              <em>{nameInput.trim() ? `${[...nameInput.trim()].length}/${MAX_NAME_LEN}` : ""}</em>
            </label>
            {nameError && <p className="vf-error">{nameError}</p>}
          </>
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
                : `Wallets that deploy your contracts directly. Each one signs this claim; your milestone is the number of contracts they create (factory / CREATE2 deploys don't count yet)${MARKETS_OPEN ? "" : `, counted once milestone tracking starts with the markets on ${LABEL}`}. Leave empty to verify the domain only.`}
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
              <p className="vf-error">
                Couldn&apos;t read the file ({check.detail}), so it doesn&apos;t count as live yet. Make sure it is served at the
                address above over https, then check again.
                {claim.source.startsWith("domain:")
                  ? " Optional: serve it with the header Access-Control-Allow-Origin: * so browsers can read it directly too."
                  : " GitHub can take a few minutes to serve a new push."}
              </p>
            )}
          </>
        )}
      </Step>

      <Step n={5} title={finalStepTitle(target, LABEL)} state={s5}>
        {!REG ? (
          <>
            <p className="vf-note">Registration opens here once the builder registry is live on {LABEL}. Keep your proof file published.</p>
            {gasless}
          </>
        ) : meError ? (
          <p className="vf-error">Couldn&apos;t read {LABEL}: {humanizeError(meError, HUMAN)}</p>
        ) : !me || !target ? (
          <p className="vf-note">Reading your registration…</p>
        ) : txState.done && myBuilder ? (
          <>
            <p className="vf-ok">
              {claim?.source} is now a project of builder #{myBuilder.id}.
            </p>
            {MARKETS_OPEN ? (
              <p className="vf-note">
                Next, the Registrai multisig assigns our milestone operator as your caretaker in its next onboarding batch (once,
                for your builder). From then on you show as verified on the atlas and season boards, and this project&apos;s
                milestone feed is bonded. Markets on it are opened by the community, not by us.
              </p>
            ) : (
              <p className="vf-note">
                You show as nominated in the builders gallery until the Registrai multisig onboards your builder in its next
                batch and issues your Verified Builder Badge (one per builder). Milestone tracking starts when markets open on {LABEL}.
              </p>
            )}
            <Link className="vf-link" href={`/builders?builder=${myBuilder.id}`}>see your card in the gallery →</Link>
            {txState.hash && <a className="vf-link" href={txUrl(CHAIN, txState.hash)} target="_blank" rel="noreferrer">view transaction ↗</a>}
          </>
        ) : target.kind === "blocked" ? (
          <p className="vf-error">{target.reason}</p>
        ) : target.kind === "resign" ? (
          <>
            <p className="vf-ok">
              {claim?.source} is already project #{onBuilder} of your builder #{myBuilder?.id}. Nothing to send: publishing
              the proof you just signed is all it needs.
            </p>
            <p className="vf-note">The gallery re-checks every proof when it loads, so the project counts again there right away.</p>
            {myBuilder && <Link className="vf-link" href={`/builders?builder=${myBuilder.id}`}>see your card in the gallery →</Link>}
          </>
        ) : (
          <>
            <p className="vf-note">
              {target.kind === "register" ? (
                <>
                  One transaction registers your builder
                  {target.args[0] ? <> as <code>{target.args[0]}</code></> : null} with <code>{target.args[1]}</code> as its
                  first project. Registration is what makes the claim count.
                </>
              ) : (
                <>
                  Adds <code>{target.args[0]}</code> to builder #{myBuilder?.id} (project {slots.used + 1} of{" "}
                  {MAX_PROJECTS_PER_BUILDER}).
                </>
              )}
            </p>
            {gas?.needsGas ? (
              gasless
            ) : !isBuilderWallet ? (
              <p className="vf-error">Switch your wallet back to the builder wallet {builder ? shortAddr(builder) : ""} to register.</p>
            ) : !onChain ? (
              <button type="button" className="vf-primary" onClick={() => switchChain(CHAIN.id)}>switch to {LABEL}</button>
            ) : (
              <button type="button" className="vf-primary" onClick={register} disabled={txState.pending || !PERENNIAL_WRITES_ENABLED}>
                {txState.pending ? "sending…" : target.kind === "register" ? "register" : "add project"}
              </button>
            )}
            {!gas?.needsGas && (
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
    </>
  );
}
