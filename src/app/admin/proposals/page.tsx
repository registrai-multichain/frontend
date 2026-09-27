import type { Metadata } from "next";
import { ProposalsAdmin } from "@/components/admin/ProposalsAdmin";

export const metadata: Metadata = { title: "Market proposals · Registrai admin", robots: { index: false, follow: false } };

/** builder.registrai.cc/admin/proposals: the admin chrome (AdminShell, the approved mockup's left rail), shared with /admin. */
export default function AdminProposalsPage() {
  return <ProposalsAdmin />;
}
