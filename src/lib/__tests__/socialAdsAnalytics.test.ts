import { describe, expect, it } from "vitest";
import {
  approximateRoas,
  buildAdsDailySeries,
  isSocialAdsOrderSource,
  META_ADS_ACCOUNT_ID,
  rollupWeeklyAdSnapshots,
  selectCampaignSnapshotsForRollup,
  socialSourceSales,
  type SocialAdsCampaignSnapshot,
  type SocialAdsWeeklySnapshot,
  type SocialSourceOrder,
} from "../socialMediaAnalytics";

const week = (partial: Partial<SocialAdsWeeklySnapshot> & Pick<SocialAdsWeeklySnapshot, "period_start" | "period_end" | "spend">): SocialAdsWeeklySnapshot => ({
  account_id: META_ADS_ACCOUNT_ID,
  impressions: 0,
  reach_sum_not_deduped: 0,
  link_clicks: 0,
  messaging_results: null,
  meta_purchases: null,
  currency: "EGP",
  ...partial,
});

describe("social ads source group", () => {
  it("matches the Arabic pool, underscore variants, and Latin names", () => {
    expect(isSocialAdsOrderSource(" إعلان ")).toBe(true);
    expect(isSocialAdsOrderSource("اعلان")).toBe(true);
    expect(isSocialAdsOrderSource("حملات فيسبوك")).toBe(true);
    expect(isSocialAdsOrderSource("حملات_فيسبوك")).toBe(true);
    expect(isSocialAdsOrderSource("فيسبوك")).toBe(true);
    expect(isSocialAdsOrderSource("حملات واتساب")).toBe(true);
    expect(isSocialAdsOrderSource("حملات_واتساب")).toBe(true);
    expect(isSocialAdsOrderSource("واتساب")).toBe(true);
    expect(isSocialAdsOrderSource("facebook ads")).toBe(true);
    expect(isSocialAdsOrderSource("Facebook")).toBe(true);
    expect(isSocialAdsOrderSource("WhatsApp")).toBe(true);
  });

  it("does not pull other channels into the ROAS pool", () => {
    expect(isSocialAdsOrderSource("انستجرام")).toBe(false);
    expect(isSocialAdsOrderSource("واتس")).toBe(false);
    expect(isSocialAdsOrderSource("موقع")).toBe(false);
    expect(isSocialAdsOrderSource("")).toBe(false);
    expect(isSocialAdsOrderSource(null)).toBe(false);
  });
});

describe("weekly spend rollup", () => {
  it("uses the single overlapping snapshot and labels its period", () => {
    const rollup = rollupWeeklyAdSnapshots(
      [week({ period_start: "2026-09-01", period_end: "2026-09-24", spend: 93902.19, impressions: 100, link_clicks: 5, meta_purchases: 62 })],
      "2026-09-01",
      "2026-09-24",
    );
    expect(rollup.mode).toBe("single");
    expect(rollup.spend).toBeCloseTo(93902.19);
    expect(rollup.impressions).toBe(100);
    expect(rollup.metaPurchases).toBe(62);
    expect(rollup.periodLabel).toBe("2026-09-01 → 2026-09-24");
  });

  it("prefers the snapshot that covers the selected range instead of summing overlaps", () => {
    const rollup = rollupWeeklyAdSnapshots(
      [
        week({ period_start: "2026-09-01", period_end: "2026-09-10", spend: 1000 }),
        week({ period_start: "2026-09-01", period_end: "2026-09-24", spend: 93902.19 }),
      ],
      "2026-09-01",
      "2026-09-24",
    );
    expect(rollup.mode).toBe("covering");
    expect(rollup.spend).toBeCloseTo(93902.19);
  });

  it("sums weekly snapshots only when their periods do not overlap", () => {
    const rollup = rollupWeeklyAdSnapshots(
      [
        week({ period_start: "2026-09-01", period_end: "2026-09-07", spend: 10, impressions: 1, link_clicks: 1, meta_purchases: 1 }),
        week({ period_start: "2026-09-08", period_end: "2026-09-14", spend: 15, impressions: 2, link_clicks: 3, meta_purchases: 4 }),
      ],
      "2026-09-01",
      "2026-09-14",
    );
    expect(rollup.mode).toBe("sum");
    expect(rollup.spend).toBe(25);
    expect(rollup.impressions).toBe(3);
    expect(rollup.linkClicks).toBe(4);
    expect(rollup.metaPurchases).toBe(5);
  });

  it("ignores other ad accounts", () => {
    const rollup = rollupWeeklyAdSnapshots(
      [week({ account_id: "other", period_start: "2026-09-01", period_end: "2026-09-24", spend: 50 })],
      "2026-09-01",
      "2026-09-24",
    );
    expect(rollup.mode).toBe("none");
    expect(rollup.spend).toBe(0);
  });
});

