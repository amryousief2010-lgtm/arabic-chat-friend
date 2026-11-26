import { describe, it, expect } from "vitest";
import { deriveSyncState, type ZodexSyncHealth } from "@/components/warehouses/zodex/ZodexSyncStatusPanel";
const now = Date.parse("2026-10-27T12:00:00Z");
const h = (p: Partial<ZodexSyncHealth>): ZodexSyncHealth => ({ last_data_at: "2026-10-27T11:30:00Z", last_full_success_at: null, last_login_failure_at: null,
  failures_24h: 0, hung_runs: 0, last_status: "success", last_error: null, open_auto: 0, open_review: 0, open_blocked: 0, open_no_order: 0, open_suspect: 0, ...p });
describe("deriveSyncState", () => {
  it("ok", () => expect(deriveSyncState(h({}), now)).toBe("ok"));
  it("unmatched ≠ unreachable", () => expect(deriveSyncState(h({ open_review: 3 }), now)).toBe("unmatched"));
  it("login failure after last data → unreachable (the 25/10 case)", () => expect(deriveSyncState(h({ last_login_failure_at: "2026-10-27T11:45:00Z" }), now)).toBe("unreachable"));
  it("stale after 2h", () => expect(deriveSyncState(h({ last_data_at: "2026-10-27T08:00:00Z" }), now)).toBe("stale"));
  it("no data → unreachable", () => expect(deriveSyncState(null, now)).toBe("unreachable"));
});
