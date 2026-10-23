/** The index Tab (or Shift+Tab) moves to among `count` focusable controls, wrapping; -1 when there are none. */
export function nextFocusIndex(current: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return backwards ? (current - 1 + count) % count : (current + 1) % count;
}
