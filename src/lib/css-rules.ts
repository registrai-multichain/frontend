/**
 * A small CSS rule lister for the paper-UI guard (paper-ui.test.ts): every style
 * rule of a stylesheet with the at-rules it sits in. Not a general CSS parser;
 * it understands what this repo's stylesheets use and refuses anything else.
 */

export type CssRule = {
  /** The enclosing grouping at-rules, outermost first, e.g. ["@media (min-width: 640px)"]. */
  context: string[];
  selector: string;
  body: string;
};

/** At-rules whose blocks hold style rules: descended into. */
const GROUPING = ["@media", "@supports", "@layer", "@container", "@scope"];
/** At-rules whose blocks hold no style rules: skipped. */
const OPAQUE = ["@keyframes", "@-webkit-keyframes", "@font-face", "@property", "@page", "@counter-style", "@font-feature-values"];

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const isAt = (head: string, names: readonly string[]) => names.some((n) => head === n || head.startsWith(`${n} `) || head.startsWith(`${n}(`));

/**
 * Every style rule, descending into grouping at-rules. A block's head is the
 * text after the last `;` before its `{`, so a statement at-rule in front of it
 * (`@tailwind base; :root {`) does not hide the rule. Throws on any other block
 * at-rule, and on unbalanced braces.
 */
export function cssRules(css: string): CssRule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: CssRule[] = [];
  let i = 0;
  const walk = (end: number, context: string[]) => {
    while (i < end) {
      const open = src.indexOf("{", i);
      if (open < 0 || open >= end) {
        if (src.slice(i, end).includes("}")) throw new Error("css: stray '}'");
        i = end;
        return;
      }
      const pre = src.slice(i, open);
      if (pre.includes("}")) throw new Error("css: stray '}'");
      const head = squash(pre.slice(pre.lastIndexOf(";") + 1));
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      if (depth !== 0) throw new Error("css: unbalanced '{'");
      if (head.startsWith("@")) {
        if (isAt(head, GROUPING)) {
          i = open + 1;
          walk(j - 1, [...context, head]);
        } else if (!isAt(head, OPAQUE)) {
          throw new Error(`css: unknown block at-rule "${head}"`);
        }
      } else {
        out.push({ context, selector: head, body: squash(src.slice(open + 1, j - 1)) });
      }
      i = j;
    }
  };
  walk(src.length, []);
  return out;
}

/** A selector list split on its top-level commas (not those inside :is(), :not(), [..]). */
export function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * True when a selector matches only .paper-ui or elements inside it: it starts
 * with the `.paper-ui` compound, and the first combinator after that compound is
 * a descendant or child one (never `+` or `~`, which reach siblings outside).
 */
export function scopedToPaperUi(selector: string): boolean {
  const s = selector.trim();
  const m = /^\.paper-ui(?![\w-])/.exec(s);
  if (!m) return false;
  // the rest of the first compound: classes, attributes, pseudo-classes
  let i = m[0].length;
  let depth = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (depth === 0 && (/\s/.test(ch) || ch === ">" || ch === "+" || ch === "~")) break;
    i++;
  }
  const rest = s.slice(i).trim();
  return rest === "" || !(rest.startsWith("+") || rest.startsWith("~"));
}

/** The rules that define the shared tokens and type: `:root`, `.paper-theme…`, `.paper-type…`. */
export function protectedRules(css: string): CssRule[] {
  return cssRules(css).filter((r) =>
    splitSelectors(r.selector).some((s) => s === ":root" || s.startsWith(":root") || s.startsWith(".paper-theme") || s.startsWith(".paper-type")),
  );
}

/** One line per rule, for the checked-in snapshot. */
export function serializeRules(rules: readonly CssRule[]): string {
  return rules.map((r) => `${r.context.map((c) => `${c} { `).join("")}${r.selector} { ${r.body} }${" }".repeat(r.context.length)}`).join("\n");
}
