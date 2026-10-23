import type { Metadata } from "next";
import { FREEZE } from "@/lib/freeze";

// Markets are frozen (src/lib/freeze.ts): /rounds/ is withdraw-and-claim only.
export const metadata: Metadata = {
  title: "Withdraw and claim · Registrai",
  description: FREEZE.funds,
  robots: { index: false },
};

export default function RoundsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
