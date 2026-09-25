"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getAddress, isAddress, zeroAddress, type Abi, type Address, type Hex } from "viem";
import { useWallet } from "@/components/WalletProvider";
import { BUILDERS } from "@/lib/builders-network";
import { txUrl } from "@/lib/chains";
import { shortAddr } from "@/lib/format";
import { humanizeError } from "@/lib/humanize-error";
import { PERENNIAL_WRITES_ENABLED } from "@/lib/perennial";
import { plainProfileName, sourceHref } from "@/lib/builders-gallery";
import { formatCountdown, recoveryView, showFinishRecovery, transferTargetError, utcMinute } from "@/lib/builder-ownership";
import { MAX_PROJECTS_PER_BUILDER, MAX_SOURCE_LEN, sourceLabel } from "@/lib/verified-builders";
import { verifiedBuilderAbi } from "@/lib/verified-builders-chain";
import { badgeAbi, badgeNeedsSync, serialLabel } from "@/lib/verified-builder-badge";
import {
  MAX_PROFILE_LEN,
  myProjectStatus,
  profileEdit,
  projectSlots,
  removeProjectNote,
  type MyBuilder,
  type MyProjectStatus,
} from "@/lib/verify-plan";
import type { ProjectProofState } from "@/lib/builders-gallery";
import { HUMAN, sendBuildersTx } from "./sendTx";
import { buildersClient, useMyBuilder, useProjectProofs } from "./useMyBuilder";

const CHAIN = BUILDERS.chain;
const REG = BUILDERS.contracts.BuilderRegistry;
const BADGE = BUILDERS.badgesOn ? BUILDERS.contracts.VerifiedBuilderBadge : null;

/** Seconds since the epoch, ticking every `ms`. */
function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

type Action = { pending?: string; error?: string; hash?: Hex; done?: string };

/** One write at a time from this panel, with its hash and error. */
function useAction(after: () => Promise<unknown>) {
  const { address, walletChainId, switchChain } = useWallet();
  const [state, setState] = useState<Action>({});
  async function run(label: string, done: string, call: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] }) {
    if (!address) return;
    if (!PERENNIAL_WRITES_ENABLED) return setState({ error: "Writes are paused." });
    setState({ pending: label });
    try {
      if (walletChainId !== CHAIN.id) await switchChain(CHAIN.id);
      const hash = await sendBuildersTx({ ...call, account: address as Address, onHash: (h) => setState({ pending: label, hash: h }) });
      setState({ hash, done });
      await after();
    } catch (e) {
      setState((s) => ({ hash: s.hash, error: humanizeError(e, HUMAN) }));
    }
  }
  return { state, run, busy: Boolean(state.pending) };
}

function ActionResult({ s }: { s: Action }) {
  return (
    <>
      {s.done && <p className="vf-ok">{s.done}</p>}
      {s.error && <p className="vf-error">{s.error}</p>}
      {s.hash && (
        <a className="vf-link" href={txUrl(CHAIN, s.hash)} target="_blank" rel="noreferrer">
          view transaction ↗
        </a>
      )}
    </>
  );
}

const STATUS_TEXT: Record<MyProjectStatus, string> = {
  verified: "verified",
  lapsed: "lapsed",
  missing: "no proof file",
  resign: "re-sign needed",
  unchecked: "couldn't be read",
  checking: "checking…",
  removed: "removed",
};

function statusDetail(st: MyProjectStatus, proof: ProjectProofState | undefined): string | null {
  if (st === "resign" && proof?.state === "resign")
    return `Its proof names ${shortAddr(proof.signer)}, not this wallet. Re-sign this project's proof with your current wallet.`;
  if (st === "lapsed" && proof?.state === "invalid") return `The proof does not check out: ${proof.reason}.`;
  if (st === "missing") return "No proof file where this project's proof belongs. Sign one and publish it.";
  if (st === "unchecked")
    return `The proof couldn't be read just now${proof?.state === "unchecked" && proof.reason ? ` (${proof.reason})` : ""}. Until it can be, the gallery shows this project as unconfirmed. Check the file is served at its address; a domain can also send Access-Control-Allow-Origin: * on /.well-known/registrai.json so browsers read it directly.`;
  return null;
}

