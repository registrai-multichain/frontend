/**
 * Small banner pointing new testers at a testnet faucet. Without gas/testnet
 * USDC nothing on the site is usable — surfacing the link saves the inevitable
 * first round of "I connected, now what?" questions.
 *
 * Defaults to the Circle USDC faucet (Arc). Pass `href`/`label`/`hint` to point
 * testers elsewhere — e.g. the Perennial page points at Circle's Arc faucet.
 */
export function FaucetHint({
  className = "",
  href = "https://faucet.circle.com",
  label = "faucet.circle.com",
  hint = "pick Arc Sepolia, paste your wallet address",
}: {
  className?: string;
  href?: string;
  label?: string;
  hint?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 text-2xs caption text-fg-dim border border-dashed border-line px-3 py-2 ${className}`}
    >
      <span>need testnet gas / USDC?</span>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-accent hover:underline tnum"
      >
        {label} ↗
      </a>
      <span className="hidden sm:inline text-fg-dim">· {hint}</span>
    </div>
  );
}
