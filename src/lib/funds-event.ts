/** "Add funds" from anywhere (the ticket, an empty balance) opens the one funds panel the top bar owns. */
export const FUNDS_EVENT = "registrai:open-funds";
export function openFunds(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FUNDS_EVENT));
}
