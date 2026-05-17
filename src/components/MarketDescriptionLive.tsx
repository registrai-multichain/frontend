"use client";

import { useMarketDescription } from "@/lib/hooks/useMarketDescription";

/**
 * Client component that hydrates the creator-supplied market description
 * from the Cloudflare Worker KV. Falls back to the `fallback` prop (the
 * hardcoded MARKET_HOOKS entry) when no description is set.
 */
export function MarketDescriptionLive({
  marketId,
  fallback,
}: {
  marketId: string;
  fallback?: string;
}) {
  const { data, loading } = useMarketDescription(marketId);

  if (loading && !fallback) return null;

  const description = data?.description ?? fallback;
  if (!description) return null;

  return (
    <div className="border-t border-line/60 pt-4">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="caption text-accent">this market</span>
        {data?.creator && (
          <span className="caption text-fg-dim text-[10px] tnum">
            · creator-supplied
          </span>
        )}
      </div>
      <p className="text-[13px] leading-relaxed text-fg max-w-[68ch] whitespace-pre-wrap">
        {description}
      </p>
    </div>
  );
}
