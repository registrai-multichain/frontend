"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import useSWR from "swr";
import { createPublicClient, type Address, type PublicClient } from "viem";
import { useWallet } from "@/components/WalletProvider";
import { BUILDERS } from "@/lib/builders-network";
import { transportFor } from "@/lib/chains";
import { shortAddr } from "@/lib/format";
import { humanizeError } from "@/lib/humanize-error";
import { sourceHref, xHref, type GalleryBuilder, type GalleryReader } from "@/lib/builders-gallery";
import { ADMIN_SERVICE, adminLoginMessage, inviteDm, type InviteRecord } from "@/lib/builders-admin";
import {
  inviteChainStatus,
  needsFollowUp,
  onboardingQueue,
  onboardingSafeFile,
  readAdminChain,
  revokeSafeFile,
  safeFileName,
  type InviteChainStatus,
} from "@/lib/builders-admin-chain";
import { badgeImageBase, serialLabel } from "@/lib/verified-builder-badge";
import { normalizeSource, sourceLabel } from "@/lib/verified-builders";

const REG = BUILDERS.contracts.BuilderRegistry;
const CARE = BUILDERS.contracts.CaretakerRegistry;
const BADGE = BUILDERS.contracts.VerifiedBuilderBadge;
const OPERATOR = BUILDERS.operator;
const HUMAN = { testnet: BUILDERS.chain.testnet, networkName: BUILDERS.label };
const BUILDERS_SITE = "https://builder.registrai.cc";
const CLI = `npx tsx scripts/onboard-batch.ts --network ${BUILDERS.network}${BUILDERS.badgesOn && BADGE ? ` --badge ${BADGE}` : ""}`;

