import { marketLabels, marketLabelsShort, type MarketSubject } from "@/lib/wonder";

/** A market's unclaimed / community labels (spec "Site"). `compact`: short chips with
 *  the full sentence as their title (inside a market-row button, where the full text
 *  would become every row's accessible name). */
export function MarketLabels({ subject, compact = false }: { subject?: MarketSubject; compact?: boolean }) {
  if (compact) {
    const chips = marketLabelsShort(subject);
    if (!chips.length) return null;
    return (
      <span className="wonder-labels">
        {chips.map((c) => (
          <span key={c.short} className="wonder-label" title={c.full}>{c.short}</span>
        ))}
      </span>
    );
  }
  const labels = marketLabels(subject);
  if (!labels.length) return null;
  return (
    <div className="wonder-labels">
      {labels.map((l) => (
        <span key={l} className="wonder-label">{l}</span>
      ))}
    </div>
  );
}
