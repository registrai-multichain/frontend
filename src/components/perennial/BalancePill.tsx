"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/components/WalletProvider";
import { FUNDS_EVENT } from "@/lib/funds-event";
import { usdText } from "@/lib/plain-words";
import { FundsPanel, useFunds } from "./FundsPanel";
import { CHAIN, D } from "./usePerennialTx";

/** "To trade $42.10 · Add funds" in the top bar, with a wallet on the Perennial chain. Owns the funds panel. */
export function BalancePill() {
  const { address, walletChainId } = useWallet();
  const [open, setOpen] = useState(false);
  const { data } = useFunds(address);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(FUNDS_EVENT, onOpen);
    return () => window.removeEventListener(FUNDS_EVENT, onOpen);
  }, []);
  if (!D.deployed || !address || walletChainId !== CHAIN.id) return null;
  return (
    <>
      <button type="button" className="pa-balance" onClick={() => setOpen(true)}>
        To trade <b>{data ? usdText(data.ledger) : "…"}</b>
        <span className="pa-balance-add"> · Add funds</span>
      </button>
      {open && <FundsPanel onClose={() => setOpen(false)} />}
    </>
  );
}
