import type { Metadata } from "next";
import { ROUNDS } from "@/lib/rounds";

export const metadata: Metadata = {
  title: "Common markets · Registrai",
  description:
    `Five-minute Up/Down rounds on BTC, ETH, SOL, ZEC and HYPE, and event markets, settled on chain by Registrai's rounds agent on ${ROUNDS.label}.`,
};

export default function RoundsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
