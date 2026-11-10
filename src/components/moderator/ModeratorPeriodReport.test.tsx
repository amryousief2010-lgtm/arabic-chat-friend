import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModeratorPeriodReportView } from "./ModeratorPeriodReport";
import type { ModeratorPeriodReport } from "@/lib/moderatorPeriodReport";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Bar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
}));

const report: ModeratorPeriodReport = {
  from: "2026-11-01",
  to: "2026-11-10",
  conversationsVisible: true,
  moderators: [
    {
      slug: "aya", name: "آية", ordersRegistered: 2, ordersDelivered: 1, deliveredValue: 100, averageOrderValue: 50,
      collectionCollected: 1, collectionNotCollected: 1, collectionOther: 0,
      kgRequested: { meat: 1, bone: 0.5, processed: 0, gifts: 0 }, kgDelivered: { meat: 1, bone: 0, processed: 0, gifts: 0 },
      conversations: 8, onTime: 5, cover: 1, late: 3, unreplied: 2, waitingCustomer: 1,
      inboundMessages: 10, outboundMessages: 9, avgFirstReplyMin: 20, medianFirstReplyMin: 15, conversionPct: 25,
      calls: { answered: 2, missed: 2, under1Min: 1, from1To5Min: 1, over5Min: 0, matchedOrder: 1, answerRate: 50 },
    },
    {
      slug: "noura", name: "نورا", ordersRegistered: 5, ordersDelivered: 4, deliveredValue: 800, averageOrderValue: 160,
      collectionCollected: 4, collectionNotCollected: 1, collectionOther: 0,
      kgRequested: { meat: 2, bone: 1, processed: 0, gifts: 0 }, kgDelivered: { meat: 2, bone: 1, processed: 0, gifts: 0 },
      conversations: 6, onTime: 5, cover: 0, late: 0, unreplied: 0, waitingCustomer: 0,
      inboundMessages: 8, outboundMessages: 8, avgFirstReplyMin: 5, medianFirstReplyMin: 4, conversionPct: 80,
      calls: { answered: 4, missed: 0, under1Min: 0, from1To5Min: 2, over5Min: 2, matchedOrder: 3, answerRate: 100 },
    },
  ],
  daily: [{ day: "2026-11-02", slug: "noura", orders: 5, conversations: 6 }],
  lateByHour: [{ hour: 18, slug: "aya", late: 3 }],
  ads: [{ adName: "إعلان تجريبي", slug: "noura", conversations: 4 }],
};

describe("ModeratorPeriodReportView", () => {
  it("shows the selected range, highlights the lower late count, and switches to a custom range", () => {
    const onPreset = vi.fn();
    const onFrom = vi.fn();
    render(
      <ModeratorPeriodReportView
        report={report}
        loading={false}
        error={null}
        preset="this_month"
        from="2026-11-01"
        to="2026-11-10"
        onPreset={onPreset}
        onFrom={onFrom}
        onTo={vi.fn()}
      />,
    );
    expect(screen.getByText("01/11/2026 – 10/11/2026")).toBeTruthy();
    expect(screen.getByText("إعلان تجريبي")).toBeTruthy();
    expect(screen.getAllByText(/الأفضل/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "الأسبوع" }));
    expect(onPreset).toHaveBeenCalledWith("week");
    fireEvent.change(screen.getByLabelText("من"), { target: { value: "2026-11-03" } });
    expect(onFrom).toHaveBeenCalledWith("2026-11-03");
  });

  it("does not render conversation or hotline tables when they are hidden", () => {
    render(
      <ModeratorPeriodReportView
        report={{ ...report, conversationsVisible: false, ads: [], lateByHour: [], moderators: report.moderators.map((row) => ({ ...row, conversations: null, calls: null, late: null, unreplied: null })) }}
        loading={false}
        error={null}
        preset="today"
        from="2026-11-10"
        to="2026-11-10"
        onPreset={vi.fn()}
        onFrom={vi.fn()}
        onTo={vi.fn()}
      />,
    );
    expect(screen.queryByText("الخط الساخن والإعلانات")).toBeNull();
    expect(screen.getByText(/عندما تسمح بوابة المحادثات/)).toBeTruthy();
  });
});
