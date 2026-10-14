import type { Metadata } from "next";
import Link from "next/link";
import { BuildersShell } from "@/components/BuildersShell";
import { InfoBubble } from "@/components/InfoBubble";
import { CHANGELOG, DATA_API_BASE, ENDPOINTS, ERRORS, FIELDS, HISTORY_START, LICENCE, LIMITS, PRECISION_NOTE } from "@/lib/data-api-docs";

const TITLE = "Data API · Registrai";
const DESCRIPTION = "Public, read-only API for the Arc indices and per-app hourly activity on Arc mainnet.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/data-api" },
  // own share tags: the root layout's carry the landing page's line and image (audit L12)
  openGraph: { type: "website", siteName: "Registrai", title: TITLE, description: DESCRIPTION, url: "https://builder.registrai.cc/data-api/" },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

const H = ({ children }: { children: React.ReactNode }) => <h2 className="pa-h2 mt-8 mb-2">{children}</h2>;
const day = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

/** builder.registrai.cc/data-api: the Data API v1 reference, static. Content: src/lib/data-api-docs.ts. */
export default function DataApiPage() {
  return (
    <BuildersShell>
      <article className="perennial-app-page pa-legal">
        <header className="mb-6">
          <h1 className="pa-h1">Data API</h1>
          <p className="pa-muted">Version 1. Public, read-only, no key. JSON over HTTPS with CORS for any origin.</p>
          <p>{LICENCE} See the <Link href="/terms/">Terms of use</Link>.</p>
        </header>

        <H>Base URL</H>
        <pre className="pa-code"><code>{DATA_API_BASE}</code></pre>

        <H>Endpoints</H>
        {ENDPOINTS.map((e) => (
          <section key={e.path} className="mb-5">
            <h3 className="pa-h3"><code>{e.method} {e.path}</code></h3>
            <p className="pa-muted">Parameters: {e.params}</p>
            <p>{e.returns}</p>
            <pre className="pa-code"><code>{e.example}</code></pre>
          </section>
        ))}
        <p>
          <code>from</code>, <code>to</code>, <code>since</code> are ISO hour closes such as <code>2026-10-14T19:00:00Z</code>, URL-encoded;
          <code> from</code> and <code>to</code> are inclusive. Member ids are the index source, URL-encoded in paths (<code>domain%3Aarchery.wtf</code>).
        </p>

        <H>Fields</H>
        <ul className="pa-list">
          {FIELDS.map((f) => <li key={f.name}><code>{f.name}</code>: {f.text}</li>)}
        </ul>
        <p className="pa-muted">Precision and timestamps <InfoBubble label="Precision and timestamps">{PRECISION_NOTE}</InfoBubble></p>

        <H>History</H>
        <ul className="pa-list">
          <li>Index closes from {day(HISTORY_START.indices)} (base 1,000).</li>
          <li>Member rows from {day(HISTORY_START.members)}, the oldest archived hour.</li>
        </ul>

        <H>Limits</H>
        <ul className="pa-list">
          <li>{LIMITS.requestsPerWindow} requests per {LIMITS.windowSeconds} seconds per IP; above that, requests are refused with 429 for {LIMITS.windowSeconds} seconds.</li>
          <li>At most {LIMITS.historyHours} hours per history request, {LIMITS.membersHourlyHours} on <code>/members/hourly</code>.</li>
          <li>Responses are cached for 60 s (5 min on <code>/verified</code>). Send <code>If-None-Match</code> with the last <code>ETag</code> to get a 304.</li>
        </ul>

        <H>Errors</H>
        <p>Errors are JSON: <code>{"{ \"error\": \"…\" }"}</code>.</p>
        <ul className="pa-list">
          {ERRORS.map((e) => <li key={e.status}><code>{e.status}</code>: {e.text}</li>)}
        </ul>

        <H>Versioning</H>
        <p>Every response carries <code>&quot;version&quot;: 1</code>. Fields are only added within v1. A breaking change ships as <code>/api/v2</code>, with v1 kept for at least 90 days and dated below.</p>

        <H>Changelog</H>
        <ul className="pa-list">
          {CHANGELOG.map((c) => <li key={c.date}>{c.date}: {c.text}</li>)}
        </ul>
      </article>
    </BuildersShell>
  );
}
