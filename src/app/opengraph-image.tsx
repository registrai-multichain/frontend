/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from "next/og";
import live from "@/lib/live-data.json";

export const alt = "Registrai · Onchain oracle protocol";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * 1200×630 PNG generated at build time. Matches the live homepage hero
 * so the Twitter card preview = the landing-page first impression.
 * Pulls the current attested Warsaw value from live-data.json so the
 * number is real, not placeholder.
 */
export default async function og() {
  const latest = live.attestations?.[live.attestations.length - 1];
  const value = latest?.value ?? 17312;
  const valueStr = value.toLocaleString("en-US").replace(/,/g, " ");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#1a1815",
          color: "#e8e4dc",
          padding: "72px 80px",
          fontFamily: "system-ui",
          position: "relative",
        }}
      >
        {/* Top accent line */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: 4,
            width: "100%",
            background: "#e8c87a",
            display: "flex",
          }}
        />

        {/* Top strip */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <div
            style={{
              fontSize: 34,
              letterSpacing: "0.22em",
              fontWeight: 600,
              color: "#e8e4dc",
              display: "flex",
            }}
          >
            REGISTRAI
          </div>
          <div
            style={{
              fontSize: 17,
              letterSpacing: "0.18em",
              color: "#8a857c",
              textTransform: "uppercase",
              display: "flex",
            }}
          >
            v0.1 · arc testnet · may 2026
          </div>
        </div>

        {/* Hero headline — two manual lines for controlled wrap */}
        <div
          style={{
            marginTop: 64,
            fontSize: 78,
            lineHeight: 1.04,
            letterSpacing: "-0.025em",
            color: "#e8e4dc",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex" }}>An onchain oracle</div>
          <div style={{ display: "flex" }}>
            for{" "}
            <span style={{ color: "#e8c87a", marginLeft: 18 }}>
              everything else.
            </span>
          </div>
        </div>

        {/* Subhead */}
        <div
          style={{
            marginTop: 40,
            fontSize: 30,
            color: "#8a857c",
            maxWidth: 1040,
            lineHeight: 1.32,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex" }}>With aggregation that&apos;s</div>
          <div style={{ display: "flex", color: "#84b06a", fontWeight: 500 }}>
            bytecode anyone can re-execute.
          </div>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1, display: "flex" }} />

        {/* Bottom strip — live proof + URL */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                fontSize: 15,
                letterSpacing: "0.18em",
                color: "#8a857c",
                textTransform: "uppercase",
                display: "flex",
              }}
            >
              live · warsaw_resi_pln_sqm
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 16,
                marginTop: 8,
              }}
            >
              <div
                style={{
                  fontSize: 76,
                  letterSpacing: "-0.025em",
                  color: "#e8e4dc",
                  display: "flex",
                }}
              >
                {valueStr}
              </div>
              <div style={{ fontSize: 22, color: "#8a857c", display: "flex" }}>
                PLN/sqm
              </div>
            </div>
            <div
              style={{
                fontSize: 15,
                color: "#4a4640",
                marginTop: 8,
                letterSpacing: "0.04em",
                display: "flex",
              }}
            >
              attested daily · slashable on dispute
            </div>
          </div>

          <div
            style={{
              fontSize: 22,
              letterSpacing: "0.22em",
              color: "#e8c87a",
              textTransform: "uppercase",
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
            }}
          >
            registrai.cc →
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