describe("social net sales and ROAS", () => {
  const orders: SocialSourceOrder[] = [
    { id: "1", total: 100, source: "إعلان", status: "delivered", created_at: "2026-09-02T10:00:00Z", update_status_marker: null, collection_method: "cash" },
    { id: "2", total: 40, source: "فيسبوك", status: "cancelled", created_at: "2026-09-02T11:00:00Z", update_status_marker: null, collection_method: "cash" },
    { id: "3", total: 70, source: "واتساب", status: "delivered", created_at: "2026-09-03T11:00:00Z", update_status_marker: "gift", collection_method: "cash" },
    { id: "4", total: 15, source: "انستجرام", status: "delivered", created_at: "2026-09-03T11:00:00Z", update_status_marker: null, collection_method: "cash" },
  ];

  it("drops cancelled orders and gifts from net sales", () => {
    const sales = socialSourceSales(orders);
    expect(sales.netSales).toBe(100);
    expect(sales.orderCount).toBe(2);
    expect(sales.giftOrdersExcludedFromRevenue).toBe(1);
  });

  it("hides ROAS when spend is zero", () => {
    expect(approximateRoas(100, 0)).toBeNull();
    expect(approximateRoas(200, 100)).toBe(2);
  });
});

describe("daily spend vs Cairo social sales", () => {
  it("buckets an order after Cairo midnight onto the next calendar day", () => {
    const series = buildAdsDailySeries(
      "2026-05-19",
      "2026-05-20",
      [{ day: "2026-05-19", account_id: META_ADS_ACCOUNT_ID, spend: 25 }],
      [{
        id: "late",
        total: 80,
        source: "Facebook Ads",
        status: "delivered",
        created_at: "2026-05-19T23:07:44.192628Z",
        update_status_marker: null,
        collection_method: "cash",
      }],
    );
    const byDay = Object.fromEntries(series.map((point) => [point.date, point]));
    expect(byDay["2026-05-19"].ads_spend).toBe(25);
    expect(byDay["2026-05-19"].social_net_sales).toBe(0);
    expect(byDay["2026-05-20"].ads_spend).toBe(0);
    expect(byDay["2026-05-20"].social_net_sales).toBe(80);
  });

  it("sorts campaigns by spend and keeps the rollup period", () => {
    const rollup = rollupWeeklyAdSnapshots(
      [week({ period_start: "2026-09-01", period_end: "2026-09-24", spend: 10 })],
      "2026-09-01",
      "2026-09-24",
    );
    const campaigns: SocialAdsCampaignSnapshot[] = [
      {
        period_start: "2026-09-01",
        period_end: "2026-09-24",
        account_id: META_ADS_ACCOUNT_ID,
        campaign_name: "small",
        status: "active",
        spend_egp: 10,
        results: 1,
        result_type: "Messaging conversations",
        cost_per_result: 10,
        impressions: 1,
        reach: 1,
        link_clicks: 1,
        ctr_all_pct: 1,
        cpc_all: 1,
        cpm: 1,
        purchases: 0,
      },
      {
        period_start: "2026-09-01",
        period_end: "2026-09-24",
        account_id: META_ADS_ACCOUNT_ID,
        campaign_name: "big",
        status: "active",
        spend_egp: 90,
        results: 2,
        result_type: "Messaging conversations",
        cost_per_result: 45,
        impressions: 2,
        reach: 2,
        link_clicks: 2,
        ctr_all_pct: 2,
        cpc_all: 2,
        cpm: 2,
        purchases: 1,
      },
    ];
    const selected = selectCampaignSnapshotsForRollup(campaigns, rollup);
    expect(selected.map((row) => row.campaign_name)).toEqual(["big", "small"]);
  });
});
