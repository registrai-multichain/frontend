import { ImageResponse } from "next/og";
import live from "@/lib/live-data.json";
import type { Season } from "@/lib/seasons";

// Required under `output: export` — the route must be generated at build time
// rather than on request, since there is no server to render it.
export const dynamic = "force-static";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Builder Atlas — the running Perennial season";

/**
 * Share card for the atlas, generated at build time from the same snapshot the
 * page renders. A generic brand image tells you nothing about whether the
 * season is worth opening; the dates and the board counts do.
 */
export default function Image() {
  const seasons = (live as unknown as { seasons?: Season[] }).seasons ?? [];
  const season = seasons[seasons.length - 1];
  const boards =
    (live as unknown as {
      seasonBoards?: Record<string, { traders: unknown[]; builders: Array<[string, number]> }>;
    }).seasonBoards ?? {};
  const board = season ? boards[String(season.id)] : undefined;

  // Count what the PAGE shows, not what the raw board holds. Progress is keyed
  // by address and a deactivated builder has no row in `builders`, so the page
  // drops it on the join — a card claiming a ranked builder the visitor cannot
  // find is worse than a card claiming none.
  const active = new Set(
    ((live as unknown as { builders?: Array<{ address: string }> }).builders ?? []).map((b) =>
      b.address.toLowerCase(),
    ),
  );
  const rankedBuilders = (board?.builders ?? []).filter(([addr]) => active.has(addr.toLowerCase()));

  const fmt = (t: number) =>
    new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  // The paper palette (src/app/globals.css .paper-theme): the share card matches the page.
  const PAPER = "#F4EEE1";
  const INK = "#2B2620";
  const GREEN = "#2F6B4F";
  const MUTE = "#6F6353";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          color: INK,
          padding: "68px 72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 26, color: MUTE }}>Perennial · Builder atlas</div>
          <div style={{ display: "flex", fontSize: 88, lineHeight: 1 }}>Where the grind is.</div>
        </div>

        <div style={{ display: "flex", gap: 56, alignItems: "flex-end" }}>
          <Stat label={season ? season.label : "Season"} value={season ? `${fmt(season.startedAt)} – ${fmt(season.endsAt)}` : "—"} accent={GREEN} dim={MUTE} />
          <Stat label="Builders ranked" value={String(rankedBuilders.length)} accent={GREEN} dim={MUTE} />
          <Stat label="Traders ranked" value={String(board?.traders.length ?? 0)} accent={GREEN} dim={MUTE} />
          <div style={{ display: "flex", marginLeft: "auto", fontSize: 22, color: MUTE }}>registrai.cc</div>
        </div>
      </div>
    ),
    size,
  );
}

function Stat({ label, value, accent, dim }: { label: string; value: string; accent: string; dim: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", fontSize: 22, color: dim }}>{label}</div>
      <div style={{ display: "flex", fontSize: 40, color: accent }}>{value}</div>
    </div>
  );
}
