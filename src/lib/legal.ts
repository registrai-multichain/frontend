/** Who runs builder.registrai.cc and how to reach them; the Terms, Privacy notice and pilot rules read from here. */
export const LEGAL = {
  operator: "Registrai",
  contact: "contact@registrai.cc",
  site: "builder.registrai.cc",
  effective: "13 October 2026",
  /** The supervisory authority for a Poland-based controller (GDPR Art. 77). */
  authority: "Prezes Urzędu Ochrony Danych Osobowych (UODO), ul. Stawki 2, 00-193 Warszawa, uodo.gov.pl",
  independence: "Independent. Not affiliated with Circle or Arc.",
} as const;

export const LEGAL_LINKS = [
  { href: "/terms/", label: "Terms" },
  { href: "/privacy/", label: "Privacy" },
  { href: "/pilot-rules/", label: "Pilot rules" },
] as const;