function ProjectRows({
  b,
  proofs,
  onPick,
  onRemove,
  busy,
}: {
  b: MyBuilder;
  proofs: ReadonlyMap<number, ProjectProofState> | undefined;
  onPick: (source: string) => void;
  onRemove: (p: MyBuilder["projects"][number]) => void;
  busy: boolean;
}) {
  if (!b.projects.length) return <p className="vf-hint">No projects yet. Add one below.</p>;
  return (
    <ul className="vf-projects">
      {b.projects.map((p) => {
        const proof = proofs?.get(p.id);
        const st = myProjectStatus(p, proofs ? proof : undefined);
        const detail = statusDetail(st, proof);
        const fixable = st === "resign" || st === "lapsed" || st === "missing";
        return (
          <li key={p.id} data-status={st}>
            <div className="vf-projects-head">
              <a href={sourceHref(p.source)} target="_blank" rel="noreferrer" title={p.source}>
                {sourceLabel(p.source)} ↗
              </a>
              <span className="tnum">#{p.id}</span>
              <b>{STATUS_TEXT[st]}</b>
            </div>
            {detail && <p className="vf-hint">{detail}</p>}
            {fixable && (
              <button type="button" className="vf-mini vf-mini-strong" onClick={() => onPick(p.source)}>
                {st === "resign" ? "re-sign this proof" : "sign a new proof"}
              </button>
            )}
            {p.active && (
              <button type="button" className="vf-mini" onClick={() => onRemove(p)} disabled={busy}>
                remove project
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Owner: set the builder's display name (updateProfile), previewed as the gallery will show it. */
function EditName({ b, run, busy }: { b: MyBuilder; run: ReturnType<typeof useAction>["run"]; busy: boolean }) {
  const [name, setName] = useState(b.profileURI);
  const edit = profileEdit(name);
  const unchanged = edit.value === b.profileURI.trim();
  return (
    <details className="vf-details">
      <summary>Edit display name</summary>
      <p className="vf-note">
        Stored on the registry (<code>updateProfile</code>, at most {MAX_PROFILE_LEN} bytes). The gallery shows it only once
        the multisig has onboarded your builder, only if it is a plain name, and never over a name Registrai curated for
        your project.
      </p>
      <label className="vf-field">
        <span>Display name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="empty clears it" spellCheck={false} />
        <em className="tnum">
          {edit.bytes}/{MAX_PROFILE_LEN} bytes
        </em>
      </label>
      {edit.error ? (
        <p className="vf-error">{edit.error}</p>
      ) : (
        <p className="vf-hint">
          {!edit.value
            ? "Empty: the gallery names your builder after its project."
            : edit.shownAs
              ? `Shown as “${edit.shownAs}” once onboarded.`
              : "Not a plain name (a link, another script, or longer than 48 characters): the gallery names your builder after its project instead."}
        </p>
      )}
      <button
        type="button"
        className="vf-primary"
        disabled={busy || !edit.ok || unchanged}
        onClick={() =>
          run("saving…", edit.value ? `Display name set to “${edit.value}”.` : "Display name cleared.", {
            address: REG!, abi: verifiedBuilderAbi as Abi, functionName: "updateProfile", args: [edit.value],
          })
        }
      >
        save name
      </button>
    </details>
  );
}

/** Owner: propose a new wallet (two-step) or withdraw the proposal. */
function MoveWallet({ b, pendingOwner, run, busy }: { b: MyBuilder; pendingOwner: Address | null; run: ReturnType<typeof useAction>["run"]; busy: boolean }) {
  const [to, setTo] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function propose() {
    let existing = 0;
    if (isAddress(to.trim(), { strict: false })) {
      existing = Number(
        await buildersClient().readContract({ address: REG!, abi: verifiedBuilderAbi, functionName: "builderIdOf", args: [getAddress(to.trim())] }),
      );
    }
    const e = transferTargetError(to, { owner: b.owner, newOwnerBuilderId: existing });
    setErr(e);
    if (e) return;
    await run("proposing…", `Proposed. ${shortAddr(to.trim())} can now accept builder #${b.id} on this page.`, {
      address: REG!, abi: verifiedBuilderAbi as Abi, functionName: "proposeOwner", args: [getAddress(to.trim())],
    });
  }
  return (
    <details className="vf-details">
      <summary>Move to a new wallet</summary>
      <p className="vf-note">
        Two steps: propose the new wallet here, then connect that wallet on this page and accept. The new wallet must not
        hold a builder. Afterwards every project proof names this old wallet, so re-sign each one with the new wallet, and
        sync the badge. Lost this wallet instead? See <Link href="/guide#lost-wallet">the builder guide</Link>.
      </p>
      {pendingOwner && (
        <div className="vf-copyline">
          <code>Proposed: {pendingOwner}</code>
          <button
            type="button"
            className="vf-mini"
            disabled={busy}
            onClick={() =>
              run("withdrawing…", "Proposal withdrawn.", { address: REG!, abi: verifiedBuilderAbi as Abi, functionName: "proposeOwner", args: [zeroAddress] })
            }
          >
            withdraw
          </button>
        </div>
      )}
      <label className="vf-field">
        <span>New wallet</span>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" spellCheck={false} autoCapitalize="off" />
        <em />
      </label>
      {err && <p className="vf-error">{err}</p>}
      <button type="button" className="vf-primary" onClick={propose} disabled={busy || !to.trim()}>
        propose new owner
      </button>
    </details>
  );
}

/**
 * Where the builder stands and what happens next: nominated (registered, the
 * badge not issued yet) needs nothing from the builder but a published proof;
 * Registrai onboards it (caretaker + badge) in its next batch.
 */
function BuilderStatus({ active, hasBadge, proofsBroken }: { active: boolean; hasBadge: boolean; proofsBroken: boolean }) {
  if (!BADGE || !active || hasBadge) return null;
  if (proofsBroken) {
    return (
      <div className="vf-banner" role="status">
        <strong>Registered · proof not found</strong>
        <p>
          None of your projects&apos; proof files checks out right now, so you can&apos;t be verified yet. Publish the file
          again (or re-sign it below), then reload this page.
        </p>
      </div>
    );
  }
  return (
    <div className="vf-banner vf-banner-ok" role="status">
      <strong>Nominated · waiting for Registrai</strong>
      <p>
        Your claim is registered and checks out. To become <b>verified</b>, Registrai reviews it and onboards your builder
        in its next batch: that issues your Verified Builder Badge to this wallet. There&apos;s nothing else for you to do;
        just keep the proof file published. Your gallery card turns from Nominated to Verified when the badge is issued.
      </p>
    </div>
  );
}

/**
 * On /verify, for the connected wallet: its builder's projects with their
 * proof status (and re-sign prompts after an owner change), the project-slot
 * limit, moving to a new wallet, a pending recovery with its cancel, and the
 * badge sync after an owner change. For a wallet without a builder that was
 * proposed as some builder's new owner: accept it.
 */
export function MyBuilderPanel({ onPick }: { onPick: (source: string) => void }) {
  const { address } = useWallet();
  const me = useMyBuilder(address);
  const b = me.data?.builder ?? null;
  const proofs = useProjectProofs(b);
  const now = useNow();
  const act = useAction(async () => {
    await me.mutate();
    await proofs.mutate();
  });

  if (!REG || !address || !me.data) return null;

  if (!b) {
    const recovering = me.data.recovering;
    if (!me.data.acceptable.length && !recovering.length) return null;
    return (
      <section className="pp-action-card vf-me" aria-label="Accept ownership">
        {recovering.map((r) => {
          const view = recoveryView({ newOwner: address, readyAt: r.readyAt }, now);
          return (
            <div key={`rec-${r.builderId}`} className="vf-banner" role="status">
              <strong>Recovery to this wallet: builder #{r.builderId}</strong>
              <p>
                The Registrai multisig started moving builder #{r.builderId} to this wallet.{" "}
                {view.kind === "waiting"
                  ? `Its current owner can cancel it until ${utcMinute(r.readyAt)} (in ${formatCountdown(view.secondsLeft)}); after that anyone can complete it.`
                  : "Its waiting period is over: complete it now. Afterwards re-sign each project's proof with this wallet and sync the badge."}
              </p>
              {showFinishRecovery({ viewer: address, owner: null, recovery: { newOwner: address, readyAt: r.readyAt } }, now) && (
                <button
                  type="button"
                  className="vf-primary"
                  disabled={act.busy}
                  onClick={() =>
                    act.run("finishing…", `Builder #${r.builderId} now belongs to this wallet. Re-sign its projects' proofs and sync its badge below.`, {
                      address: REG!, abi: verifiedBuilderAbi as Abi, functionName: "finishRecovery", args: [BigInt(r.builderId)],
                    })
                  }
                >
                  finish recovery
                </button>
              )}
            </div>
          );
        })}
        {me.data.acceptable.length > 0 && <div className="pp-card-label">A builder was proposed to this wallet</div>}
        {me.data.acceptable.map((id) => (
          <div key={id} className="vf-copyline">
            <code>Builder #{id}</code>
            <button
              type="button"
              className="vf-mini vf-mini-strong"
              disabled={act.busy}
              onClick={() =>
                act.run("accepting…", `This wallet now owns builder #${id}. Re-sign its projects' proofs and sync its badge below.`, {
                  address: REG!, abi: verifiedBuilderAbi as Abi, functionName: "acceptOwnership", args: [BigInt(id)],
                })
              }
            >
              accept ownership
            </button>
          </div>
        ))}
        <ActionResult s={act.state} />
      </section>
    );
  }

  const slots = projectSlots(b);
  const name = plainProfileName(b.profileURI) ?? (b.projects[0] ? sourceLabel(b.projects[0].source) : `Builder #${b.id}`);
  const rec = recoveryView(me.data.recovery, now);
  const badge = me.data.badge;
  const needsSync = Boolean(BADGE && badge && badgeNeedsSync(badge.holder, b.owner));

  return (
    <section className="pp-action-card vf-me" aria-label={`Your builder #${b.id}`}>
      <div className="pp-panel-heading">
        <span>{name}</span>
        <b>builder #{b.id}</b>
      </div>

      <BuilderStatus
        active={b.active}
        hasBadge={Boolean(badge)}
        proofsBroken={
          Boolean(proofs.data) &&
          b.projects.filter((p) => p.active).every((p) => {
            const st = proofs.data?.get(p.id)?.state;
            return st !== undefined && st !== "valid" && st !== "unchecked";
          })
        }
      />

      {rec.kind !== "none" && (
        <div className="vf-banner" role="alert">
          <strong>Recovery pending</strong>
          <p>
            The Registrai multisig started moving builder #{b.id} to <b className="tnum">{shortAddr(rec.newOwner)}</b>.{" "}
            {rec.kind === "waiting"
              ? `It can complete on ${utcMinute(rec.readyAt)} (in ${formatCountdown(rec.secondsLeft)}).`
              : "Its waiting period is over: anyone can complete it now."}{" "}
            If you did not ask for this, cancel it.
          </p>
          <span className="adm-actions">
            <button
              type="button"
              className="vf-primary"
              disabled={act.busy}
              onClick={() =>
                act.run("cancelling…", "Recovery cancelled.", { address: REG!, abi: verifiedBuilderAbi as Abi, functionName: "cancelRecovery", args: [BigInt(b.id)] })
              }
            >
              cancel recovery
            </button>
            {showFinishRecovery({ viewer: address, owner: b.owner, recovery: me.data.recovery }, now) && (
              <button
                type="button"
                className="vf-mini"
                disabled={act.busy}
                onClick={() =>
                  act.run("finishing…", `Recovery finished: builder #${b.id} moved to ${shortAddr(rec.newOwner)}.`, {
                    address: REG!, abi: verifiedBuilderAbi as Abi, functionName: "finishRecovery", args: [BigInt(b.id)],
                  })
                }
              >
                finish recovery
              </button>
            )}
          </span>
        </div>
      )}

      {!b.active && <p className="vf-error">This builder is deactivated on the registry; it cannot add projects.</p>}

      <p className="vf-hint">
        {slots.used} of {MAX_PROJECTS_PER_BUILDER} project slots used: a removed project keeps its slot, so the 16 count every
        project ever added. A project source is at most {MAX_SOURCE_LEN} bytes.
      </p>
      <ProjectRows
        b={b}
        proofs={proofs.data}
        onPick={onPick}
        busy={act.busy}
        onRemove={(p) => {
          if (
            !window.confirm(
              `Remove ${sourceLabel(p.source)} (project #${p.id}) from builder #${b.id}? It leaves the gallery. ${removeProjectNote(b)}`,
            )
          )
            return;
          act.run("removing…", `${sourceLabel(p.source)} removed.`, {
            address: REG!, abi: verifiedBuilderAbi as Abi, functionName: "removeProject", args: [BigInt(p.id)],
          });
        }}
      />
      {b.active && slots.left > 0 && (
        <button type="button" className="vf-mini" onClick={() => onPick("")}>
          + add a project
        </button>
      )}

      {needsSync && badge && (
        <div className="vf-copyline">
          <code>
            Badge {serialLabel(badge.serial)} is held by {badge.holder ? shortAddr(badge.holder) : "another wallet"}
          </code>
          <button
            type="button"
            className="vf-mini vf-mini-strong"
            disabled={act.busy}
            onClick={() =>
              act.run("syncing…", `Badge ${serialLabel(badge.serial)} moved to this wallet.`, {
                address: BADGE!, abi: badgeAbi as Abi, functionName: "sync", args: [BigInt(b.id)],
              })
            }
          >
            sync badge
          </button>
        </div>
      )}

      <EditName key={b.profileURI} b={b} run={act.run} busy={act.busy} />

      <MoveWallet b={b} pendingOwner={me.data.pendingOwner} run={act.run} busy={act.busy} />

      {act.state.pending && <p className="vf-hint">{act.state.pending}</p>}
      <ActionResult s={act.state} />
      <Link className="vf-link" href={`/builders?builder=${b.id}`}>
        see your card in the gallery →
      </Link>
    </section>
  );
}
