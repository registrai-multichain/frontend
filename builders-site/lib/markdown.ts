/**
 * htmlToMarkdown: the Markdown copy of a page we render ourselves (spec 2026-10-23-machine-readable-copies-design.md).
 * Converts only <main>, without <nav> and <footer>; our pages use a small, known tag set, so a tokenizer is enough
 * (no external parser). Text is entity-decoded and Markdown-escaped; relative links become absolute.
 */
import { ATTRIBUTION } from "./attribution";

const SITE = "https://builder.registrai.cc";
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e: string) => {
  const k = e.toLowerCase();
  if (NAMED[k] !== undefined) return NAMED[k];
  if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
  if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10));
  return m;
});
export const escapeMd = (s: string) => s.replace(/([\\`*_[\]|])/g, "\\$1");
const absolute = (href: string) => (href.startsWith("/") ? `${SITE}${href}` : href);
const attr = (attrs: string, name: string) => decode(attrs.match(new RegExp(`${name}="([^"]*)"`, "i"))?.[1] ?? "");

export function htmlToMarkdown(html: string, canonical: string): string {
  // a static page whose content loads in the browser carries a server-rendered summary for readers without scripts: convert that
  const ssr = html.match(/<section id="ssr-summary"[^>]*>([\s\S]*?)<\/section>/i)?.[1];
  const main = ssr ?? html.match(/<main[^>]*>([\s\S]*)<\/main>/i)?.[1] ?? html;
  // HTML comments go first: React puts <!-- --> between adjacent text nodes in Next's static export
  const src = main.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|form|svg|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const blocks: string[] = [];
  type Buf = { s: string };
  const para: Buf = { s: "" };
  let cell: Buf | null = null;
  let row: string[] | null = null;
  let rows: string[][] | null = null;
  const lists: { ordered: boolean; n: number }[] = [];
  const links: { href: string; at: number; buf: Buf }[] = [];
  let heading = 0;
  // <details>: "i" notes stay inline as " (i: …)"; any other summary ("Earlier facts") becomes a bold line over its block
  const details: ("i" | "block")[] = [];
  let summary: Buf | null = null;
  const target = () => summary ?? cell ?? para;
  const write = (s: string) => { const t = target(); t.s += s; };
  let lastLi = false, inCode = false;   // consecutive list items join with one newline
  const flush = () => { const t = para.s.replace(/[ \t]+/g, " ").trim(); if (t) { blocks.push(heading ? `${"#".repeat(heading)} ${t}` : t); lastLi = false; } para.s = ""; };

  for (const m of src.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g)) {
    const [, close, rawTag, attrs, text] = m;
    if (text !== undefined) {
      const t = decode(text).replace(/\s+/g, " ");
      // inside a code span Markdown takes text literally: no backslash escapes (they would show as written)
      if (t.trim() || target().s) write(inCode ? t : escapeMd(t));
      continue;
    }
    const tag = rawTag.toLowerCase();
    const open = !close;
    switch (tag) {
      case "h1": case "h2": case "h3":
        if (open) { flush(); heading = Number(tag[1]); } else { flush(); heading = 0; }
        break;
      case "div": if (lists.length) { write(" "); break; } flush(); break;   // a <div> inside a list item stays in the item
      case "p": case "section": case "header": case "article": flush(); break;
      case "s": case "del": write("~~"); break;
      case "br": write("\n"); break;
      case "a":
        if (open) links.push({ href: absolute(attr(attrs, "href")), at: target().s.length, buf: target() });
        else { const l = links.pop(); if (l) { const inner = l.buf.s.slice(l.at).trim(); l.buf.s = `${l.buf.s.slice(0, l.at)}${l.href ? `[${inner}](${l.href})` : inner}`; } }
        break;
      case "code": inCode = open; write("`"); break;
      case "b": case "strong": write("**"); break;
      case "ul": case "ol":
        if (open) { flush(); lastLi = false; lists.push({ ordered: tag === "ol", n: 0 }); } else { flush(); lists.pop(); lastLi = false; }
        break;
      case "li":
        if (open) { flush(); } else {
          const l = lists[lists.length - 1], t = para.s.replace(/\s+/g, " ").trim();
          if (l && t) {
            l.n++;
            const item = `${l.ordered ? `${l.n}.` : "-"} ${t}`;
            if (lastLi && l.n > 1) blocks[blocks.length - 1] += `\n${item}`; else blocks.push(item);
            lastLi = true;
          }
          para.s = "";
        }
        break;
      case "dl": flush(); break;
      case "dt": if (open) { flush(); write("**"); } else write("**: "); break;
      case "dd": if (!open) flush(); break;
      case "details": if (open) details.push("i"); else if (details.pop() === "i") write(")"); else flush(); break;
      case "summary":
        if (open) summary = { s: "" };
        else if (summary) {
          const label = summary.s.replace(/\s+/g, " ").trim();
          summary = null;
          if (label === "i" || !details.length) write(" (i: ");
          else { details[details.length - 1] = "block"; flush(); if (label) blocks.push(`**${label}**`); lastLi = false; }
        }
        break;
      case "table": if (open) { flush(); rows = []; } else if (rows) {
        if (rows.length) {
          const w = Math.max(...rows.map((r) => r.length));
          const line = (r: string[]) => `| ${Array.from({ length: w }, (_, i) => r[i] ?? "").join(" | ")} |`;
          blocks.push([line(rows[0]), `| ${Array.from({ length: w }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n"));
        }
        rows = null;
      } break;
      case "tr": if (open) row = []; else if (row && rows) { rows.push(row); row = null; } break;
      case "td": case "th": if (open) cell = { s: "" }; else if (cell) { row?.push(cell.s.replace(/\s+/g, " ").trim()); cell = null; } break;
      default: break;   // every other tag: keep its text only
    }
  }
  flush();
  // the " (i: …)" notes may land after a blank: tidy "text  (i:" and leading spaces
  const md = blocks.map((b) => b.replace(/ {2,}/g, " ").replace(/ \(i: \s*/g, " (i: ").replace(/\s+\)/g, ")")).join("\n\n");
  return `${md.replace(/\n{3,}/g, "\n\n")}\n\nSource: ${canonical} · ${ATTRIBUTION}\n`;
}
