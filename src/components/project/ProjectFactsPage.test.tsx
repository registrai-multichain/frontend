/** The project page's states and footer, rendered on the server (no fetch: the parts take their state as props). */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { LoadFailed, Missing } from "./ProjectFactsPage";

describe("project page", () => {
  test("missing: no claim the project is absent from the registry; links back to the builders", () => {
    const html = renderToStaticMarkup(<Missing />);
    expect(html).toContain("No public facts for this project yet.");
    expect(html).not.toContain("not in the registry");
    expect(html).toMatch(/href="\/builders\/?"/); // next/link drops the slash outside the build (trailingSlash)
  });
  test("a failed load says so", () => {
    const html = renderToStaticMarkup(<LoadFailed />);
    expect(html).toContain("Couldn&#x27;t load this page. Try again.");
    expect(html).not.toContain("No public facts");
  });
});
