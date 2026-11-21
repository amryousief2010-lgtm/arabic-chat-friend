import { describe, it, expect } from "vitest";
import { funnelByModerator, funnelByAd, spendByDay, lineForSpend, UNMAPPED } from "./adFunnel";

const campaigns = [{ id: "M1", name: "نورا 026", meta_campaign_id: "1", product_tag: null }, { id: "M2", name: "لحوم 2", meta_campaign_id: "2", product_tag: null },
  { id: "A1", name: "إعلان 1", meta_campaign_id: null, product_tag: "AUTO_AD" }];
const maps = [{ campaign_id: "M1", line_id: "L1", valid_from: "2026-10-01", valid_to: null }];
const lines = [{ id: "L1", label: "خط نورا", owner_moderator_id: "N" }];
const spend = [{ campaign_id: "M1", spend_date: "2026-11-01", spend: 100, impressions: 10, clicks: 2 },
  { campaign_id: "M2", spend_date: "2026-11-01", spend: 50.5, impressions: 5, clicks: 1 }];
const convs = [{ conversation_id: "c1", line_id: "L1", moderator_id: "N", campaign_id: "A1", first_reply_status: "on_time", is_abandoned: false },
  { conversation_id: "c2", line_id: "L1", moderator_id: "N", campaign_id: null, first_reply_status: "pending", is_abandoned: true }];
const orders = [{ order_id: "o1", conversation_id: "c1", is_delivered: true, delivered_value: 900 }, { order_id: "o2", conversation_id: "zz", is_delivered: true, delivered_value: 1 }];

describe("adFunnel", () => {
  it("attributes spend via line map and leaves unmapped stages unavailable", () => {
    const r = funnelByModerator({ spend, campaigns, maps, lines, convs, orders, moderatorName: () => "نورا" });
    const nora = r.find((x) => x.key === "N")!;
    expect(nora).toMatchObject({ spend: 100, conversations: 2, from_ad: 1, replied: 1, abandoned: 1, orders: 1, delivered: 1, delivered_value: 900 });
    const un = r.find((x) => x.key === UNMAPPED)!;
    expect(un.spend).toBe(50.5); expect(un.conversations).toBeNull();
    expect(r[r.length - 1].key).toBe(UNMAPPED);
  });
  it("per ad without spend", () => {
    const a = funnelByAd({ ads: [{ campaign_id: "A1", meta_ad_id: "999", name: "x" }], campaigns, maps, lines, convs, orders, spend });
    expect(a).toHaveLength(1); expect(a[0]).toMatchObject({ meta_ad_id: "999", spend: null, conversations: 1, orders: 1, line_campaigns: ["نورا 026"] });
  });
  it("by day + map validity", () => {
    expect(spendByDay(spend)[0]).toMatchObject({ day: "2026-11-01", spend: 150.5, campaigns: 2 });
    expect(lineForSpend(maps, "M1", "2026-09-01")).toBeNull();
  });
});
