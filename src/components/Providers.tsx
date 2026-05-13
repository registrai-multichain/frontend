"use client";

import { WalletProvider } from "./WalletProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
