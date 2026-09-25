import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Common markets · Registrai",
  description:
    "Five-minute Up/Down rounds on BTC, ETH, SOL, ZEC and HYPE, and event markets, settled on chain by Registrai's rounds agent on Arc testnet.",
};

export default function RoundsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
