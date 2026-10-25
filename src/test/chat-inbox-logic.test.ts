import { describe, it, expect } from "vitest";
import {
  computeKpis, filterConversations, isConversationAbandoned, isDeferredToMorning, maskPhone, sortByActivity,
  firstReplyStatusOf, type InboxConversation,
} from "@/lib/chatManagement/inbox";

const base: InboxConversation = {
  id: "c", line_id: "L1", status: "open", owner_moderator_id: "m1", assigned_moderator_id: "m1", phone_norm: "01000000001",
  customer_id: null, first_inbound_at: null, clock_started_at: null, first_reply_at: null, first_reply_was_cover: null,
  awaiting_reply_since: null, last_inbound_at: null, last_outbound_at: null,
};
const c = (p: Partial<InboxConversation>): InboxConversation => ({ ...base, ...p });
// 2026-06-10: القاهرة UTC+3 ⇒ 09:00Z = 12:00 القاهرة (داخل نافذة الخدمة)
const now = new Date("2026-06-10T10:00:00Z");

describe("inbox logic", () => {
  it("abandoned: unanswered inbound for > 30 service minutes", () => {
    expect(isConversationAbandoned(c({ last_inbound_at: "2026-06-10T09:00:00Z" }), now)).toBe(true);
    expect(isConversationAbandoned(c({ last_inbound_at: "2026-06-10T09:50:00Z" }), now)).toBe(false);
    expect(isConversationAbandoned(c({ last_inbound_at: "2026-06-10T09:00:00Z", last_outbound_at: "2026-06-10T09:05:00Z" }), now)).toBe(false);
    expect(isConversationAbandoned(c({ status: "closed", last_inbound_at: "2026-06-10T09:00:00Z" }), now)).toBe(false);
  });

  it("deferred-to-morning: clock starts later than arrival", () => {
    const night = c({ first_inbound_at: "2026-06-10T00:00:00Z", clock_started_at: "2026-06-10T06:00:00Z", awaiting_reply_since: "2026-06-10T06:00:00Z" });
    expect(isDeferredToMorning(night, new Date("2026-06-10T02:00:00Z"))).toBe(true);
    expect(isDeferredToMorning(night, now)).toBe(true);
    const day = c({ first_inbound_at: "2026-06-10T09:00:00Z", clock_started_at: "2026-06-10T09:00:00Z", awaiting_reply_since: "2026-06-10T09:00:00Z" });
    expect(isDeferredToMorning(day, now)).toBe(false);
    expect(isDeferredToMorning({ ...night, first_reply_at: "2026-06-10T06:05:00Z" }, now)).toBe(false);
  });

  it("cover flag wins over timing", () => {
    expect(firstReplyStatusOf(c({ first_inbound_at: "2026-06-10T09:00:00Z", first_reply_at: "2026-06-10T09:59:00Z", first_reply_was_cover: true }), [], now)).toBe("cover");
    expect(firstReplyStatusOf(c({}), [], now)).toBeNull();
  });

  it("KPIs count on_time / late / cover / abandoned", () => {
    const shift = [{ work_date: "2026-06-10", starts_at: "09:00", ends_at: "17:00", moderator_id: "m1" }] as any;
    const list = [
      c({ id: "a", first_inbound_at: "2026-06-10T09:00:00Z", first_reply_at: "2026-06-10T09:05:00Z" }),
      c({ id: "b", first_inbound_at: "2026-06-10T09:00:00Z", first_reply_at: "2026-06-10T09:40:00Z" }),
      c({ id: "x", first_inbound_at: "2026-06-10T09:00:00Z", first_reply_at: "2026-06-10T09:40:00Z", first_reply_was_cover: true }),
      c({ id: "d", first_inbound_at: "2026-06-10T09:00:00Z", last_inbound_at: "2026-06-10T09:00:00Z" }),
    ];
    const k = computeKpis(list, shift, now);
    expect(k.total).toBe(4);
    expect(k.on_time).toBe(1);
    expect(k.cover).toBe(1);
    expect(k.late).toBe(2); // b متأخر، d لم يرد بعد تجاوز الهدف
    expect(k.abandoned).toBe(1);
  });

  it("filters by status, line, moderator, unassigned, abandoned, deferred", () => {
    const list = [
      c({ id: "1" }), c({ id: "2", line_id: "L2", assigned_moderator_id: null }), c({ id: "3", status: "closed", assigned_moderator_id: "m2" }),
      c({ id: "4", last_inbound_at: "2026-06-10T09:00:00Z" }),
      c({ id: "5", awaiting_reply_since: "2026-06-11T06:00:00Z" }),
    ];
    const ids = (f: any) => filterConversations(list, f, now).map((x) => x.id);
    expect(ids({ status: "closed" })).toEqual(["3"]);
    expect(ids({ lineId: "L2" })).toEqual(["2"]);
    expect(ids({ moderatorId: "unassigned" })).toEqual(["2"]);
    expect(ids({ moderatorId: "m2" })).toEqual(["3"]);
    expect(ids({ abandonedOnly: true })).toEqual(["4"]);
    expect(ids({ deferredOnly: true })).toEqual(["5"]);
    expect(ids({ status: "all", lineId: "all", moderatorId: "all" })).toHaveLength(5);
  });

  it("sort and mask", () => {
    const s = sortByActivity([c({ id: "old", last_inbound_at: "2026-06-10T01:00:00Z" }), c({ id: "new", last_outbound_at: "2026-06-10T08:00:00Z" })]);
    expect(s.map((x) => x.id)).toEqual(["new", "old"]);
    expect(maskPhone("01000000001")).toBe("010•••••001");
    expect(maskPhone(null)).toBe("—");
  });
});
