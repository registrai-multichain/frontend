import type { ReactNode } from "react";
import { newsreader } from "../proposals/fonts";
import type { AdminRole } from "../../lib/builders-admin";
import { shortAddr } from "../../lib/format";
import a from "./admin.module.css";

/** One rail link. `count`: a pending count shown as a badge (null/undefined: none). */
export interface AdminNavItem {
  key: string;
  label: string;
  href: string;
  count?: number | null;
}

/**
 * The builders admin's frame (/admin and /admin/proposals): the approved mockup's
 * left rail — "Registrai admin", the section links (the active one in ink), who is
 * signed in — and the main column. Below 1200 px the rail is a top bar.
 * `foot`: extra rail content under the signed-in line (the /admin wallet and session buttons).
 */
export function AdminShell({
  nav,
  active,
  who,
  foot,
  children,
}: {
  nav: readonly AdminNavItem[];
  active: string | null;
  who: { address: string; role: AdminRole } | null;
  foot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`${a.shell} ${newsreader.variable}`}>
      <nav className={a.rail} aria-label="Admin">
        <div className={a.brand}>Registrai admin</div>
        {nav.map((i) =>
          i.key === active ? (
            <a key={i.key} className={a.navActive} href={i.href} aria-current="page">
              {i.label} {i.count != null && <span className={a.badge}>{i.count}</span>}
            </a>
          ) : (
            <a key={i.key} className={a.navLink} href={i.href}>
              {i.label}
              {i.count != null && <span className={a.badge}>{i.count}</span>}
            </a>
          ),
        )}
        <div className={a.spacer} />
        <div className={a.who}>
          {who ? (
            <>
              Signed in as <br />
              <span className={a.mono}>{shortAddr(who.address).toLowerCase()}</span> · {who.role}
            </>
          ) : (
            "Not signed in"
          )}
        </div>
        {foot}
      </nav>
      <main className={a.main}>{children}</main>
    </div>
  );
}
