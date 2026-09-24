import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MetaAdsMtdSection } from "./MetaAdsMtdSection";
import type { MetaAdsSectionData } from "@/lib/socialMediaAnalytics";

vi.mock("@/lib/socialMediaAnalytics", async () => {
  const actual = await vi.importActual<typeof import("@/lib/socialMediaAnalytics")>("@/lib/socialMediaAnalytics");
  return {
    ...actual,
    fetchMetaAdsSection: vi.fn(),
  };
});

import { fetchMetaAdsSection } from "@/lib/socialMediaAnalytics";

const sample = (): MetaAdsSectionData => ({
  fromDate: "2026-09-01",
  toDate: "2026-09-24",
  rollup: {
    mode: "single",
    spend: 93902.19,
    impressions: 2235494,
    reachSumNotDeduped: 1258520,
    linkClicks: 56468,
    messagingResults: null,
    metaPurchases: 62,
    currency: "EGP",
    periodLabel: "2026-09-01 → 2026-09-24",
    periods: [{ start: "2026-09-01", end: "2026-09-24" }],
  },
  campaigns: [
    {
      id: "c1",
      period_start: "2026-09-01",
      period_end: "2026-09-24",
      account_id: "584894453725328",
      campaign_name: "اية 605",
      status: "active",
      spend_egp: 24918.76,
      results: 2907,
      result_type: "Messaging conversations",
      cost_per_result: 8.57,
      impressions: 711898,
      reach: 337291,
      link_clicks: 13483,
      ctr_all_pct: 4.5,
      cpc_all: 0.77,
      cpm: 35,
      purchases: 6,
    },
  ],
  daily: [],
  orders: [],
  sales: { netSales: 187804.38, orderCount: 40, giftOrdersExcludedFromRevenue: 0 },
  roas: 2,
  series: [],
  weeklyError: null,
  campaignError: null,
  dailyError: null,
  ordersError: null,
});

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MetaAdsMtdSection range={{ from: "2026-09-01T00:00:00.000Z", to: "2026-09-24T12:00:00.000Z" }} />
    </QueryClientProvider>,
  );
}

describe("MetaAdsMtdSection", () => {
  it("shows the approximate ROAS banner, spend, sales, and the daily empty state", async () => {
    vi.mocked(fetchMetaAdsSection).mockResolvedValue(sample());
    renderSection();

    expect(await screen.findByText("اية 605")).toBeInTheDocument();
    expect(screen.getByText(/ROAS تقريبي — مش attribution دقيق/)).toBeInTheDocument();
    expect(screen.getByText("إعلانات Meta / Ads MTD")).toBeInTheDocument();
    expect(screen.getByText("نشطة")).toBeInTheDocument();
    expect(screen.getByText("لم تُستورد لقطات يومية بعد — بوت السوشيال هيرفع JSON قريبًا")).toBeInTheDocument();
    expect(screen.getByText(/٢[٫.]٠٠|2[.,]00/)).toBeInTheDocument();
  });
});
