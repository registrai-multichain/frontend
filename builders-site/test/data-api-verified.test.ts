import { describe, expect, test, vi } from "vitest";
import { handleVerified, loadVerified, verifiedFromRecords, VERIFIED_KEY } from "../lib/data-api-verified";
import { MemoryKV } from "./memory-kv";

const rec = (o: Partial<{ active: boolean; projects: object[] }>) => ({ builderId: 1, owner: "0x1", active: true, profileURI: "", projects: [], activeProjectCount: 0, source: null, caretaker: "0x0", status: "verified", country: "PL", ...o }) as never;
const proj = (source: string, status: string, o: object = {}) => ({ projectId: 1, source, canonical: true, active: true, addedAt: 1790331946, status, country: "PL", proofUrl: "x", ...o });

describe("/api/v1/verified", () => {
  test("only verified, canonical, active projects of active builders; no addresses or countries", () => {
    const out = verifiedFromRecords([
      rec({ projects: [proj("domain:registrai.cc", "verified"), proj("domain:lapsed.app", "lapsed"), proj("Domain:Bad", "verified", { canonical: false })] }),
      rec({ active: false, projects: [proj("domain:off.app", "verified")] }),
    ]);
    expect(out).toEqual([{ id: "domain:registrai.cc", method: "registry", since: "2026-09-25T10:00:00Z" }]);
    expect(JSON.stringify(out)).not.toMatch(/0x|PL/);
  });
  test("KV-cached for 5 minutes; a failed chain read serves the stale copy; none at all is 503", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const kv = new MemoryKV(); let reads = 0;
    const read = async () => { reads++; return [rec({ projects: [proj("domain:registrai.cc", "verified")] })]; };
    const env = { INVITES: kv } as never;
    expect((await loadVerified(env, {}, read))!.verified).toHaveLength(1);
    await loadVerified(env, {}, read);
    expect(reads).toBe(1);
    const old = JSON.parse((await kv.get(VERIFIED_KEY))!); old.updated = "2000-01-01T00:00:00Z"; await kv.put(VERIFIED_KEY, JSON.stringify(old));
    expect((await loadVerified(env, {}, async () => { throw new Error("rpc 429"); }))!.verified).toHaveLength(1);
    const r = await handleVerified(new Request("https://builder.registrai.cc/api/v1/verified"), { INVITES: new MemoryKV() } as never, { cache: null }, async () => { throw new Error("down"); });
    expect(r.status).toBe(503);
    expect(warn).toHaveBeenCalledWith("data-api verified read failed", expect.any(Error));
    warn.mockRestore();
  });
});
