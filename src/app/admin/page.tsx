import type { Metadata } from "next";
import { BuildersShell } from "@/components/BuildersShell";
import { AdminApp } from "@/components/admin/AdminApp";

export const metadata: Metadata = {
  title: "Admin · Registrai builders",
  description: "Builders site admin.",
  robots: { index: false, follow: false },
};

/**
 * The builders site's admin (invites, onboarding queue, badge actions). The
 * page is static; everything behind it is the session-gated API of the
 * builders-site Pages Functions (builders-site/functions), which exists only on
 * builder.registrai.cc. Anywhere else (registrai.cc, a local static build) it
 * only says where admin runs.
 */
export default function AdminPage() {
  return (
    <BuildersShell wallet>
      <article className="perennial-app-page">
        <AdminApp />
      </article>
    </BuildersShell>
  );
}
