"use client";

import { useCallback, useState } from "react";
import { MyBadge } from "./MyBadge";
import { MyBuilderPanel } from "./MyBuilderPanel";
import { VerifyFlow, type ProjectPick } from "./VerifyFlow";

/**
 * /verify's client side: the connected wallet's badge and builder (projects,
 * re-sign prompts, transfer and recovery), then the claim flow for one project.
 * "re-sign this proof" / "add a project" in the panel prefill the flow.
 */
export function VerifyApp() {
  const [pick, setPick] = useState<ProjectPick | null>(null);
  const onPick = useCallback((source: string) => setPick((p) => ({ source, n: (p?.n ?? 0) + 1 })), []);
  return (
    <>
      <MyBadge />
      <MyBuilderPanel onPick={onPick} />
      <VerifyFlow pick={pick} />
    </>
  );
}
