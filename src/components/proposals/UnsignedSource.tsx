/**
 * R54 F1: a proposal's "where the answer comes from" is never part of the team's
 * signature, so a KV write could swap it (say, to a phishing page) under a verified
 * question. It is shown as plain text, never a link, and labelled as unsigned.
 */
export const UNSIGNED_SOURCE_LABEL = "not part of the signed approval";

export function UnsignedSource({ source, labelClassName }: { source: string; labelClassName?: string }) {
  return (
    <>
      <span style={{ overflowWrap: "anywhere" }}>{source}</span> <span className={labelClassName}>({UNSIGNED_SOURCE_LABEL})</span>
    </>
  );
}
