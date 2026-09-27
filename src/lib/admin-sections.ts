/**
 * The builders admin's sections (/admin, one at a time, chosen by the URL hash) and
 * its rail, shared by /admin and /admin/proposals (AdminShell). Pure: which sections
 * a session sees follows adminView (builders-admin.ts) exactly as the page gated them
 * before it had a rail.
 */
import type { AdminView } from "./builders-admin";

export type AdminSectionId =
  | "invites"
  | "register-requests"
  | "suggestions"
  | "onboarding"
  | "badges"
  | "recovery"
  | "projects"
  | "nominations"
  | "wonder";

export interface AdminSection {
  id: AdminSectionId;
  /** The rail label. */
  label: string;
  /** The page heading. */
  title: string;
  /** One line under the heading. */
  lede: string;
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    id: "invites",
    label: "Invites",
    title: "Invites",
    lede: "Invite a project, send its claim link, and follow up until it is claimed.",
  },
  {
    id: "register-requests",
    label: "Register requests",
    title: "Register requests",
    lede: "Builders without gas who asked to be registered: one Safe batch once their proofs check out.",
  },
  {
    id: "suggestions",
    label: "Project suggestions",
    title: "Project suggestions",
    lede: "What the public suggested at /suggest: invite it or dismiss it.",
  },
  {
    id: "onboarding",
    label: "Onboarding",
    title: "Onboarding",
    lede: "Builders with a valid proof who still need their caretaker and badge.",
  },
  { id: "badges", label: "Badges", title: "Badges", lede: "Every Verified Builder Badge issued. Revoking one is a Safe batch." },
  {
    id: "recovery",
    label: "Recovery",
    title: "Recovery",
    lede: "Move a builder to a new wallet after a lost key: the Safe starts it, anyone finishes it.",
  },
  { id: "projects", label: "Projects", title: "Projects", lede: "Every active project on chain. Deactivating one is a Safe batch." },
  {
    id: "nominations",
    label: "Nominations",
    title: "Nominations",
    lede: "Review the prepared drafts, then anchor invited projects on chain as nominated.",
  },
  {
    id: "wonder",
    label: "Wonder markets",
    title: "Wonder markets",
    lede: "Nominate invited projects for wonder markets and watch their escrow.",
  },
];

export const DEFAULT_SECTION: AdminSectionId = "invites";

/** What is deployed: a section with nothing to act on is left out, as before. */
export interface AdminDeployment {
  registry: boolean;
  nominations: boolean;
  wonder: boolean;
}

/** The sections this session sees, in rail order (the gating the page always had). */
export function adminSections(view: AdminView, has: AdminDeployment): AdminSection[] {
  const shown: Record<AdminSectionId, boolean> = {
    invites: true,
    "register-requests": true,
    suggestions: true,
    onboarding: true,
    badges: view.badges,
    recovery: view.recovery,
    projects: view.projects && has.registry,
    nominations: view.directOnboard && has.nominations,
    wonder: view.wonder && has.wonder,
  };
  return ADMIN_SECTIONS.filter((s) => shown[s.id]);
}

/** "#badges" → "badges" when the session has it; anything else → the first section (Invites). */
export function sectionFromHash(hash: string, available: readonly Pick<AdminSection, "id">[]): AdminSectionId {
  const id = decodeURIComponent(hash.replace(/^#/, "")).trim().toLowerCase();
  return available.find((s) => s.id === id)?.id ?? available[0]?.id ?? DEFAULT_SECTION;
}

export const PROPOSALS_HREF = "/admin/proposals/";

/** The rail: the sections (as hash links from `base`), then Market proposals. */
export function adminNav(
  sections: readonly AdminSection[],
  base: "" | "/admin/",
  counts: Partial<Record<AdminSectionId | "proposals", number | null>> = {},
): { key: string; label: string; href: string; count?: number | null }[] {
  return [
    ...sections.map((s) => ({ key: s.id, label: s.label, href: `${base}#${s.id}`, count: counts[s.id] ?? null })),
    { key: "proposals", label: "Market proposals", href: PROPOSALS_HREF, count: counts.proposals ?? null },
  ];
}
