import { describe, expect, test } from "vitest";

describe("htmlToMarkdown", () => {
  test("our page shapes convert to clean markdown with escaping, absolute links and a Source line", async () => {
    const { page } = await import("../lib/apps-pages");
    const { htmlToMarkdown } = await import("../lib/markdown");
    const body = `<h1>Aave &amp; co</h1>
<p class="muted">Live on mainnet · <a href="/ecosystem/lending/">Lending</a></p>
<p>Lending protocol.<details><summary>i</summary> Payments into the app&#39;s contracts.</details></p>
<h2>Sources</h2>
<ol><li><a href="https://aave.com/" rel="noreferrer">aave.com</a> (2026-10-20)</li><li>Second</li></ol>
<ul><li>One</li><li>Two</li></ul>
<div class="wrap"><table><thead><tr><th>Project</th><th>Status</th></tr></thead><tbody>
<tr><td><a href="/ecosystem/x/">A|B *bold*</a></td><td>Live</td></tr>
<tr><td>C_d</td><td>Announced</td></tr>
</tbody></table></div>
<dl><dt id="payment">Payment</dt><dd>A transfer.</dd></dl>
<p>Address <code>0xabc</code> and <b>Now:</b> 5%.</p>
<script>alert(1)</script>`;
    const md = htmlToMarkdown(page({ title: "t", canonical: "https://builder.registrai.cc/ecosystem/aave/", description: "d", body }), "https://builder.registrai.cc/ecosystem/aave/");
    expect(md.startsWith("# Aave & co\n")).toBe(true);
    expect(md).toContain("Live on mainnet · [Lending](https://builder.registrai.cc/ecosystem/lending/)");
    expect(md).toContain("Lending protocol. (i: Payments into the app's contracts.)");
    expect(md).toContain("## Sources");
    expect(md).toContain("1. [aave.com](https://aave.com/) (2026-10-20)\n2. Second");
    expect(md).toContain("- One\n- Two");
    expect(md).toContain("| Project | Status |\n| --- | --- |\n| [A\\|B \\*bold\\*](https://builder.registrai.cc/ecosystem/x/) | Live |\n| C\\_d | Announced |");
    expect(md).toContain("**Payment**: A transfer.");
    expect(md).toContain("Address `0xabc` and **Now:** 5%.");
    expect(md).not.toMatch(/<[a-z]/i);
    expect(md).not.toContain("alert(1)");
    expect(md).not.toContain("Registrai builders");          // the nav is gone
    expect(md).not.toContain("How we publish");               // the footer is gone
    expect(md).not.toMatch(/\n{3,}/);
    expect(md.trimEnd().endsWith("Source: https://builder.registrai.cc/ecosystem/aave/ · Registrai, builder.registrai.cc, CC BY 4.0")).toBe(true);
  });
  test("review I1: superseded facts keep their 'Earlier facts' label and strikethrough, and stay list items", async () => {
    const { htmlToMarkdown } = await import("../lib/markdown");
    const html = `<main><h2>Token</h2><ul><li><div>Token is FOO</div><div><a href="/x/">src</a> · observed 2026-10-20</div></li></ul>
<details><summary>Earlier facts</summary><ul><li><div><s>Token is BAZ</s></div><div><a href="/y/">src</a> · observed 2026-10-01</div></li></ul></details>
<p>After <details><summary>i</summary> a note.</details> text.</p></main>`;
    const md = htmlToMarkdown(html, "https://builder.registrai.cc/ecosystem/x/");
    expect(md).toContain("## Token\n\n- Token is FOO [src](https://builder.registrai.cc/x/) · observed 2026-10-20");
    expect(md).toContain("**Earlier facts**\n\n- ~~Token is BAZ~~ [src](https://builder.registrai.cc/y/) · observed 2026-10-01");
    expect(md).toContain("After (i: a note.) text.");
    expect(md).not.toMatch(/^\)|\(i:\s*$/m);
  });
  test("a page with a server-rendered summary converts the summary, not the client shell's 'Loading…'", async () => {
    const { htmlToMarkdown } = await import("../lib/markdown");
    const html = `<html><head></head><body><section id="ssr-summary" style="x"><h1>Arc indices</h1><p>Registrai publishes three hourly indices.</p></section><main><h1>Arc Builders Index</h1><p>Loading…</p></main></body></html>`;
    const md = htmlToMarkdown(html, "https://builder.registrai.cc/builders-index/");
    expect(md).toContain("# Arc indices");
    expect(md).toContain("Registrai publishes three hourly indices.");
    expect(md).not.toContain("Loading");
  });
});

