"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import useSWR from "swr";
import { createPublicClient, getAddress, isAddress, type Abi, type Address, type Hex, type PublicClient } from "viem";
import { useWallet } from "@/components/WalletProvider";
import { BUILDERS } from "@/lib/builders-network";
import { transportFor } from "@/lib/chains";
import { shortAddr } from "@/lib/format";
import { humanizeError } from "@/lib/humanize-error";
import {
  browserProofCheck,
  builderName,
  displayKind,
  projectChipKind,
  sourceHref,
  xHref,
  type GalleryBuilder,
  type GalleryReader,
} from "@/lib/builders-gallery";
import {
  checkpointFromJson, checkpointToJson, readRevokedBuilders, type LogReader, type RevocationCheckpoint,
} from "@/lib/badge-revocations";
import { ADMIN_SERVICE, adminLoginMessage, adminView, inviteDm, type AdminRole, type AdminView, type InviteRecord } from "@/lib/builders-admin";
import {
  cancelRecoverySafeFile,
  deactivateProjectSafeFile,
  inviteChainStatus,
  needsFollowUp,
  onboardingQueue,
  onboardingSafeFile,
  readAdminChain,
  readRecoveries,
  revokeSafeFile,
  safeFileName,
  startRecoverySafeFile,
  type InviteChainStatus,
  type PendingRecovery,
} from "@/lib/builders-admin-chain";
import { formatCountdown, recoveryView, transferTargetError, utcMinute } from "@/lib/builder-ownership";
import { verifiedBuilderAbi } from "@/lib/verified-builders-chain";
import { badgeImageBase, serialLabel } from "@/lib/verified-builder-badge";
import { suggestionInvite, type AdminSuggestion } from "@/lib/suggestions";
import { normalizeSource, sourceLabel } from "@/lib/verified-builders";
import {
  onboardStepCall,
  onboarderGate,
  onboarderRoles,
  planOnboardSteps,
  readBuilderForOnboarding,
  recheckOnboardingProofs,
} from "@/lib/builders-onboarder";
import { activeProvider } from "@/lib/wallets";
import { gaslessCandidates, gaslessState, type GaslessRequest } from "@/lib/gasless-registrations";
import { planOnboarding, safeBatchJson, singleTxSafeFile } from "@/lib/onboard-batch";
import { NOMINATIONS, nominationTx, nominationsAbi, profileHash, readNominations, type Nomination, type NominationsReader } from "@/lib/nominations";
import { profileOfListItem, projectPath, type ProjectListItem, type ProjectProfile } from "@/lib/projects";
import { draftStep, type NominationDraft } from "@/lib/drafts";
import { sendBuildersTx } from "@/components/verify/sendTx";
import { buildersClient } from "@/components/verify/useMyBuilder";
import { useWonderContext, WonderStatusProvider } from "@/components/wonder/WonderBits";
import { releaseView, usd, waitingAmount, WONDER_ON_BUILDERS, wonderMarketsAbi } from "@/lib/wonder";
import { cancelReleaseSafeFile, nominateInput, nominateSafeFile } from "@/lib/wonder-admin";

const REG = BUILDERS.contracts.BuilderRegistry;
const CARE = BUILDERS.contracts.CaretakerRegistry;
const BADGE = BUILDERS.contracts.VerifiedBuilderBadge;
const OPERATOR = BUILDERS.operator;
const HUMAN = { testnet: BUILDERS.chain.testnet, networkName: BUILDERS.label };
const BUILDERS_SITE = "https://builder.registrai.cc";
const CLI = `npx tsx scripts/onboard-batch.ts --network ${BUILDERS.network}${BUILDERS.badgesOn && BADGE ? ` --badge ${BADGE}` : ""}`;

type AdminInvite = InviteRecord & { claimLink: string };
type ApiState = { state: "checking" } | { state: "unavailable" } | { state: "ready"; address: string | null; role: AdminRole | null };

/** What the signed-in role may see and do (adminView); read by the rows and sections below. */
const ViewCtx = createContext<AdminView>(adminView("admin"));

class SignedOut extends Error {}

/** Same-origin JSON call; a JSON body (or none) and the parsed reply. */
async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: T }> {
  const method = init.method ?? "GET";
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: method === "GET" ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(init.body ?? {}),
  });
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

const isoDay = (iso: string | undefined) => (iso ? iso.slice(0, 10) : null);

function download(name: string, data: unknown) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
          // clipboard blocked: the text is on screen
        }
      }}
    >
      {done ? "copied" : label}
    </button>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="adm-section">
      <header className="adm-section-head">
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

// ───────────────────────────── entry ─────────────────────────────

/**
 * /admin. Works only where the builders-site Functions run (builder.registrai.cc):
 * anywhere else /api/auth/me is not the admin API and the page says so.
 */
/** Revocation checkpoints: the one shipped in live-data.json and, newer, the last one this browser read. */
const REVOCATION_CACHE = (chainId: number, badge: string) => `registrai-admin:revocations:${chainId}:${badge.toLowerCase()}`;

function bestRevocationCheckpoint(
  shipped: unknown,
  want: { chainId: number; badge: Address; registry: Address },
): RevocationCheckpoint | null {
  let cached: RevocationCheckpoint | null = null;
  try {
    const raw = window.localStorage.getItem(REVOCATION_CACHE(want.chainId, want.badge));
    cached = raw ? checkpointFromJson(JSON.parse(raw), want) : null;
  } catch {
    // no storage, or unreadable: the shipped checkpoint (or the deploy block) it is
  }
  const fromBuild = checkpointFromJson(shipped, want);
  if (!cached) return fromBuild;
  if (!fromBuild) return cached;
  return cached.toBlock > fromBuild.toBlock ? cached : fromBuild;
}

function saveRevocationCheckpoint(c: RevocationCheckpoint) {
  try {
    window.localStorage.setItem(REVOCATION_CACHE(c.chainId, c.badge), JSON.stringify(checkpointToJson(c)));
  } catch {
    // storage full or blocked: the next visit reads from the shipped checkpoint again
  }
}