type AdminInvite = InviteRecord & { claimLink: string };
type ApiState = { state: "checking" } | { state: "unavailable" } | { state: "ready"; address: string | null };

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
export function AdminApp() {
  const [api, setApi] = useState<ApiState>({ state: "checking" });
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
        if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/json")) throw new Error("no api");
        const me = (await res.json()) as { service?: string; address?: string | null };
        if (me.service !== ADMIN_SERVICE) throw new Error("not the admin api");
        if (!off) setApi({ state: "ready", address: me.address ?? null });
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
          <p>Invites, the onboarding queue and badge actions. Nothing is sent on-chain from here: batches go to the Safe.</p>
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
      {api.state === "ready" && !api.address && <SignIn onSignedIn={(address) => setApi({ state: "ready", address })} />}
      {api.state === "ready" && api.address && (
        <Dashboard admin={api.address} onSignedOut={() => setApi({ state: "ready", address: null })} />
      )}
    </>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (address: string) => void }) {
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
      const r = await call<{ address?: string; error?: string }>("/api/auth/login", { method: "POST", body: { message, signature } });
      if (r.status !== 200 || !r.body.address) throw new Error(r.body.error ?? `sign-in failed (${r.status})`);
      onSignedIn(r.body.address);
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

function Dashboard({ admin, onSignedOut }: { admin: string; onSignedOut: () => void }) {
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

  const chain = useSWR(REG ? ["admin-chain", BUILDERS.chainId, REG] : null, readChain, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  const nameOf = useCallback(
    (source: string | null, id?: number) => {
      const inv = source ? invites.data?.find((i) => i.source === source) : undefined;
      return inv?.name ?? (source ? sourceLabel(source) : `Builder #${id}`);
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

  return (
    <div className="adm-stack">
      <div className="adm-bar">
        <span>
          Signed in as <b className="tnum">{shortAddr(admin)}</b>
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

      <InviteForm onChanged={() => invites.mutate()} />

      <InvitesTable
        invites={invites.data}
        error={invites.error && !(invites.error instanceof SignedOut) ? String((invites.error as Error).message) : null}
        builders={chain.data ?? null}
        chainNote={chainNote}
        onChanged={() => invites.mutate()}
      />

      <OnboardingSection builders={chain.data ?? null} chainNote={chainNote} nameOf={nameOf} />

      <BadgeSection builders={chain.data ?? null} chainNote={chainNote} nameOf={nameOf} />
    </div>
  );
}

// ───────────────────────────── invite a project ─────────────────────────────

function InviteLink({ invite, existed }: { invite: AdminInvite; existed: boolean }) {
  const dm = inviteDm(invite, invite.claimLink);
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
      <span className="bld-chip" data-kind="nominated" title={`builder #${s.builderId}${s.unchecked ? " · proof not readable from the browser" : ""}`}>
        Nominated{s.unchecked ? " · unchecked" : ""}
      </span>
    );
  return (
    <span className="bld-chip" data-kind="lapsed" title={`builder #${s.builderId}`}>
      Lapsed
    </span>
  );
}

function InviteRow({ inv, status, onChanged }: { inv: AdminInvite; status: InviteChainStatus | null; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
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
          <CopyButton text={inviteDm(inv, inv.claimLink)} label="DM" />
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
        {!editing && (
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

function OnboardingSection({
  builders,
  chainNote,
  nameOf,
}: {
  builders: GalleryBuilder[] | null;
  chainNote: string | null;
  nameOf: (source: string | null, id?: number) => string;
}) {
  const missing = [!REG && "BuilderRegistry", !CARE && "CaretakerRegistry", !OPERATOR && "the operator"].filter(Boolean);
  const badge = BUILDERS.badgesOn ? BADGE : null;
  const queue = useMemo(
    () =>
      builders && REG && CARE && OPERATOR
        ? onboardingQueue(builders, { builderRegistry: REG, caretakerRegistry: CARE, operator: OPERATOR as Address, badge })
        : null,
    [builders, badge],
  );

  return (
    <Section title="Onboarding queue">
      {missing.length ? (
        <p className="vf-hint">Onboarding needs {missing.join(", ")} on {BUILDERS.label}.</p>
      ) : !queue ? (
        <p className="vf-hint">{chainNote}</p>
      ) : (
        <>
          <p className="vf-note">
            Claimed builders whose proof this browser just validated: pending ones get <code>setCaretaker(id, operator)</code>
            {badge ? (
              <>
                {" "}then <code>issue(id)</code>, and verified builders without a badge get <code>issue(id)</code>
              </>
            ) : null}
            . The same rules as <code>scripts/onboard-batch.ts</code>; the Safe signs and sends.
          </p>
          {queue.included.length === 0 ? (
            <p className="vf-hint">Nobody to onboard.</p>
          ) : (
            <>
              <ul className="adm-list">
                {queue.included.map((b) => (
                  <li key={b.id}>
                    <b>{nameOf(b.source, b.id)}</b> <span className="adm-sub">builder #{b.id} · {b.status === "pending" ? "claimed, awaiting onboarding" : "verified, no badge"}</span>
                  </li>
                ))}
              </ul>
              <ol className="adm-txs">
                {queue.plan.txs.map((t, i) => (
                  <li key={i}>
                    <code>{t.label}</code>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                className="vf-primary"
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
          {queue.excluded.length > 0 && (
            <div className="adm-excluded">
              <p className="vf-note">
                <b>Not in this batch:</b> the browser could not read their domain proof (CORS). Verify with{" "}
                <code>{CLI}</code>.
              </p>
              <ul className="adm-list">
                {queue.excluded.map((b) => (
                  <li key={b.id}>
                    <b>{nameOf(b.source, b.id)}</b> <span className="adm-sub">builder #{b.id} · {b.source ? sourceLabel(b.source) : ""}</span>
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
  nameOf: (source: string | null, id?: number) => string;
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
                <th>Project</th>
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
                  <td>{nameOf(b.source, b.id)}</td>
                  <td className="tnum">#{b.id}</td>
                  <td>
                    <a href={`${BUILDERS.explorer.url}/address/${b.owner}`} target="_blank" rel="noreferrer">
                      {shortAddr(b.owner)} ↗
                    </a>
                  </td>
                  <td>{b.badge!.lapsed ? "lapsed" : b.status}</td>
                  <td>
                    <button type="button" className="vf-mini" onClick={() => setConfirm(b)}>
                      Revoke badge
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirm && <RevokeDialog b={confirm} name={nameOf(confirm.source, confirm.id)} onClose={() => setConfirm(null)} />}
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
          {serialLabel(serial)} for good: a later re-issue gets a new number.
        </p>
        <p className="vf-note">
          Nothing is sent from this page. You download a one-transaction Safe batch; the Safe&apos;s signers decide.
          The builder stays registered{b.status === "verified" ? " and verified: the onboarding queue will offer it a new badge unless its claim lapses" : ""}.
        </p>
        <div className="adm-actions">
          <button
            type="button"
            className="vf-primary"
            onClick={() => {
              download(
                safeFileName(`revoke-badge-${serial}`, Date.now()),
                revokeSafeFile({ badge: BADGE!, builderId: b.id, serial, chainId: BUILDERS.chainId, createdAt: Date.now() }),
              );
              onClose();
            }}
          >
            Download revoke batch
          </button>
          <button type="button" className="vf-mini" onClick={onClose}>
            cancel
          </button>
        </div>
      </section>
    </div>
  );
}
