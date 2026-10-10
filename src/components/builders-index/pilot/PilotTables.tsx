"use client";

import { InfoBubble } from "@/components/InfoBubble";
import { shortWallet, type ClosedPositionView, type LeaderboardRow, type OpenPositionView } from "@/lib/abi-pilot-api";
import { fmtPts, fmtPx, fmtSigned, fmtWhen, PILOT_COPY } from "@/lib/abi-pilot-copy";

export type PilotTab = "positions" | "history" | "leaderboard";

export interface PilotTablesProps {
  tab: PilotTab;
  onTab: (t: PilotTab) => void;
  /** Signed-in wallet (lowercase), or null. */
  address: string | null;
  positions: OpenPositionView[];
  mark: number | null;
  history: ClosedPositionView[] | null;
  board: LeaderboardRow[] | null;
  closing: number | null;
  onClose: (id: number) => void;
}

const cls = (n: number | null) => (n === null ? "" : n > 0.004 ? "up" : n < -0.004 ? "down" : "");
const sideLabel = (s: string, lev: number) => `${s === "long" ? "Long" : "Short"} ${lev}×`;

function Empty({ cols, text }: { cols: number; text: string }) {
  return <tr><td colSpan={cols} className="dim abi-pt-empty">{text}</td></tr>;
}

function Positions({ rows, mark, closing, onClose }: { rows: OpenPositionView[]; mark: number | null; closing: number | null; onClose: (id: number) => void }) {
  return (
    <table>
      <thead><tr><th>Side</th><th>Size</th><th className="abi-x">Margin</th><th>Entry</th><th className="abi-x">Mark</th><th>PnL</th><th>Liq. price</th><th aria-label="Actions" /></tr></thead>
      <tbody>
        {rows.length === 0 && <Empty cols={8} text={PILOT_COPY.noPositions} />}
        {rows.map((p) => (
          <tr key={p.id}>
            <td className={`n ${p.side === "long" ? "up" : "down"}`}>{sideLabel(p.side, p.lev)}</td>
            <td>{fmtPts(p.notional)}</td>
            <td className="abi-x">{fmtPts(p.margin)}</td>
            <td>{fmtPx(p.entry)}</td>
            <td className="abi-x">{mark === null ? "–" : fmtPx(mark)}</td>
            <td className={cls(p.pnl)}>{p.pnl === null ? "–" : fmtSigned(p.pnl)}</td>
            <td>{fmtPx(p.liq)}</td>
            <td><button type="button" className="abi-pt-close" onClick={() => onClose(p.id)} disabled={closing !== null}>{closing === p.id ? "Closing…" : "Close"}</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function History({ rows }: { rows: ClosedPositionView[] | null }) {
  return (
    <table>
      <thead><tr><th>Closed (UTC)</th><th>Side</th><th className="abi-x">Size</th><th className="abi-x">Entry</th><th>Exit</th><th className="abi-x">Fees</th><th>Net</th><th className="abi-x" /></tr></thead>
      <tbody>
        {rows === null && <Empty cols={8} text="Loading…" />}
        {rows?.length === 0 && <Empty cols={8} text={PILOT_COPY.noHistory} />}
        {rows?.map((p) => (
          <tr key={p.id}>
            <td className="n">{fmtWhen(p.closedAt)}</td>
            <td className={p.side === "long" ? "up" : "down"}>{sideLabel(p.side, p.lev)}</td>
            <td className="abi-x">{fmtPts(p.notional)}</td>
            <td className="abi-x">{fmtPx(p.entry)}</td>
            <td>{fmtPx(p.exit)}</td>
            <td className="abi-x">{fmtPts(p.fee)}</td>
            <td className={cls(p.net)}>{fmtSigned(p.net)}</td>
            <td className="abi-x dim">{p.reason === "liquidation" ? PILOT_COPY.liquidated : PILOT_COPY.closedReason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Leaderboard({ rows, me }: { rows: LeaderboardRow[] | null; me: string | null }) {
  return (
    <table>
      <thead><tr><th>#</th><th>Address</th><th>Equity (pts)</th></tr></thead>
      <tbody>
        {rows === null && <Empty cols={3} text="Loading…" />}
        {rows?.length === 0 && <Empty cols={3} text={PILOT_COPY.noLeaderboard} />}
        {rows?.map((r) => (
          <tr key={r.rank} className={me && r.address === me ? "abi-pt-me" : undefined}>
            <td className="n">{r.rank}</td>
            <td>{r.address}</td>
            <td>{fmtPts(r.equity)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Positions (with Close), History and Leaderboard tabs. */
export function PilotTables(p: PilotTablesProps) {
  const tabs: { k: PilotTab; label: string }[] = [
    { k: "positions", label: p.address ? `Positions (${p.positions.length})` : "Positions" },
    { k: "history", label: "History" },
    { k: "leaderboard", label: "Leaderboard" },
  ];
  const signedOut = !p.address && p.tab !== "leaderboard";
  return (
    <section className="abi-panel" aria-label="Points pilot positions">
      <div className="abi-ph">
        <div className="abi-seg" role="tablist" aria-label="Points pilot tables">
          {tabs.map((t) => (
            <button key={t.k} type="button" role="tab" aria-selected={p.tab === t.k} onClick={() => p.onTab(t.k)}>{t.label}</button>
          ))}
        </div>
        {p.tab === "leaderboard" && <InfoBubble label="About the leaderboard">{PILOT_COPY.leaderboardTip}</InfoBubble>}
      </div>
      <div className="abi-tbl" role="tabpanel">
        {signedOut ? <p className="abi-pt-empty dim">{PILOT_COPY.signInForPositions}</p>
          : p.tab === "positions" ? <Positions rows={p.positions} mark={p.mark} closing={p.closing} onClose={p.onClose} />
            : p.tab === "history" ? <History rows={p.history} />
              : <Leaderboard rows={p.board} me={p.address ? shortWallet(p.address) : null} />}
      </div>
    </section>
  );
}
