"use client";

import { useWonderExpiry } from "@/components/wonder/WonderBits";
import { expiryDaysText } from "@/lib/wonder";

/** "180 days" from the escrow's EXPIRY (the default wording until it is read). */
export function WonderExpiryText() {
  return <>{expiryDaysText(useWonderExpiry())}</>;
}
