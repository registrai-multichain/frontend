import { describe, expect, test } from "vitest";
import { formatRow, listSql, markAppliedSql, nextLogId } from "./arc-ecosystem-corrections-cli";

describe("ecosystem-corrections script helpers", () => {
  test("list reads approved, unapplied rows only, oldest first; never the IP hash", () => {
    expect(listSql()).toBe("SELECT id, slug, field, text, source_url, domain_match, public_note, decided_at FROM corrections WHERE status = 'approved' ORDER BY decided_at, id");
  });
  test("mark-applied only touches approved rows; ids must be integers", () => {
    expect(markAppliedSql([3, 5], 1000)).toBe("UPDATE corrections SET status = 'applied', applied_at = 1000 WHERE status = 'approved' AND id IN (3, 5)");
    expect(() => markAppliedSql([1.5], 1)).toThrow();
    expect(() => markAppliedSql([Number("x")], 1)).toThrow();
    expect(() => markAppliedSql([], 1)).toThrow();
  });
  test("next log id and a printable row with from=project|reader", () => {
    expect(nextLogId([])).toBe(1);
    expect(nextLogId([{ id: 4 }, { id: 9 }])).toBe(10);
    const row = { id: 3, slug: "visa", field: "summary", text: "t", source_url: null, domain_match: 1, public_note: "n", decided_at: 1 };
    expect(formatRow(row)).toContain("from: project");
    expect(formatRow({ ...row, domain_match: 0 })).toContain("from: reader");
  });
});