/** `revocationCheckpoint`: live-data.json `revocations` (scripts/sync.ts), passed by the page. */
export function AdminApp({ revocationCheckpoint = null }: { revocationCheckpoint?: unknown }) {
  const [api, setApi] = useState<ApiState>({ state: "checking" });
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
        if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/json")) throw new Error("no api");
        const me = (await res.json()) as { service?: string; address?: string | null; role?: AdminRole | null };
        if (me.service !== ADMIN_SERVICE) throw new Error("not the admin api");
        if (!off) setApi({ state: "ready", address: me.address ?? null, role: me.role ?? (me.address ? "admin" : null) });
      } catch {
        if (!off) setApi({ state: "unavailable" });
      }
    })();
    return () => {
      off = true;
    };
  }, []);

  return (
    <>
      <header className="perennial-app-header">
        <div>
          <div className="perennial-app-status">
            <i /> {BUILDERS.label} · admin
          </div>
          <h1>Builders admin</h1>
          <p>
            Invites, the onboarding queue, badge actions, recoveries and projects. What only the Safe may do (revokes,
            recoveries, project switches) is a Safe batch file. This page sends two kinds of transaction itself:
            onboarding, from an onboarder wallet the Safe gave its two roles, and finishing a recovery (anyone may).
          </p>
        </div>
      </header>

      {api.state === "checking" && <p className="vf-hint">Checking the admin API…</p>}
      {api.state === "unavailable" && (
        <div className="bld-empty">
          <p>Admin runs on builder.registrai.cc.</p>
          <a className="vf-link" href={`${BUILDERS_SITE}/admin/`}>
            Open {BUILDERS_SITE.replace("https://", "")}/admin →
          </a>
        </div>
      )}
      {api.state === "ready" && !api.address && <SignIn onSignedIn={(address, role) => setApi({ state: "ready", address, role })} />}
      {api.state === "ready" && api.address && (
        <Dashboard
          admin={api.address}
          role={api.role ?? "admin"}
          revocationCheckpoint={revocationCheckpoint}
          onSignedOut={() => setApi({ state: "ready", address: null, role: null })}
        />
      )}
    </>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (address: string, role: AdminRole) => void }) {
  const { address, connect, isConnecting, walletClient, error: walletError } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function signIn() {
    if (!address || !walletClient) return;
    setBusy(true);
    setError(undefined);
    try {
      const n = await call<{ nonce?: string; error?: string }>("/api/auth/nonce");
      if (!n.body.nonce) throw new Error(n.body.error ?? `no nonce (${n.status})`);
      const message = adminLoginMessage({ origin: window.location.origin, nonce: n.body.nonce, issued: new Date().toISOString() });
      const signature = await walletClient.signMessage({ account: address, message });
      const r = await call<{ address?: string; role?: AdminRole; error?: string }>("/api/auth/login", { method: "POST", body: { message, signature } });
      if (r.status !== 200 || !r.body.address) throw new Error(r.body.error ?? `sign-in failed (${r.status})`);
      onSignedIn(r.body.address, r.body.role ?? "admin");
    } catch (e) {
      setError(humanizeError(e, HUMAN));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Sign in">
      <p className="vf-note">
        Sign a one-time message with an admin wallet. It is not a transaction and costs nothing; the session lasts 12
        hours.
      </p>
      {!address ? (
        <button type="button" className="vf-primary" onClick={connect} disabled={isConnecting}>
          {isConnecting ? "connecting…" : "Connect wallet"}
        </button>
      ) : (
        <button type="button" className="vf-primary" onClick={signIn} disabled={busy || !walletClient}>
          {busy ? "check your wallet…" : `Sign in as ${shortAddr(address)}`}
        </button>
      )}
      {(error || walletError) && <p className="vf-error">{error ?? walletError}</p>}
    </Section>
  );
}

// ───────────────────────────── dashboard ─────────────────────────────

async function readChain(): Promise<GalleryBuilder[]> {
  const client = createPublicClient({
    chain: BUILDERS.chain.viemChain,
    transport: transportFor(BUILDERS.chain, { batch: true }),
  }) as PublicClient;
  return readAdminChain(client as unknown as GalleryReader, {
    registry: REG!,
    caretakers: CARE,
    badge: BUILDERS.badgesOn ? BADGE : null,
    imageBase: badgeImageBase(BUILDERS.badgeNetwork ?? "arc"),
    operator: OPERATOR,
    chainId: BUILDERS.chainId,
  });
}

function Dashboard({
  admin,
  role,
  revocationCheckpoint,
  onSignedOut,
}: {
  admin: string;
  role: AdminRole;
  revocationCheckpoint: unknown;
  onSignedOut: () => void;
}) {
  const invites = useSWR<AdminInvite[]>(
    "admin-invites",
    async () => {
      const r = await call<{ invites?: AdminInvite[]; error?: string }>("/api/admin/invites");
      if (r.status === 401) throw new SignedOut();
      if (r.status !== 200 || !r.body.invites) throw new Error(r.body.error ?? `invites (${r.status})`);
      return r.body.invites;
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  useEffect(() => {
    if (invites.error instanceof SignedOut) onSignedOut();
  }, [invites.error, onSignedOut]);

  // A rate-limited read is retried a few times with a pause instead of leaving
  // every section on "Could not read" until "Re-read chain" is clicked.
  const chain = useSWR(REG ? ["admin-chain", BUILDERS.chainId, REG] : null, readChain, {
    revalidateOnFocus: false,
    errorRetryCount: 4,
    errorRetryInterval: 8_000,
  });

  /** The gallery's name rule (builderName), with the admin's invite names as the curated names. */
  const nameOf = useCallback(
    (b: GalleryBuilder) => {
      const named = b.projects
        .filter((p) => p.active)
        .map((p) => invites.data?.find((i) => i.source === p.source))
        .filter((i): i is AdminInvite => Boolean(i));
      return builderName(b, named, displayKind(b) === "verified");
    },
    [invites.data],
  );

  async function signOut() {
    await call("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    onSignedOut();
  }

  const chainNote = !REG
    ? `No builder registry on ${BUILDERS.label}: chain status is unavailable.`
    : chain.error
      ? `Could not read ${BUILDERS.label}: ${humanizeError(chain.error, HUMAN)}`
      : !chain.data
        ? `Reading ${BUILDERS.label} and checking every proof…`
        : null;

  const wonderSources = WONDER_ON_BUILDERS ? (invites.data ?? []).map((i) => i.source) : [];
  const view = adminView(role);
  return (
    <ViewCtx.Provider value={view}>
    <WonderStatusProvider sources={wonderSources}>
      <div className="adm-stack">
        <div className="adm-bar">
          <span>
            Signed in as <b className="tnum">{shortAddr(admin)}</b>
            {role === "onboarder" && <> · onboarder: you can read everything here and onboard builders from this wallet</>}
          </span>
          <span className="adm-bar-actions">
            {REG && (
              <button type="button" className="vf-mini" onClick={() => chain.mutate()} disabled={chain.isValidating}>
                {chain.isValidating ? "reading chain…" : "re-read chain"}
              </button>
            )}
            <button type="button" className="vf-mini" onClick={signOut}>
              sign out
            </button>
          </span>
        </div>

        {view.inviteForm && <InviteForm onChanged={() => invites.mutate()} />}

        <InvitesTable
          invites={invites.data}
          error={invites.error && !(invites.error instanceof SignedOut) ? String((invites.error as Error).message) : null}
          builders={chain.data ?? null}
          chainNote={chainNote}
          onChanged={() => invites.mutate()}
        />

        <SuggestionsSection onInvited={() => invites.mutate()} onSignedOut={onSignedOut} />

        <GaslessSection builders={chain.data ?? null} chainNote={chainNote} onSignedOut={onSignedOut} />

        <OnboardingSection
          builders={chain.data ?? null}
          chainNote={chainNote}
          nameOf={nameOf}
          revocationCheckpoint={revocationCheckpoint}
          onChainChanged={() => chain.mutate()}
        />

        {view.badges && <BadgeSection builders={chain.data ?? null} chainNote={chainNote} nameOf={nameOf} />}

        {view.recovery && <RecoverySection builders={chain.data ?? null} chainNote={chainNote} nameOf={nameOf} />}

        {view.projects && <ProjectsSection builders={chain.data ?? null} chainNote={chainNote} nameOf={nameOf} />}

        {view.directOnboard && NOMINATIONS && (
          <NominationsSection invites={invites.data ?? []} onInvitesChanged={() => invites.mutate()} builders={chain.data ?? null} />
        )}

        {view.wonder && WONDER_ON_BUILDERS && <WonderSection invites={invites.data ?? []} />}
      </div>
    </WonderStatusProvider>
    </ViewCtx.Provider>
  );
}

// ───────────────────────────── invite a project ─────────────────────────────

function InviteLink({ invite, existed }: { invite: AdminInvite; existed: boolean }) {
  const wonder = useWonderContext();
  const dm = inviteDm(invite, invite.claimLink, waitingAmount(wonder.status[invite.source], Math.floor(Date.now() / 1000), wonder.expiry));
  return (
    <div className="adm-result">
      <p className={existed ? "vf-error" : "vf-ok"}>
        {existed
          ? `Already invited on ${isoDay(invite.createdAt)}: here is its existing link.`
          : `Invited. ${invite.name ?? sourceLabel(invite.source)} is listed as Invited on the gallery.`}
      </p>
      <div className="vf-copyline">
        <code>{invite.claimLink}</code>
        <CopyButton text={invite.claimLink} label="copy link" />
      </div>
      <div className="vf-file-head">
        <span>DM for {invite.x ?? "X"}</span>
        <span>
          <CopyButton text={dm} label="copy DM" />
          {invite.x && (
            <a className="vf-mini" href={xHref(invite.x)} target="_blank" rel="noreferrer">
              open X ↗
            </a>
          )}
        </span>
      </div>
      <pre className="vf-pre adm-dm">{dm}</pre>
    </div>
  );
}

function InviteForm({ onChanged }: { onChanged: () => void }) {
  const [source, setSource] = useState("");
  const [name, setName] = useState("");
  const [x, setX] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<{ invite: AdminInvite; existed: boolean } | null>(null);
  const normalized = source.trim() ? normalizeSource(source) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!normalized) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await call<{ invite?: AdminInvite; error?: string }>("/api/admin/invites", {
        method: "POST",
        body: { source: normalized, name, x, note },
      });
      if ((r.status === 201 || r.status === 409) && r.body.invite) {
        setResult({ invite: r.body.invite, existed: r.status === 409 });
        if (r.status === 201) {
          setSource("");
          setName("");
          setX("");
          setNote("");
          onChanged();
        }
      } else {
        setError(r.body.error ?? `could not create the invite (${r.status})`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Invite a project">
      <p className="vf-note">
        Lists the project on the gallery as <b>Invited</b> and makes a personal claim link. DM it on X yourself; opens
        of the link are tracked below.
      </p>
      <form className="adm-form" onSubmit={submit}>
        <label className="vf-field">
          <span>Project</span>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="github.com/owner/repo, owner/repo or a domain"
            spellCheck={false}
            autoCapitalize="off"
            required
          />
          <em>{source.trim() ? (normalized ?? "not a repo or domain") : ""}</em>
        </label>
        <label className="vf-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="shown on the gallery" />
          <em />
        </label>
        <label className="vf-field">
          <span>X handle</span>
          <input value={x} onChange={(e) => setX(e.target.value)} maxLength={16} placeholder="@handle" spellCheck={false} autoCapitalize="off" />
          <em />
        </label>
        <label className="vf-field">
          <span>Private note</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder="never shown publicly" />
          <em>{note.length ? `${note.length}/500` : ""}</em>
        </label>
        <div>
          <button type="submit" className="vf-primary" disabled={busy || !normalized}>
            {busy ? "creating…" : "Create invite"}
          </button>
        </div>
      </form>
      {error && <p className="vf-error">{error}</p>}
      {result && <InviteLink invite={result.invite} existed={result.existed} />}
    </Section>
  );
}

// ───────────────────────────── public suggestions ─────────────────────────────

function SuggestionsSection({ onInvited, onSignedOut }: { onInvited: () => void; onSignedOut: () => void }) {
  const view = useContext(ViewCtx);
  const list = useSWR<AdminSuggestion[]>(
    "admin-suggestions",
    async () => {
      const r = await call<{ suggestions?: AdminSuggestion[]; error?: string }>("/api/admin/suggestions");
      if (r.status === 401) throw new SignedOut();
      if (r.status !== 200 || !r.body.suggestions) throw new Error(r.body.error ?? `suggestions (${r.status})`);
      return r.body.suggestions;
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  useEffect(() => {
    if (list.error instanceof SignedOut) onSignedOut();
  }, [list.error, onSignedOut]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  async function dismiss(source: string) {
    await call(`/api/admin/suggestions?source=${encodeURIComponent(source)}`, { method: "DELETE" });
    await list.mutate();
  }

  async function invite(s: AdminSuggestion) {
    setBusy(s.source);
    setMsg({});
    try {
      const r = await call<{ invite?: AdminInvite; error?: string }>("/api/admin/invites", { method: "POST", body: suggestionInvite(s) });
      if ((r.status === 201 || r.status === 409) && r.body.invite) {
        await dismiss(s.source);
        onInvited();
        setMsg({ ok: r.status === 201 ? `Invited ${s.name}: its claim link is in the invites list.` : `${s.name} was already invited.` });
      } else {
        setMsg({ error: r.body.error ?? `could not invite (${r.status})` });
      }
    } catch (err) {
      setMsg({ error: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title="Suggestions">
      <p className="vf-note">
        Projects the public suggested at /suggest (website plus X or another public link). Check the social proof, then invite: the
        evidence goes into the invite&apos;s private note. Nothing is public until you invite.
      </p>
      {list.error && !(list.error instanceof SignedOut) ? (
        <p className="vf-error">Could not read the suggestions: {(list.error as Error).message}</p>
      ) : !list.data ? (
        <p className="vf-hint">Reading suggestions…</p>
      ) : list.data.length === 0 ? (
        <p className="vf-hint">No open suggestions.</p>
      ) : (
        <ul className="adm-list">
          {list.data.map((s) => (
            <li key={s.source}>
              <b>{s.name}</b> <span className="adm-sub">{sourceLabel(s.source)} · ×{s.count} · last {isoDay(s.lastAt)}</span>
              <div className="adm-sub">
                <a href={s.website} target="_blank" rel="noreferrer noopener">{s.website} ↗</a>
                {s.x && <> · <a href={xHref(s.x)} target="_blank" rel="noreferrer noopener">{s.x} ↗</a></>}
                {s.social && <> · <a href={s.social} target="_blank" rel="noreferrer noopener">{s.social} ↗</a></>}
                {s.github && <> · <a href={sourceHref(s.github)} target="_blank" rel="noreferrer noopener">{sourceLabel(s.github)} ↗</a></>}
                {!s.github && <> · no GitHub repo: no markets</>}
              </div>
              {s.why && <div className="adm-sub">“{s.why}”</div>}
              {s.by.length > 0 && <div className="adm-sub">by {s.by.join(", ")}</div>}
              {s.wallets?.length > 0 && (
                <div className="adm-sub">
                  signed by{" "}
                  {s.wallets.slice(0, 5).map((w, i) => (
                    <span key={w}>
                      {i > 0 && ", "}
                      <a href={`${BUILDERS.explorer.url.replace(/\/$/, "")}/address/${w}`} target="_blank" rel="noreferrer noopener">{shortAddr(w)}</a>
                    </span>
                  ))}
                  {s.wallets.length > 5 && ` +${s.wallets.length - 5}`}
                </div>
              )}
              {view.inviteForm && (
                <span className="flex gap-2">
                  <button type="button" className="vf-mini" disabled={busy !== null} onClick={() => invite(s)}>
                    {busy === s.source ? "inviting…" : "invite"}
                  </button>
                  <button type="button" className="vf-mini" disabled={busy !== null} onClick={() => dismiss(s.source)}>
                    dismiss
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg.ok && <p className="vf-ok">{msg.ok}</p>}
      {msg.error && <p className="vf-error">{msg.error}</p>}
    </Section>
  );
}

// ───────────────────────────── invites & tracking ─────────────────────────────

function StatusChip({ s }: { s: InviteChainStatus | null }) {
  if (!s) return <span className="bld-chip">…</span>;
  if (s.kind === "invited") return <span className="bld-chip" data-kind="invited">Invited</span>;
  if (s.kind === "verified")
    return (
      <span className="bld-chip" data-kind="verified" title={`builder #${s.builderId}`}>
        Verified{s.serial ? ` · ${serialLabel(s.serial)}` : ""}
      </span>
    );
  if (s.kind === "nominated")
    return (
      <span className="bld-chip" data-kind="nominated" title={`builder #${s.builderId}${s.unchecked ? " · proof not readable just now" : ""}`}>
        Nominated{s.unchecked ? " · unchecked" : ""}
      </span>
    );
  if (s.kind === "unconfirmed")
    return (
      <span className="bld-chip" data-kind="unconfirmed" title={`builder #${s.builderId} holds it, but its proof couldn't be read: the gallery still shows the invite`}>
        Unconfirmed · #{s.builderId}
      </span>
    );
  return (
    <span className="bld-chip" data-kind="lapsed" title={`builder #${s.builderId} holds it without a proof that checks out: the gallery still shows the invite`}>
      Lapsed · #{s.builderId}
    </span>
  );
}

function InviteRow({ inv, status, onChanged }: { inv: AdminInvite; status: InviteChainStatus | null; onChanged: () => void }) {
  const wonder = useWonderContext();
  const [editing, setEditing] = useState(false);
  const view = useContext(ViewCtx);
  const [name, setName] = useState(inv.name ?? "");
  const [x, setX] = useState(inv.x ?? "");
  const [note, setNote] = useState(inv.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    setBusy(true);
    setError(undefined);
    const r = await call<{ error?: string }>("/api/admin/invites", { method: "PATCH", body: { source: inv.source, name, x, note } }).catch(
      (e: Error) => ({ status: 0, body: { error: e.message } }),
    );
    setBusy(false);
    if (r.status === 200) {
      setEditing(false);
      onChanged();
    } else setError(r.body.error ?? `could not save (${r.status})`);
  }

  async function remove() {
    const label = inv.name ?? sourceLabel(inv.source);
    if (!window.confirm(`Delete the invite for ${label}? It leaves the gallery's invited list and its link stops being tracked.`)) return;
    setBusy(true);
    const r = await call<{ error?: string }>(`/api/admin/invites?source=${encodeURIComponent(inv.source)}`, { method: "DELETE" }).catch(
      (e: Error) => ({ status: 0, body: { error: e.message } }),
    );
    setBusy(false);
    if (r.status === 200) onChanged();
    else setError(r.body.error ?? `could not delete (${r.status})`);
  }

  return (
    <tr>
      <td>
        <b>{inv.name ?? sourceLabel(inv.source)}</b>
        <a className="adm-sub" href={sourceHref(inv.source)} target="_blank" rel="noreferrer">
          {sourceLabel(inv.source)} ↗
        </a>
        {editing ? (
          <div className="adm-edit">
            <label className="vf-field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              <em />
            </label>
            <label className="vf-field">
              <span>X handle</span>
              <input value={x} onChange={(e) => setX(e.target.value)} maxLength={16} spellCheck={false} />
              <em />
            </label>
            <label className="vf-field">
              <span>Private note</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} />
              <em />
            </label>
            <span className="adm-actions">
              <button type="button" className="vf-mini vf-mini-strong" onClick={save} disabled={busy}>
                save
              </button>
              <button type="button" className="vf-mini" onClick={() => setEditing(false)} disabled={busy}>
                cancel
              </button>
            </span>
          </div>
        ) : (
          inv.note && <span className="adm-note">{inv.note}</span>
        )}
        {error && <span className="vf-error">{error}</span>}
      </td>
      <td>
        {inv.x ? (
          <a href={xHref(inv.x)} target="_blank" rel="noreferrer">
            {inv.x}
          </a>
        ) : (
          "—"
        )}
      </td>
      <td className="tnum">{isoDay(inv.createdAt)}</td>
      <td>
        <span className="adm-actions">
          <CopyButton text={inv.claimLink} label="link" />
          <CopyButton text={inviteDm(inv, inv.claimLink, waitingAmount(wonder.status[inv.source], Math.floor(Date.now() / 1000), wonder.expiry))} label="DM" />
        </span>
      </td>
      <td className="tnum">
        {inv.opens}
        <span className="adm-sub">{inv.firstOpenedAt ? `first ${isoDay(inv.firstOpenedAt)}` : "never opened"}</span>
      </td>
      <td>
        <StatusChip s={status} />
      </td>
      <td>
        {!editing && view.editInvites && (
          <span className="adm-actions">
            <button type="button" className="vf-mini" onClick={() => setEditing(true)} disabled={busy}>
              edit
            </button>
            <button type="button" className="vf-mini" onClick={remove} disabled={busy}>
              delete
            </button>
          </span>
        )}
      </td>
    </tr>
  );
}

function InvitesTable({
  invites,
  error,
  builders,
  chainNote,
  onChanged,
}: {
  invites: AdminInvite[] | undefined;
  error: string | null;
  builders: GalleryBuilder[] | null;
  chainNote: string | null;
  onChanged: () => void;
}) {
  const [followUp, setFollowUp] = useState(false);
  const now = Date.now();
  const rows = useMemo(
    () => (invites ?? []).map((inv) => ({ inv, status: builders ? inviteChainStatus(inv.source, builders) : null })),
    [invites, builders],
  );
  // Without a chain read every invite counts as not claimed.
  const chase = rows.filter((r) => needsFollowUp(r.inv, r.status ?? { kind: "invited" }, now));
  const shown = followUp ? chase : rows;

  return (
    <Section
      title="Invites & tracking"
      aside={
        <div className="bld-chips" role="group" aria-label="Filter invites">
          <button type="button" aria-pressed={!followUp} onClick={() => setFollowUp(false)}>
            All <span className="tnum">{rows.length}</span>
          </button>
          <button type="button" aria-pressed={followUp} onClick={() => setFollowUp(true)} title="Not opened after 3 days, or opened but not claimed">
            Needs follow-up <span className="tnum">{chase.length}</span>
          </button>
        </div>
      }
    >
      {chainNote && <p className="vf-hint">{chainNote}</p>}
      {error && <p className="vf-error">{error}</p>}
      {!invites && !error ? (
        <p className="vf-hint">Loading invites…</p>
      ) : shown.length === 0 ? (
        <p className="vf-hint">{followUp ? "Nobody to chase." : "No invites yet."}</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>X</th>
                <th>Created</th>
                <th>Copy</th>
                <th>Opens</th>
                <th>Chain</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map(({ inv, status }) => (
                <InviteRow key={inv.source} inv={inv} status={status} onChanged={onChanged} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ───────────────────────────── onboarding queue ─────────────────────────────

/** One builder's direct onboarding, as this page ran it. */
type OnboardRun = {
  name: string;
  state: "running" | "done" | "error";
  txs: { label: string; hash?: Hex; confirmed?: boolean }[];
  note?: string;
  error?: string;
};

const txHref = (hash: string) => `${BUILDERS.explorer.url}/tx/${hash}`;

function OnboardRunLine({ run }: { run: OnboardRun }) {
  return (
    <span className="adm-run">
      {run.txs.map((t, i) => (
        <span key={i}>
          <code>{t.label}</code>{" "}
          {t.hash ? (
            <a className="vf-link" href={txHref(t.hash)} target="_blank" rel="noreferrer">
              {t.confirmed ? "confirmed" : "sent, waiting for the receipt"} · {shortAddr(t.hash)} ↗
            </a>
          ) : (
            <span className="adm-sub">{run.state === "running" ? "waiting" : "not sent"}</span>
          )}
        </span>
      ))}
      {run.note && <span className={run.state === "done" ? "vf-ok" : "vf-hint"}>{run.note}</span>}
      {run.error && <span className="vf-error">{run.error}</span>}
    </span>
  );
}

/** The wallet must be on the builders chain: switch it, then check it really is (a rejected switch does not throw). */
async function ensureBuildersChain(walletChainId: number | undefined, switchChain: (id?: number) => Promise<void>) {
  if (walletChainId !== BUILDERS.chainId) await switchChain(BUILDERS.chainId);
  const id = await activeProvider()?.request({ method: "eth_chainId" }).catch(() => undefined);
  if (Number(id) !== BUILDERS.chainId) {
    throw new Error(`Your wallet is not on ${BUILDERS.label} (chain ${BUILDERS.chainId}). Switch networks and try again.`);
  }
}

/**
 * "Register it for me" requests from /verify (builders without gas): each
 * proof re-checked against the requesting wallet, then registerFor /
 * addProjectFor in a Safe batch (REGISTRAR = the Safe). A new wallet takes two
 * batches; a registered request drops out once its project is on-chain, and
 * the onboarding queue below takes it from there.
 */
function GaslessSection({
  builders,
  chainNote,
  onSignedOut,
}: {
  builders: GalleryBuilder[] | null;
  chainNote: string | null;
  onSignedOut: () => void;
}) {
  const view = useContext(ViewCtx);
  const requests = useSWR<GaslessRequest[]>(
    "admin-register-requests",
    async () => {
      const r = await call<{ requests?: GaslessRequest[]; error?: string }>("/api/admin/register-requests");
      if (r.status === 401) throw new SignedOut();
      if (r.status !== 200 || !r.body.requests) throw new Error(r.body.error ?? `requests (${r.status})`);
      return r.body.requests;
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  useEffect(() => {
    if (requests.error instanceof SignedOut) onSignedOut();
  }, [requests.error, onSignedOut]);

  const open = useMemo(
    () => (requests.data && builders ? requests.data.filter((r) => gaslessState(r, builders).kind !== "done") : null),
    [requests.data, builders],
  );
  // Re-check every open request's proof against the wallet that asked, now.
  const proofs = useSWR(
    open && open.length ? ["admin-register-proofs", ...open.map((r) => `${r.source}|${r.builder}`)] : null,
    async () => {
      const out = new Map<string, boolean>();
      await Promise.all(
        open!.map(async (r) => {
          const p = await browserProofCheck({ owner: r.builder, source: r.source }, { chainId: BUILDERS.chainId });
          out.set(r.source, p.state === "valid");
        }),
      );
      return out;
    },
    { revalidateOnFocus: false },
  );
  const plan = useMemo(
    () =>
      open && builders && proofs.data && REG && CARE && OPERATOR
        ? planOnboarding({
            records: [],
            registrations: gaslessCandidates(open, builders, (s) => proofs.data!.get(s) === true),
            builderRegistry: REG,
            caretakerRegistry: CARE,
            operator: OPERATOR as Address,
          })
        : null,
    [open, builders, proofs.data],
  );

  async function dismiss(source: string) {
    await call(`/api/admin/register-requests?source=${encodeURIComponent(source)}`, { method: "DELETE" });
    await requests.mutate();
  }

  return (
    <Section title="Register for builders without gas">
      {requests.error && !(requests.error instanceof SignedOut) ? (
        <p className="vf-error">Could not read the requests: {(requests.error as Error).message}</p>
      ) : !requests.data ? (
        <p className="vf-hint">Reading requests…</p>
      ) : !builders ? (
        <p className="vf-hint">{chainNote}</p>
      ) : !open || open.length === 0 ? (
        <p className="vf-hint">No open requests. Builders without gas ask from step 5 of /verify; each request is stored only with a valid published proof.</p>
      ) : (
        <>
          <ul className="adm-list">
            {open.map((r) => {
              const st = gaslessState(r, builders);
              const ok = proofs.data?.get(r.source);
              return (
                <li key={r.source}>
                  <b>{sourceLabel(r.source)}</b>{" "}
                  <span className="adm-sub">
                    {shortAddr(r.builder)} · asked {isoDay(r.requestedAt)} ·{" "}
                    {st.kind === "register"
                      ? "new wallet: registerFor now, the project in the next batch"
                      : st.kind === "addProject"
                        ? `add to builder #${st.builderId}`
                        : st.kind === "blocked"
                          ? st.reason
                          : ""}
                    {" · "}
                    {ok === undefined ? "checking proof…" : ok ? "proof valid" : "proof does NOT check out"}
                  </span>{" "}
                  {view.dismissRequests && (
                    <button type="button" className="vf-mini" onClick={() => dismiss(r.source)}>
                      dismiss
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {plan && plan.txs.length > 0 && !view.safeFiles ? (
            <p className="vf-hint">The Safe registers these ({plan.txs.length} tx): an admin downloads the batch.</p>
          ) : plan && plan.txs.length > 0 ? (
            <>
              <ol className="adm-txs">
                {plan.txs.map((t, i) => (
                  <li key={i}>
                    <code>{t.label}</code>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                className="vf-primary"
                onClick={() =>
                  download(
                    safeFileName("registrations", Date.now()),
                    safeBatchJson(plan.txs, { chainId: BUILDERS.chainId, createdAt: Date.now(), name: "Registrai: register for builders without gas" }),
                  )
                }
              >
                Download Safe batch ({plan.txs.length} tx)
              </button>
              <p className="vf-hint">
                Registration needs the Safe (REGISTRAR). After a registerFor executes, re-read the chain: the same request
                then plans its addProjectFor, and the onboarding queue below picks the builder up once its project is on-chain.
              </p>
            </>
          ) : plan ? (
            <p className="vf-hint">Nothing to send right now.</p>
          ) : (
            <p className="vf-hint">Checking proofs…</p>
          )}
          {plan && plan.skipped.length > 0 && (
            <ul className="adm-list">
              {plan.skipped.map((k, i) => (
                <li key={i} className="adm-sub">
                  skipped {k.what}: {k.reason}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}

function OnboardingSection({
  builders,
  chainNote,
  nameOf,
  revocationCheckpoint,
  onChainChanged,
}: {
  builders: GalleryBuilder[] | null;
  chainNote: string | null;
  nameOf: (b: GalleryBuilder) => string;
  revocationCheckpoint: unknown;
  onChainChanged: () => void;
}) {
  const view = useContext(ViewCtx);
  const { address, walletChainId, switchChain, connect, isConnecting } = useWallet();
  const missing = [!REG && "BuilderRegistry", !CARE && "CaretakerRegistry", !OPERATOR && "the operator"].filter(Boolean);
  const badge = BUILDERS.badgesOn ? BADGE : null;
  // Revoked badges (Revoked logs not followed by a reactivation): never re-onboarded.
  const revocations = useSWR(
    badge && REG ? ["admin-revocations", BUILDERS.chainId, badge, builders?.length ?? 0] : null,
    async () => {
      // Resume from the newest checkpoint (the build's, or this browser's last
      // read) so only recent blocks are scanned; 400 chunks ≈ 2M blocks ≈ 12
      // days of Arc mainnet since that checkpoint.
      const want = { chainId: BUILDERS.chainId, badge: badge!, registry: REG! };
      const r = await readRevokedBuilders(buildersClient() as unknown as LogReader, {
        ...want,
        fromBlock: BUILDERS.deployBlock ?? 0n,
        prior: bestRevocationCheckpoint(revocationCheckpoint, want),
        maxChunks: 400,
        // One range at a time: Arc mainnet's RPC rate-limits bursts of getLogs
        // ("Request exceeds defined limit"), which also starved the page's other reads.
        parallel: 1,
      });
      if (r.ok) saveRevocationCheckpoint(r.checkpoint);
      return r;
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  // No badge contract: nothing can have been revoked. Otherwise null (unknown) until the logs are read.
  const revoked: ReadonlySet<number> | null = useMemo(
    () => (!badge ? new Set<number>() : revocations.data?.ok ? revocations.data.revoked : null),
    [badge, revocations.data],
  );
  const queue = useMemo(
    () =>
      builders && REG && CARE && OPERATOR
        ? onboardingQueue(builders, { builderRegistry: REG, caretakerRegistry: CARE, operator: OPERATOR as Address, badge, revoked })
        : null,
    [builders, badge, revoked],
  );

  // Direct onboarding: the connected wallet must hold BOTH onboarder roles.
  const directPossible = Boolean(REG && CARE && OPERATOR && badge);
  const roles = useSWR(
    directPossible && address ? ["admin-onboarder-roles", BUILDERS.chainId, address.toLowerCase()] : null,
    () => onboarderRoles(buildersClient() as unknown as GalleryReader, address as Address, { caretakers: CARE, badge }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const gate = onboarderGate(roles.data);
  const [runs, setRuns] = useState<Record<number, OnboardRun>>({});
  const [busy, setBusy] = useState(false);
  const [allError, setAllError] = useState<string>();

  const patch = (id: number, f: (r: OnboardRun) => OnboardRun) =>
    setRuns((all) => ({ ...all, [id]: f(all[id] ?? { name: `Builder #${id}`, state: "running", txs: [] }) }));

  /** Re-read, plan, send each step and wait for its receipt. True when the builder ends up onboarded. */
  async function onboardOne(b: GalleryBuilder): Promise<boolean> {
    if (!address || !REG || !CARE || !OPERATOR || !badge) return false;
    const contracts = { registry: REG, caretakers: CARE, badge };
    setRuns((all) => ({ ...all, [b.id]: { name: nameOf(b), state: "running", txs: [], note: "re-reading the chain…" } }));
    try {
      await ensureBuildersChain(walletChainId, switchChain);
      const client = buildersClient() as unknown as GalleryReader;
      const now = await readBuilderForOnboarding(client, b.id, contracts);
      // Re-check the proofs at send time, against the owner as read now: a proof
      // removed since the page loaded stops the onboarding here.
      patch(b.id, (r) => ({ ...r, note: "re-checking its proofs…" }));
      const validProofs = await recheckOnboardingProofs(client, { registry: REG, builderId: b.id, owner: now.owner }, (p) =>
        browserProofCheck(p, { chainId: BUILDERS.chainId }),
      );
      const plan = planOnboardSteps({
        builderId: b.id,
        ...now,
        operator: OPERATOR as Address,
        expectedOwner: b.owner,
        revoked: revoked === null ? undefined : revoked.has(b.id),
        validProofs,
      });
      if (!plan.ok) throw new Error(plan.reason);
      if (plan.steps.length === 0) {
        patch(b.id, (r) => ({ ...r, state: "done", note: "Already onboarded: nothing to send." }));
        return true;
      }
      const calls = plan.steps.map((step) => onboardStepCall(step, contracts));
      patch(b.id, (r) => ({ ...r, txs: calls.map((c) => ({ label: c.label })), note: undefined }));
      for (const [i, c] of calls.entries()) {
        const setTx = (t: Partial<OnboardRun["txs"][number]>) =>
          patch(b.id, (r) => ({ ...r, txs: r.txs.map((x, j) => (j === i ? { ...x, ...t } : x)) }));
        await sendBuildersTx({
          account: address as Address,
          address: c.address,
          abi: c.abi as Abi,
          functionName: c.functionName,
          args: c.args,
          onHash: (hash) => setTx({ hash }),
        });
        setTx({ confirmed: true });
      }
      const after = await readBuilderForOnboarding(client, b.id, contracts);
      patch(b.id, (r) => ({
        ...r,
        state: "done",
        note: `Onboarded: caretaker ${shortAddr(after.caretaker)}${after.serial ? `, badge ${serialLabel(after.serial)}` : ""}.`,
      }));
      return true;
    } catch (e) {
      patch(b.id, (r) => ({ ...r, state: "error", note: undefined, error: humanizeError(e, HUMAN) }));
      return false;
    }
  }

  async function onboardSingle(b: GalleryBuilder) {
    setBusy(true);
    setAllError(undefined);
    await onboardOne(b);
    setBusy(false);
    onChainChanged();
  }

  async function onboardAll() {
    if (!queue || !address) return;
    const list = queue.included;
    if (
      !window.confirm(
        `Onboard ${list.length} builder${list.length === 1 ? "" : "s"} from ${shortAddr(address)}? Your wallet asks for each transaction; it stops at the first failure.`,
      )
    )
      return;
    setBusy(true);
    setAllError(undefined);
    for (const b of list) {
      if (!(await onboardOne(b))) {
        setAllError(`Stopped at builder #${b.id} (${nameOf(b)}): see its row.`);
        break;
      }
    }
    setBusy(false);
    onChainChanged();
  }

  // Runs whose builder has left the queue (the chain re-read after onboarding): keep their hashes on screen.
  const sentLog = queue ? Object.entries(runs).filter(([id]) => !queue.included.some((b) => b.id === Number(id))) : [];

  const direct = !directPossible ? (
    <p className="vf-hint">Direct onboarding needs a Verified Builder Badge contract on {BUILDERS.label}: use the Safe batch.</p>
  ) : !address ? (
    <p className="vf-hint">
      Connect the onboarder wallet to onboard directly.{" "}
      <button type="button" className="vf-mini" onClick={connect} disabled={isConnecting}>
        {isConnecting ? "connecting…" : "connect"}
      </button>
    </p>
  ) : roles.error ? (
    <p className="vf-error">Could not read {shortAddr(address)}&apos;s roles: {humanizeError(roles.error, HUMAN)}</p>
  ) : !roles.data ? (
    <p className="vf-hint">Checking {shortAddr(address)}&apos;s onboarder roles…</p>
  ) : !gate.ok ? (
    <p className="vf-hint">
      {shortAddr(address)} can&apos;t onboard directly: it lacks {gate.missing.join(" and ")}. Connect the onboarder wallet,
      or use the Safe batch.
    </p>
  ) : null;

  return (
    <Section title="Onboarding queue">
      {missing.length ? (
        <p className="vf-hint">Onboarding needs {missing.join(", ")} on {BUILDERS.label}.</p>
      ) : !queue ? (
        <p className="vf-hint">{chainNote}</p>
      ) : (
        <>
          <p className="vf-note">
            Builders with at least one project proof validated just now (read through the builders site&apos;s proof
            check; onboarding is per builder, not per project), never a deactivated or revoked one: pending ones get{" "}
            <code>setCaretaker(id, operator)</code>
            {badge ? (
              <>
                {" "}then <code>issue(id)</code>, and verified builders without a badge get <code>issue(id)</code>
              </>
            ) : null}
            . The same rules as <code>scripts/onboard-batch.ts</code>: an onboarder wallet sends them from here (each
            builder&apos;s proofs are re-checked right before its first transaction), or the Safe signs the batch file.
          </p>
          {queue.included.length > 0 && direct}
          {queue.included.length > 0 && gate.ok && (
            <div className="adm-actions">
              <button type="button" className="vf-primary" onClick={onboardAll} disabled={busy}>
                {busy ? "onboarding…" : `Onboard all (${queue.included.length})`}
              </button>
              <span className="vf-hint">Sends from your connected onboarder wallet. The Safe can remove this wallet&apos;s roles any time.</span>
            </div>
          )}
          {gate.ok && walletChainId !== BUILDERS.chainId && queue.included.length > 0 && (
            <p className="vf-hint">Your wallet is on another network: Onboard switches it to {BUILDERS.label} first.</p>
          )}
          {allError && <p className="vf-error">{allError}</p>}
          {queue.included.length === 0 ? (
            <p className="vf-hint">Nobody to onboard.</p>
          ) : (
            <>
              <ul className="adm-list">
                {queue.included.map((b) => {
                  const run = runs[b.id];
                  return (
                    <li key={b.id}>
                      <b>{nameOf(b)}</b>{" "}
                      <span className="adm-sub">
                        builder #{b.id} · {b.status === "pending" ? "claimed, awaiting onboarding" : "verified, no badge"} ·{" "}
                        {b.projects.filter((p) => p.status === "verified" && !p.proofUnchecked).map((p) => sourceLabel(p.source)).join(", ")}
                      </span>{" "}
                      {gate.ok && (
                        <button
                          type="button"
                          className="vf-mini vf-mini-strong"
                          onClick={() => onboardSingle(b)}
                          disabled={busy || run?.state === "done"}
                        >
                          {run?.state === "running" ? "onboarding…" : run?.state === "done" ? "onboarded" : "Onboard"}
                        </button>
                      )}
                      {run && <OnboardRunLine run={run} />}
                    </li>
                  );
                })}
              </ul>
              {view.safeFiles && (
              <>
              <div className="pp-card-label">Or: the Safe batch</div>
              <ol className="adm-txs">
                {queue.plan.txs.map((t, i) => (
                  <li key={i}>
                    <code>{t.label}</code>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                className={gate.ok ? "vf-mini" : "vf-primary"}
                onClick={() => download(safeFileName("onboarding", Date.now()), onboardingSafeFile(queue, BUILDERS.chainId, Date.now()))}
              >
                Download Safe batch ({queue.plan.txs.length} tx)
              </button>
              <p className="vf-hint">
                Safe → Apps → Transaction Builder → drag the file in. Chain {BUILDERS.chainId}, CaretakerRegistry {CARE && shortAddr(CARE)}
                {badge ? `, badge ${shortAddr(badge)}` : ""}, operator {OPERATOR && shortAddr(OPERATOR)}.
              </p>
              </>
              )}
            </>
          )}
          {sentLog.length > 0 && (
            <div className="adm-result">
              <div className="pp-card-label">Sent from this page</div>
              <ul className="adm-list">
                {sentLog.map(([id, run]) => (
                  <li key={id}>
                    <b>{run.name}</b> <span className="adm-sub">builder #{id}</span>
                    <OnboardRunLine run={run} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {queue.excluded.length > 0 && (
            <div className="adm-excluded">
              <p className="vf-note">
                <b>Not in this batch:</b> none of their project proofs could be read just now (unconfirmed). Re-read the
                chain later, or verify with <code>{CLI}</code>.
              </p>
              <ul className="adm-list">
                {queue.excluded.map((b) => (
                  <li key={b.id}>
                    <b>{nameOf(b)}</b>{" "}
                    <span className="adm-sub">
                      builder #{b.id} · {b.projects.filter((p) => p.proofUnchecked).map((p) => sourceLabel(p.source)).join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {badge && revoked === null && (
            <p className="vf-hint">
              {revocations.error || (revocations.data && !revocations.data.ok)
                ? `Couldn't read the badge revocation history (${revocations.data && !revocations.data.ok ? revocations.data.error : "log read failed"}): verified builders without a badge are held back. The CLI reads the full history: `
                : "Reading the badge revocation history…"}
              {(revocations.error || (revocations.data && !revocations.data.ok)) && <code>{CLI}</code>}
            </p>
          )}
          {queue.revoked.length > 0 && (
            <div className="adm-excluded">
              <p className="vf-note">
                <b>Not onboarded again:</b> a revoked badge is never re-issued from here. To re-admit a builder, the Safe
                reactivates it (<code>setActive(id, true)</code>) first.
              </p>
              <ul className="adm-list">
                {queue.revoked.map(({ builder: b, reason }) => (
                  <li key={b.id}>
                    <b>{nameOf(b)}</b> <span className="adm-sub">builder #{b.id} · {reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

// ───────────────────────────── badge actions ─────────────────────────────

function BadgeSection({
  builders,
  chainNote,
  nameOf,
}: {
  builders: GalleryBuilder[] | null;
  chainNote: string | null;
  nameOf: (b: GalleryBuilder) => string;
}) {
  const [confirm, setConfirm] = useState<GalleryBuilder | null>(null);
  const holders = useMemo(
    () => (builders ?? []).filter((b) => b.badge).sort((a, b) => a.badge!.serial - b.badge!.serial),
    [builders],
  );

  if (!BUILDERS.badgesOn || !BADGE) {
    return (
      <Section title="Badge actions">
        <p className="vf-hint">No Verified Builder Badge on {BUILDERS.label}.</p>
      </Section>
    );
  }
  return (
    <Section title="Badge actions">
      {!builders ? (
        <p className="vf-hint">{chainNote}</p>
      ) : holders.length === 0 ? (
        <p className="vf-hint">No badges issued yet.</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Badge</th>
                <th>Builder name</th>
                <th>Builder</th>
                <th>Owner</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {holders.map((b) => (
                <tr key={b.id}>
                  <td className="tnum">
                    <b>{serialLabel(b.badge!.serial)}</b>
                  </td>
                  <td>{nameOf(b)}</td>
                  <td className="tnum">#{b.id}</td>
                  <td>
                    <a href={`${BUILDERS.explorer.url}/address/${b.owner}`} target="_blank" rel="noreferrer">
                      {shortAddr(b.owner)} ↗
                    </a>
                  </td>
                  <td>{b.badge!.lapsed ? "lapsed" : b.status}</td>
                  <td>
                    <button type="button" className="vf-mini" onClick={() => setConfirm(b)} disabled={!REG}>
                      Revoke badge
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirm && <RevokeDialog b={confirm} name={nameOf(confirm)} onClose={() => setConfirm(null)} />}
    </Section>
  );
}

function RevokeDialog({ b, name, onClose }: { b: GalleryBuilder; name: string; onClose: () => void }) {
  const serial = b.badge!.serial;
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="bld-detail-backdrop" onClick={onClose}>
      <section role="alertdialog" aria-modal="true" aria-label={`Revoke ${serialLabel(serial)}`} className="bld-detail" onClick={(e) => e.stopPropagation()}>
        <h2 className="adm-dialog-title">
          Revoke {serialLabel(serial)} of {name}?
        </h2>
        <p className="vf-note">
          <code>revoke({b.id})</code> on the badge contract burns builder #{b.id}&apos;s soulbound badge and retires{" "}
          {serialLabel(serial)} for good, and <code>setActive({b.id}, false)</code> on the registry{" "}
          <b>deactivates builder #{b.id}</b>: it leaves the gallery, can&apos;t add projects, and is never onboarded or
          given a badge again unless the Safe reactivates it.
        </p>
        <p className="vf-note">
          Nothing is sent from this page. You download a two-transaction Safe batch (revoke, then deactivate); the
          Safe&apos;s signers decide.
        </p>
        <div className="adm-actions">
          <button
            type="button"
            className="vf-primary"
            onClick={() => {
              download(
                safeFileName(`revoke-badge-${serial}`, Date.now()),
                revokeSafeFile({ badge: BADGE!, registry: REG!, builderId: b.id, serial, chainId: BUILDERS.chainId, createdAt: Date.now() }),
              );
              onClose();
            }}
          >
            Download revoke + deactivate batch
          </button>
          <button type="button" className="vf-mini" onClick={onClose}>
            cancel
          </button>
        </div>
      </section>
    </div>
  );
}

// ───────────────────────────── recovery ─────────────────────────────

const nowS = () => Math.floor(Date.now() / 1000);

function useTick(ms = 1000): number {
  const [now, setNow] = useState(nowS);
  useEffect(() => {
    const t = setInterval(() => setNow(nowS()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * Key recovery (spec 2026-09-24-builder-projects-design.md): the Safe (REGISTRAR)
 * starts it — a Safe batch file from here —, the builder's owner may cancel it
 * for 7 days, then anyone may finish it (sent from the connected wallet).
 */
function RecoverySection({
  builders,
  chainNote,
  nameOf,
}: {
  builders: GalleryBuilder[] | null;
  chainNote: string | null;
  nameOf: (b: GalleryBuilder) => string;
}) {
  const { address, walletClient, walletChainId, switchChain } = useWallet();
  const [idInput, setIdInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [finish, setFinish] = useState<{ id?: number; error?: string; hash?: string }>({});
  const now = useTick();
  const ids = useMemo(() => (builders ?? []).map((b) => b.id), [builders]);
  const pending = useSWR(REG && builders ? ["admin-recoveries", BUILDERS.chainId, REG, ids.join(",")] : null, async () => {
    const client = createPublicClient({ chain: BUILDERS.chain.viemChain, transport: transportFor(BUILDERS.chain, { batch: true }) }) as PublicClient;
    return readRecoveries(client as unknown as GalleryReader, REG!, ids);
  }, { revalidateOnFocus: false });

  if (!REG) {
    return (
      <Section title="Recovery">
        <p className="vf-hint">No builder registry on {BUILDERS.label}.</p>
      </Section>
    );
  }

  function start() {
    const id = Number(idInput.trim());
    const b = builders?.find((x) => x.id === id);
    if (!Number.isSafeInteger(id) || id <= 0) return setFormError("Enter a builder id.");
    if (builders && !b) return setFormError(`No builder #${id} on ${BUILDERS.label}.`);
    const holder = builders?.find((x) => isAddress(toInput.trim(), { strict: false }) && x.owner === toInput.trim().toLowerCase());
    const err = transferTargetError(toInput, { owner: b?.owner ?? "", newOwnerBuilderId: holder?.id });
    if (err) return setFormError(err);
    setFormError(null);
    download(
      safeFileName(`recovery-builder-${id}`, Date.now()),
      startRecoverySafeFile({ registry: REG!, builderId: id, newOwner: getAddress(toInput.trim()), chainId: BUILDERS.chainId, createdAt: Date.now() }),
    );
  }

  async function finishRecovery(r: PendingRecovery) {
    if (!address || !walletClient) return;
    setFinish({ id: r.builderId });
    try {
      if (walletChainId !== BUILDERS.chainId) await switchChain(BUILDERS.chainId);
      const pc = createPublicClient({ chain: BUILDERS.chain.viemChain, transport: transportFor(BUILDERS.chain) }) as PublicClient;
      await pc.simulateContract({ address: REG!, abi: verifiedBuilderAbi, functionName: "finishRecovery", args: [BigInt(r.builderId)], account: address as Address });
      const hash = await walletClient.writeContract({
        address: REG!, abi: verifiedBuilderAbi, functionName: "finishRecovery", args: [BigInt(r.builderId)],
        account: address as Address, chain: BUILDERS.chain.viemChain,
      });
      setFinish({ id: r.builderId, hash });
      const rc = await pc.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error("the transaction reverted");
      setFinish({ hash });
      await pending.mutate();
    } catch (e) {
      setFinish((f) => ({ hash: f.hash, error: humanizeError(e, HUMAN) }));
    }
  }

  const rows = pending.data ?? [];
  return (
    <Section title="Recovery">
      <p className="vf-note">
        For a builder who lost their key (or had it stolen): <code>startRecovery(builderId, newOwner)</code> from the Safe. The
        current owner sees a banner on /verify and may cancel it for 7 days; after that anyone can finish it. The new wallet
        must hold no builder. Payouts fall back to the new owner; project proofs must be re-signed with the new wallet and the
        badge synced.
      </p>
      <div className="adm-inline">
        <label className="vf-field">
          <span>Builder id</span>
          <input value={idInput} onChange={(e) => setIdInput(e.target.value)} inputMode="numeric" placeholder="7" />
          <em>{builders?.find((b) => b.id === Number(idInput)) ? nameOf(builders.find((b) => b.id === Number(idInput))!) : ""}</em>
        </label>
        <label className="vf-field">
          <span>New owner</span>
          <input value={toInput} onChange={(e) => setToInput(e.target.value)} placeholder="0x…" spellCheck={false} autoCapitalize="off" />
          <em />
        </label>
        <button type="button" className="vf-primary" onClick={start} disabled={!idInput.trim() || !toInput.trim()}>
          Download recovery batch
        </button>
      </div>
      {formError && <p className="vf-error">{formError}</p>}

      <div className="pp-card-label">Pending recoveries</div>
      {!builders ? (
        <p className="vf-hint">{chainNote}</p>
      ) : pending.error ? (
        <p className="vf-error">Could not read recoveries: {humanizeError(pending.error, HUMAN)}</p>
      ) : !pending.data ? (
        <p className="vf-hint">Reading recoveries…</p>
      ) : rows.length === 0 ? (
        <p className="vf-hint">None.</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Builder</th>
                <th>Moves to</th>
                <th>Ready</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const v = recoveryView(r, now);
                const b = builders.find((x) => x.id === r.builderId);
                return (
                  <tr key={r.builderId}>
                    <td>
                      <b>{b ? nameOf(b) : `Builder #${r.builderId}`}</b>
                      <span className="adm-sub">#{r.builderId}{b ? ` · owner ${shortAddr(b.owner)}` : ""}</span>
                    </td>
                    <td>
                      <a href={`${BUILDERS.explorer.url}/address/${r.newOwner}`} target="_blank" rel="noreferrer">
                        {shortAddr(r.newOwner)} ↗
                      </a>
                    </td>
                    <td className="tnum">
                      {v.kind === "waiting" ? `in ${formatCountdown(v.secondsLeft)}` : "ready"}
                      <span className="adm-sub">{utcMinute(r.readyAt)}</span>
                    </td>
                    <td>
                      <span className="adm-actions">
                        {v.kind === "ready" && (
                          <button
                            type="button"
                            className="vf-mini vf-mini-strong"
                            disabled={!address || finish.id === r.builderId}
                            title={address ? "finishRecovery: anyone may send it" : "connect a wallet to send it"}
                            onClick={() => finishRecovery(r)}
                          >
                            {finish.id === r.builderId ? "finishing…" : "Finish"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="vf-mini"
                          onClick={() =>
                            download(
                              safeFileName(`cancel-recovery-builder-${r.builderId}`, Date.now()),
                              cancelRecoverySafeFile({ registry: REG!, builderId: r.builderId, chainId: BUILDERS.chainId, createdAt: Date.now() }),
                            )
                          }
                        >
                          cancel (Safe)
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {finish.error && <p className="vf-error">{finish.error}</p>}
      {finish.hash && (
        <a className="vf-link" href={`${BUILDERS.explorer.url}/tx/${finish.hash}`} target="_blank" rel="noreferrer">
          view transaction ↗
        </a>
      )}
    </Section>
  );
}

// ───────────────────────────── projects ─────────────────────────────

/** Every active project on chain, with a Safe batch to deactivate one (setProjectActive(id, false), REGISTRAR). */
function ProjectsSection({
  builders,
  chainNote,
  nameOf,
}: {
  builders: GalleryBuilder[] | null;
  chainNote: string | null;
  nameOf: (b: GalleryBuilder) => string;
}) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (builders ?? [])
      .flatMap((b) => b.projects.filter((p) => p.active).map((p) => ({ b, p })))
      .filter(({ b, p }) => !q || `${p.source} #${p.id} #${b.id} ${nameOf(b)}`.toLowerCase().includes(q));
  }, [builders, query, nameOf]);
  if (!REG) return null;
  return (
    <Section
      title="Projects"
      aside={
        <label className="bld-search">
          <span className="sr-only">Filter projects</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="filter: source, #id, name" spellCheck={false} />
        </label>
      }
    >
      <p className="vf-note">
        Active projects on {BUILDERS.label}. <b>Deactivate</b> downloads a one-transaction Safe batch,{" "}
        <code>setProjectActive(projectId, false)</code> (e.g. a fraudulent claim). The project keeps its id and history; the
        builder&apos;s status follows at the next read.
      </p>
      {!builders ? (
        <p className="vf-hint">{chainNote}</p>
      ) : rows.length === 0 ? (
        <p className="vf-hint">{query ? "Nothing matches." : "No active projects."}</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Builder</th>
                <th>Proof</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ b, p }) => (
                <tr key={`${b.id}-${p.id}`}>
                  <td>
                    <a href={sourceHref(p.source)} target="_blank" rel="noreferrer">
                      {sourceLabel(p.source)} ↗
                    </a>
                    <span className="adm-sub">project #{p.id}</span>
                  </td>
                  <td>
                    <b>{nameOf(b)}</b>
                    <span className="adm-sub">#{b.id}</span>
                  </td>
                  <td>{projectChipKind(p, b) ?? "inactive"}</td>
                  <td>
                    <button
                      type="button"
                      className="vf-mini"
                      onClick={() => {
                        if (!window.confirm(`Download a Safe batch deactivating project #${p.id} (${p.source}) of builder #${b.id}?`)) return;
                        download(
                          safeFileName(`deactivate-project-${p.id}`, Date.now()),
                          deactivateProjectSafeFile({ registry: REG!, projectId: p.id, source: p.source, chainId: BUILDERS.chainId, createdAt: Date.now() }),
                        );
                      }}
                    >
                      Deactivate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ───────────────────────────── on-chain nominations ─────────────────────────────

/** arc-80's prepared drafts: review, then Invite → Save profile → Nominate, each once the step before is done. */
function DraftsTable({
  invited,
  builders,
  nominations,
  onInvitesChanged,
  onNominate,
  onSafeFile,
  busy,
}: {
  invited: Set<string>;
  builders: GalleryBuilder[] | null;
  nominations: Map<string, Nomination> | null;
  onInvitesChanged: () => void;
  onNominate: (source: string) => void;
  onSafeFile: (source: string) => void;
  busy: boolean;
}) {
  const view = useContext(ViewCtx);
  const drafts = useSWR("admin-drafts", async () => {
    const r = await call<{ drafts?: NominationDraft[]; error?: string }>("/api/admin/drafts");
    if (r.status !== 200 || !r.body.drafts) throw new Error(r.body.error ?? `drafts (${r.status})`);
    return r.body.drafts;
  }, { revalidateOnFocus: false, shouldRetryOnError: false });
  const saved = useSWR("admin-projects-saved", async () => {
    const r = await call<{ projects?: ProjectListItem[] }>("/api/admin/projects");
    const out = new Map<string, ProjectProfile>();
    // The list adds a server-computed `status`; the anchored hash is of the profile alone.
    for (const p of r.body.projects ?? []) if (p.declaredBy) out.set(p.source, profileOfListItem(p));
    return out;
  }, { revalidateOnFocus: false, shouldRetryOnError: false });
  const [open, setOpen] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  async function invite(d: NominationDraft) {
    setWorking(d.source);
    setMsg({});
    const r = await call<{ invite?: AdminInvite; error?: string }>("/api/admin/invites", {
      method: "POST",
      body: { source: d.source, name: d.invite.name, x: d.invite.x ?? "", note: `Draft (${d.investigatedBy}, ${d.investigatedAt}): ${d.summary}`.slice(0, 500) },
    });
    setWorking(null);
    if ((r.status === 201 || r.status === 409) && r.body.invite) {
      onInvitesChanged();
      setMsg({ ok: `Invited ${d.invite.name}: its claim link and DM are in the invites list.` });
    } else setMsg({ error: r.body.error ?? `could not invite (${r.status})` });
  }

  async function save(d: NominationDraft) {
    setWorking(d.source);
    setMsg({});
    const r = await call<{ profile?: ProjectProfile; error?: string }>(projectPath(d.source), { method: "PUT", body: d.profile });
    setWorking(null);
    if (r.status === 200) {
      await saved.mutate();
      setMsg({ ok: `Saved ${d.invite.name}'s profile.` });
    } else setMsg({ error: r.body.error ?? `could not save (${r.status})` });
  }

  async function dismiss(d: NominationDraft) {
    if (!window.confirm(`Drop the draft for ${d.invite.name}? (The investigation file stays.)`)) return;
    await call(`/api/admin/drafts/${encodeURIComponent(d.source)}`, { method: "DELETE" });
    await drafts.mutate();
  }

  if (drafts.error) return <p className="vf-error">Could not read the drafts: {(drafts.error as Error).message}</p>;
  if (!drafts.data) return <p className="vf-hint">Reading drafts…</p>;
  // A verified builder's project (from the chain) only needs its profile saved.
  const stepOf = (d: NominationDraft) => {
    const n = nominations?.get(d.source);
    const p = saved.data?.get(d.source);
    return draftStep(d, {
      verified: Boolean(builders && inviteChainStatus(d.source, builders).kind === "verified"),
      invited: invited.has(d.source),
      saved: Boolean(p),
      anchored: Boolean(n?.active && p && n.profileHash === profileHash(p)),
    });
  };
  const pending = drafts.data.filter((d) => !stepOf(d).done);
  if (!pending.length) return <p className="vf-hint">No drafts waiting. New ones appear here once the investigation hands them over.</p>;
  return (
    <div className="adm-drafts">
      <h3>Drafts to review and sign</h3>
      <ul className="adm-list">
        {pending.map((d) => {
          const step = stepOf(d);
          const p = saved.data?.get(d.source);
          const n = nominations?.get(d.source);
          const hold = step.label === "hold";
          const verified = step.label === "save profile";
          const expanded = open === d.source;
          return (
            <li key={d.source} className={hold ? "adm-muted" : undefined}>
              <b>{d.invite.name}</b> <span className="adm-sub">{sourceLabel(d.source)}</span>{" "}
              <span className="bld-chip" data-kind={hold ? "lapsed" : "verified"}>{step.label}</span>
              <div className="adm-sub">{d.summary}</div>
              <div className="adm-sub">
                {verified
                  ? `verified builder: saving its profile is all it needs · ${p ? "✓ profile saved" : "profile not saved"}`
                  : <>
                      {invited.has(d.source) ? "✓ invited" : "not invited"} · {p ? "✓ profile saved" : "profile not saved"} ·{" "}
                      {n?.active ? (p && n.profileHash === profileHash(p) ? "✓ nominated" : "nominated (profile not anchored: re-nominate)") : "not nominated"}
                    </>}
              </div>
              <span className="flex flex-wrap gap-2">
                <button type="button" className="vf-mini" onClick={() => setOpen(expanded ? null : d.source)}>{expanded ? "hide details" : "details"}</button>
                {view.inviteForm && step.actions.includes("invite") && (
                  <button type="button" className="vf-mini" disabled={working !== null} onClick={() => void invite(d)}>{working === d.source ? "…" : "Invite"}</button>
                )}
                {view.inviteForm && step.actions.includes("save") && (
                  <button type="button" className="vf-mini" disabled={working !== null} onClick={() => void save(d)}>{working === d.source ? "…" : p ? "Save profile again" : "Save profile"}</button>
                )}
                {step.actions.includes("nominate") && (
                  <button type="button" className="vf-mini" disabled={busy} onClick={() => onNominate(d.source)}>{n?.active ? "Re-nominate" : "Nominate"}</button>
                )}
                {view.safeFiles && step.actions.includes("nominate") && (
                  <button type="button" className="vf-mini" onClick={() => onSafeFile(d.source)}>Safe file</button>
                )}
                {view.inviteForm && <button type="button" className="vf-mini" onClick={() => void dismiss(d)}>drop</button>}
              </span>
              {expanded && <DraftDetails d={d} />}
            </li>
          );
        })}
      </ul>
      {msg.ok && <p className="vf-ok">{msg.ok}</p>}
      {msg.error && <p className="vf-error">{msg.error}</p>}
    </div>
  );
}

function DraftDetails({ d }: { d: NominationDraft }) {
  const pr = d.profile;
  const addr = (a: string) => <a href={`${BUILDERS.explorer.url.replace(/\/$/, "")}/address/${a}`} target="_blank" rel="noreferrer">{shortAddr(a)}</a>;
  return (
    <div className="adm-sub">
      <p>
        <a href={pr.website} target="_blank" rel="noreferrer">{pr.website} ↗</a>
        {pr.x && <> · <a href={xHref(pr.x)} target="_blank" rel="noreferrer">{pr.x}{pr.xChecked ? " ✓" : ""} ↗</a></>}
        {pr.github && <> · <a href={sourceHref(pr.github)} target="_blank" rel="noreferrer">{sourceLabel(pr.github)} ↗</a></>}
        {" · "}investigation: <code>{d.investigation}</code>
      </p>
      {pr.deployers.length > 0 && <p>Deployers: {pr.deployers.map((x, i) => <span key={x.address}>{i ? ", " : ""}{addr(x.address)}{x.note ? ` (${x.note})` : ""}</span>)}</p>}
      {pr.contracts.length > 0 && <p>Contracts: {pr.contracts.map((x, i) => <span key={x.address}>{i ? ", " : ""}{x.label} {addr(x.address)}</span>)}</p>}
      {pr.token && <p>Token: {addr(pr.token.address)}{pr.token.note ? ` (${pr.token.note})` : ""}</p>}
      <p>Metrics: {pr.metrics.length ? pr.metrics.join(", ") : "none"}</p>
      {pr.redFlags?.length ? <p className="vf-error">Red flags: {pr.redFlags.join("; ")}</p> : null}
    </div>
  );
}



/** ProjectNominations: anchor an invited project on chain as nominated (the gallery's backup). */
function NominationsSection({ invites, onInvitesChanged, builders }: { invites: AdminInvite[]; onInvitesChanged: () => void; builders: GalleryBuilder[] | null }) {
  const view = useContext(ViewCtx);
  const contract = NOMINATIONS!;
  const { address, walletChainId, switchChain } = useWallet();
  const [input, setInput] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);
  const invited = useMemo(() => new Set(invites.map((i) => i.source)), [invites]);
  const list = useSWR(
    ["admin-nominations", contract],
    () => readNominations(buildersClient() as unknown as NominationsReader, contract),
    { revalidateOnFocus: false },
  );

  /** The anchored hash: the stored profile's, else 0x0 (a later save + re-nominate anchors it). */
  async function hashFor(source: string): Promise<Hex> {
    const r = await call<{ profile?: ProjectProfile }>(projectPath(source));
    return r.status === 200 && r.body.profile ? profileHash(r.body.profile) : profileHash(null);
  }

  async function send(source: string, on: boolean) {
    if (!address) return setMsg({ error: "Connect the onboarder wallet (or download the Safe file)." });
    if (busy) return;
    setBusy(true);
    setMsg({});
    try {
      if (walletChainId !== BUILDERS.chainId) await switchChain(BUILDERS.chainId);
      const args = on ? [source, await hashFor(source)] : [source];
      const hash = await sendBuildersTx({ account: address as Address, address: contract, abi: nominationsAbi as Abi, functionName: on ? "nominate" : "unnominate", args });
      await buildersClient().waitForTransactionReceipt({ hash });
      setMsg({ ok: `${on ? "Nominated" : "Un-nominated"} ${source} on chain.` });
      await list.mutate();
    } catch (e) {
      setMsg({ error: humanizeError(e, HUMAN) });
    } finally {
      setBusy(false);
    }
  }

  async function act(on: boolean, how: "wallet" | "safe") {
    const r = nominateInput(input, invited, on);
    if (!r.ok) return setMsg({ error: r.error });
    if (how === "safe") {
      const tx = nominationTx(contract, r.source, on, on ? await hashFor(r.source) : undefined);
      download(safeFileName(`${on ? "nominate" : "unnominate"}-${r.source.replace(/[^a-z0-9]+/g, "-")}`, Date.now()),
        singleTxSafeFile(tx, { chainId: BUILDERS.chainId, createdAt: Date.now(), name: `Registrai: ${on ? "nominate" : "un-nominate"} ${r.source}` }));
      return setMsg({ ok: "Safe file downloaded." });
    }
    void send(r.source, on);
  }

  const rows = [...(list.data ?? new Map<string, Nomination>()).entries()];
  return (
    <Section title="Nominate on chain">
      <DraftsTable
        invited={invited}
        builders={builders}
        nominations={list.data ?? null}
        onInvitesChanged={onInvitesChanged}
        onNominate={(src) => void send(src, true)}
        onSafeFile={(src) => {
          setInput(src);
          void (async () => {
            const tx = nominationTx(contract, src, true, await hashFor(src));
            download(safeFileName(`nominate-${src.replace(/[^a-z0-9]+/g, "-")}`, Date.now()),
              singleTxSafeFile(tx, { chainId: BUILDERS.chainId, createdAt: Date.now(), name: `Registrai: nominate ${src}` }));
            setMsg({ ok: "Safe file downloaded." });
          })();
        }}
        busy={busy}
      />
      <p className="vf-note">
        Anchor an invited project as <b>nominated</b> on {BUILDERS.label} (ProjectNominations): the onboarder wallet or the Safe.
        It records the project and a fingerprint of its saved profile; the gallery links to it. No funds, no markets yet.
      </p>
      <div className="adm-inline">
        <label className="vf-field">
          <span>Invited project</span>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="github:owner/repo or domain" spellCheck={false} autoCapitalize="off" list="adm-invited-sources" />
          <em />
        </label>
        <datalist id="adm-invited-sources">
          {[...invited].map((src) => (
            <option key={src} value={src} />
          ))}
        </datalist>
        <button type="button" className="vf-primary" onClick={() => void act(true, "wallet")} disabled={busy || !input.trim()}>{busy ? "Sending…" : "Nominate"}</button>
        <button type="button" onClick={() => void act(false, "wallet")} disabled={busy || !input.trim()}>Un-nominate</button>
        {view.safeFiles && <button type="button" onClick={() => void act(true, "safe")} disabled={!input.trim()}>Safe file: nominate</button>}
      </div>
      {msg.ok && <p className="vf-ok">{msg.ok}</p>}
      {msg.error && <p className="vf-error">{msg.error}</p>}
      {list.error ? (
        <p className="vf-error">Could not read the nominations: {humanizeError(list.error, HUMAN)}</p>
      ) : !list.data ? (
        <p className="vf-hint">Reading nominations…</p>
      ) : rows.length === 0 ? (
        <p className="vf-hint">No project nominated on chain yet.</p>
      ) : (
        <ul className="adm-list">
          {rows.map(([src, n]) => (
            <li key={src}>
              <b>{sourceLabel(src)}</b>{" "}
              <span className="adm-sub">
                {n.active ? "nominated" : "withdrawn"} · {new Date(n.at * 1000).toISOString().slice(0, 10)} by {shortAddr(n.by)}
                {n.profileHash !== profileHash(null) ? " · profile anchored" : " · no profile anchored"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ───────────────────────────── wonder markets ─────────────────────────────

function WonderSection({ invites }: { invites: AdminInvite[] }) {
  const w = WONDER_ON_BUILDERS!;
  const { address, walletClient, walletChainId, switchChain } = useWallet();
  const [input, setInput] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);
  const invited = useMemo(() => new Set(invites.map((i) => i.source)), [invites]);
  const sources = useMemo(() => [...invited], [invited]);
  const wonder = useWonderContext();
  const now = useTick(60_000); // unix seconds

  async function send(source: string, on: boolean) {
    if (!address || !walletClient) return setMsg({ error: "Connect the onboarder wallet (or download the Safe file)." });
    if (busy) return;
    setBusy(true);
    try {
      if (walletChainId !== BUILDERS.chainId) await switchChain(BUILDERS.chainId);
      const pc = buildersClient();
      await pc.simulateContract({ address: w.markets, abi: wonderMarketsAbi, functionName: "nominate", args: [source, on], account: address as Address });
      const hash = await walletClient.writeContract({
        address: w.markets, abi: wonderMarketsAbi, functionName: "nominate", args: [source, on],
        account: address as Address, chain: BUILDERS.chain.viemChain,
      });
      const rc = await pc.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error("the transaction reverted");
      setMsg({ ok: `${on ? "Nominated" : "Un-nominated"} ${source}.` });
      wonder.refresh();
    } catch (e) {
      setMsg({ error: humanizeError(e, HUMAN) });
    } finally {
      setBusy(false);
    }
  }

  function act(on: boolean, how: "wallet" | "safe") {
    const r = nominateInput(input, invited, on);
    if (!r.ok) return setMsg({ error: r.error });
    if (how === "safe") {
      download(safeFileName(`${on ? "nominate" : "unnominate"}-${r.source.replace(/[^a-z0-9]+/g, "-")}`, Date.now()),
        nominateSafeFile({ markets: w.markets, source: r.source, on, chainId: BUILDERS.chainId, createdAt: Date.now() }));
      return setMsg({ ok: "Safe file downloaded." });
    }
    void send(r.source, on);
  }

  const rows = sources
    .map((s) => ({ s, st: wonder.status[s] }))
    .filter((r) => r.st && (r.st.nominated || r.st.escrow > 0n || r.st.pending || r.st.releasedTo));
  return (
    <Section title="Wonder markets">
      <p className="vf-note">
        Nominate an invited project to open wonder markets on it (the onboarder wallet or the Safe). Un-nominate when a
        team opts out: no new wonder markets; existing ones settle and their escrow expires to the season pool. The
        keeper queues a release once the team&apos;s claim has held three checks; cancel a wrong one here within 7 days.
      </p>
      <div className="adm-inline">
        <label className="vf-field">
          <span>Invited project</span>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="github:owner/repo or domain" spellCheck={false} autoCapitalize="off" />
          <em />
        </label>
        <button type="button" className="vf-primary" onClick={() => act(true, "wallet")} disabled={busy || !input.trim()}>{busy ? "Sending…" : "Nominate"}</button>
        <button type="button" onClick={() => act(false, "wallet")} disabled={busy || !input.trim()}>Un-nominate</button>
        <button type="button" onClick={() => act(true, "safe")} disabled={!input.trim()}>Safe file: nominate</button>
        <button type="button" onClick={() => act(false, "safe")} disabled={!input.trim()}>Safe file: un-nominate</button>
      </div>
      {msg.ok && <p className="vf-ok">{msg.ok}</p>}
      {msg.error && <p className="vf-error">{msg.error}</p>}

      <div className="pp-card-label">Escrow</div>
      {rows.length === 0 ? (
        <p className="vf-hint">No nominated project, no escrow.</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Project</th><th>Nominated</th><th>Escrow</th><th /></tr></thead>
            <tbody>
              {rows.map(({ s, st }) => {
                const v = wonder.expiry !== null ? releaseView(st!, now, wonder.expiry) : null;
                return (
                  <tr key={s}>
                    <td><b>{sourceLabel(s)}</b><span className="adm-sub">{s}</span></td>
                    <td>{st!.nominated ? "yes" : "no"}</td>
                    <td>{v?.line ?? usd(st!.escrow)}</td>
                    <td>
                      {st!.pending && (
                        <button type="button" onClick={() => download(safeFileName(`cancel-release-${s.replace(/[^a-z0-9]+/g, "-")}`, Date.now()),
                          cancelReleaseSafeFile({ escrow: w.escrow, source: s, chainId: BUILDERS.chainId, createdAt: Date.now() }))}>
                          Safe file: cancel release
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
