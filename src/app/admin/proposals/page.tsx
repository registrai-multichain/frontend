import type { Metadata } from "next";
import { ProposalsAdmin } from "@/components/admin/ProposalsAdmin";

export const metadata: Metadata = { title: "Market proposals · Registrai admin", robots: { index: false, follow: false } };

/** builder.registrai.cc/admin/proposals: its own chrome (the approved mockup's left rail), not the /admin shell. */
export default function AdminProposalsPage() {
  return <ProposalsAdmin />;
}
