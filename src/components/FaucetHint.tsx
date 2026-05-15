/**
 * Small banner pointing new testers at the Circle USDC faucet. Without
 * testnet USDC nothing on the site is usable — surfacing the link saves
 * the inevitable first round of "I connected, now what?" questions.
 */
export function FaucetHint({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 text-2xs caption text-fg-dim border border-dashed border-line/60 px-3 py-2 ${className}`}
    >
      <span>need testnet USDC?</span>
      <a
        href="https://faucet.circle.com"
        target="_blank"
        rel="noreferrer"
        className="text-accent hover:underline tnum"
      >
        faucet.circle.com ↗
      </a>
      <span className="hidden sm:inline text-fg-dim">
        · pick Arc Sepolia, paste your wallet address
      </span>
    </div>
  );
}
