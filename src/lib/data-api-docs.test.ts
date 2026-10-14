import { describe, expect, it } from "vitest";
import { DATA_API_BASE, ENDPOINTS, HISTORY_START, LIMITS } from "./data-api-docs";

describe("Data API docs content", () => {
  it("lists the seven v1 endpoints, each with a curl example on the public base URL", () => {
    expect(ENDPOINTS.map((e) => e.path)).toEqual(["/indices", "/indices/{index}/hourly", "/members", "/members/{id}/hourly", "/members/hourly", "/members/new", "/verified"]);
    for (const e of ENDPOINTS) expect(e.example).toMatch(new RegExp(`^curl -s '${DATA_API_BASE.replace(/[./]/g, "\\$&")}/`));
  });
  it("states the limits and history start dates the API enforces", () => {
    expect(LIMITS).toEqual({ requestsPerWindow: 100, windowSeconds: 10, historyHours: 744, membersHourlyHours: 168 });
    expect(HISTORY_START).toEqual({ indices: "2026-10-02T00:00:00Z", members: "2026-10-10T23:00:00Z" });
  });
});
