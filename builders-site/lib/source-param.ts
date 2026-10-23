/**
 * A project source from a catch-all route segment. Sources contain ":" and "/";
 * clients send encodeURIComponent(source), but a proxy may decode "%2F" into a real
 * "/", which splits it into several segments: rejoin, then decode each piece.
 */
export function sourceParam(p: string | string[] | undefined): string {
  const parts = Array.isArray(p) ? p : p ? [p] : [];
  try {
    return parts.map((s) => decodeURIComponent(s)).join("/");
  } catch {
    return "";
  }
}
