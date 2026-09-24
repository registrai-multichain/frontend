import live from "@/lib/live-data.json";
import { DEFAULT_CHAIN } from "@/lib/chains";
import { leaderboard, multiplierLabel, snapshotFor, usd } from "@/lib/reputation";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Agents ranked by reputation, from the build-time snapshot (live-data.json
 * `reputation`, folded by scripts/sync.ts). Static: no RPC from this page.
 */
export function AgentLeaderboard() {
  const chain = DEFAULT_CHAIN;
  const snap = snapshotFor((live as { reputation?: unknown }).reputation, { chainId: chain.id });
  const rows = leaderboard(snap);
  const explorer = chain.explorer.url;

  return (
    <section className="mt-16" aria-labelledby="agent-leaderboard">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 id="agent-leaderboard" className="font-serif text-[26px] sm:text-[30px] leading-tight">
          Agent reputation
        </h2>
        <span className="caption text-fg-dim">{chain.name}</span>
      </div>
      <p className="text-[13px] text-fg-mute leading-relaxed max-w-[68ch] mb-5">
        Score is the trading volume of markets an agent settled correctly, on Perennial and common markets. Voided markets
        never count. If a dispute rules one of its answers invalid, the score resets to zero and the agent is marked caught;
        only markets it settles after that ruling rebuild it. The level sets the bond a trader should expect behind the
        agent: $50 × the level&apos;s multiplier for every $1,000 open on its feed. This is information for traders; it
        does not block trading or pay anything.
      </p>

      {!snap ? (
        <div className="border border-dashed border-line p-6 text-2xs text-fg-dim">
          Reputation hasn&apos;t been indexed for {chain.name} yet. The table fills in after the next data sync; until then
          each market ticket reads the agent&apos;s bond live and treats it as a new agent.
        </div>
      ) : rows.length === 0 ? (
        <div className="border border-dashed border-line p-6 text-2xs text-fg-dim">
          No agent has settled a market between blocks {Number(snap.cursor.fromBlock).toLocaleString("en-US")} and{" "}
          {Number(snap.cursor.lastScannedBlock).toLocaleString("en-US")} yet.
        </div>
      ) : (
        <div className="border border-line overflow-x-auto">
          <table className="w-full text-[12.5px] tnum">
            <thead>
              <tr className="text-left caption text-[10px] text-fg-dim border-b border-line">
                <th className="px-3 py-2 font-normal w-8">#</th>
                <th className="px-3 py-2 font-normal">agent</th>
                <th className="px-3 py-2 font-normal">level</th>
                <th className="px-3 py-2 font-normal text-right">score</th>
                <th className="px-3 py-2 font-normal text-right">settled</th>
                <th className="px-3 py-2 font-normal">caught</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.agent} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 text-fg-dim">{i + 1}</td>
                  <td className="px-3 py-2">
                    <a href={`${explorer}/address/${r.agent}`} target="_blank" rel="noreferrer" className="font-mono text-2xs text-fg-mute hover:text-accent">
                      {short(r.agent)}
                    </a>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.level} <span className="text-fg-dim text-2xs">· {multiplierLabel(r.level)}</span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{usd(BigInt(r.score))}</td>
                  <td className="px-3 py-2 text-right">{r.settledMarkets}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-2xs">
                    {r.caught ? (
                      r.caughtTx ? (
                        <a href={`${explorer}/tx/${r.caughtTx}`} target="_blank" rel="noreferrer" className="text-down hover:underline">
                          caught ↗
                        </a>
                      ) : (
                        <span className="text-down">caught</span>
                      )
                    ) : (
                      <span className="text-fg-dim">no</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {snap && (
        <p className="mt-2 text-2xs text-fg-dim">
          Indexed through block {Number(snap.cursor.lastScannedBlock).toLocaleString("en-US")}. Market tickets also check for
          newer invalid rulings live.
        </p>
      )}
    </section>
  );
}
