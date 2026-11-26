import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  B2B_QUOTES_LABEL, B2B_QUOTES_MANAGE_ROLES, B2B_QUOTES_PATH, B2B_QUOTES_VIEW_ROLES, canManageB2BQuotes, isB2BQuoteNotification,
} from "@/config/b2bQuotes";
import { WEBSITE_ORDERS_PATH } from "@/config/websiteOrders";
import { moduleSections } from "@/components/layout/SidebarMenuSections";
import {
  STATUS_LABELS, STATUS_STYLES, b2bErrorMessage, filterQuotes, formatCairo, money, refLabel, statusChangeBlocker, statusCounts,
  type QuoteListRow,
} from "@/lib/b2bQuotes";

let currentRoles: string[] = [];
vi.mock("@/hooks/useAuth", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/hooks/useAuth");
  return { ...actual, useAuth: () => ({ user: { id: "u" }, role: currentRoles[0], roles: currentRoles, loading: false }) };
});
vi.mock("@/hooks/useCmFeatureGate", () => ({
  useCmFeatureGate: () => ({ mode: "roles", loading: false, allowed: null }),
  setCmGateModeCache: vi.fn(), resetCmGateCache: vi.fn(), loadCmGateMode: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import ProtectedRoute from "@/components/ProtectedRoute";

const renderAt = () =>
  render(
    <MemoryRouter initialEntries={[B2B_QUOTES_PATH]}>
      <Routes>
        <Route path={B2B_QUOTES_PATH} element={<ProtectedRoute allowedRoles={B2B_QUOTES_VIEW_ROLES}><div data-testid="page">ok</div></ProtectedRoute>} />
        <Route path="*" element={<div data-testid="redirected">x</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe("B2B quote requests access", () => {
  beforeEach(() => cleanup());

  it("managers = GM / EM / SM; moderators view (RLS limits them to assigned rows)", () => {
    expect(B2B_QUOTES_MANAGE_ROLES).toEqual(["general_manager", "executive_manager", "sales_manager"]);
    expect(B2B_QUOTES_VIEW_ROLES).toEqual(["general_manager", "executive_manager", "sales_manager", "sales_moderator"]);
    expect(canManageB2BQuotes(["sales_manager"])).toBe(true);
    for (const r of ["sales_moderator", "marketing_sales_manager", "catering_sales_b2b", "accountant"])
      expect(canManageB2BQuotes([r])).toBe(false);
  });

  it.each([[["sales_manager"]], [["general_manager"]], [["executive_manager"]], [["sales_moderator"]]])(
    "route allows %j", async (roles) => {
      currentRoles = roles;
      renderAt();
      await waitFor(() => expect(screen.getByTestId("page")).toBeInTheDocument());
    });

  it.each([[["marketing_sales_manager"]], [["marketing_sales_viewer"]], [["accountant"]], [["catering_sales_b2b"]]])(
    "route blocks %j", async (roles) => {
      currentRoles = roles;
      renderAt();
      await waitFor(() => expect(screen.queryByTestId("page")).not.toBeInTheDocument());
    });

  it("sidebar: under «المبيعات والطلبات», separate from «طلبات الموقع»", () => {
    const sales = moduleSections.find((s) => s.id === "sales")!;
    const item = sales.items.find((i) => i.path === B2B_QUOTES_PATH)!;
    expect(item.label).toBe(B2B_QUOTES_LABEL);
    expect(item.label).toBe("طلبات عروض الأسعار – الفنادق والمطاعم");
    expect(item.roles).toEqual(B2B_QUOTES_VIEW_ROLES);
    expect(B2B_QUOTES_PATH).not.toBe(WEBSITE_ORDERS_PATH);
  });

  it("notification types open the page", () => {
    expect(isB2BQuoteNotification("b2b_quote_request")).toBe(true);
    expect(isB2BQuoteNotification("b2b_quote_assigned")).toBe(true);
    expect(isB2BQuoteNotification("new_order")).toBe(false);
    expect(isB2BQuoteNotification(null)).toBe(false);
  });
});

describe("B2B quote helpers", () => {
  const rows: QuoteListRow[] = [
    { id: "1", ref_no: 1001, facility_name: "فندق النيل", facility_type: "hotel", contact_name: "محمود", governorate: "القاهرة", status: "new", possible_match: true, assigned_to: null },
    { id: "2", ref_no: 1002, facility_name: "مطعم الأسرة", facility_type: "restaurant", contact_name: "أحمد", governorate: "الجيزة", status: "quote_sent", possible_match: false, assigned_to: "u" },
    { id: "3", ref_no: 1003, facility_name: "كافيه ريفر", facility_type: "cafe", contact_name: "سارة", governorate: "القاهرة", status: "rejected", possible_match: false, assigned_to: "v" },
  ];
  const base = { status: "all", type: "all", governorate: "all", search: "", matchOnly: false } as const;

  it("Arabic status labels match the decision", () => {
    expect(Object.values(STATUS_LABELS)).toEqual(["جديد", "تم التواصل", "تم إرسال العرض", "تم التعاقد", "مرفوض"]);
  });

  it("status colors use brand palette only (+ neutrals)", () => {
    const allowed = new Set(["#A4288A", "#662D8C", "#F37346", "#FFFFFF", "#FDEEE7", "#B4521F", "#F8C3A8", "#F5E6F2", "#E3B8D9", "#F1F1F3", "#6B6B76", "#DADADF"]);
    for (const s of Object.values(STATUS_STYLES)) for (const c of Object.values(s)) expect(allowed.has(c)).toBe(true);
    expect(STATUS_STYLES.new.bg).toBe("#F37346");
    expect(STATUS_STYLES.contracted.bg).toBe("#662D8C");
  });

  it("filters by status, type, governorate, match, mine and search (incl. HQ ref, hamza-insensitive)", () => {
    expect(filterQuotes(rows, { ...base, status: "new" }).map((r) => r.id)).toEqual(["1"]);
    expect(filterQuotes(rows, { ...base, type: "cafe" }).map((r) => r.id)).toEqual(["3"]);
    expect(filterQuotes(rows, { ...base, governorate: "القاهرة" }).map((r) => r.id)).toEqual(["1", "3"]);
    expect(filterQuotes(rows, { ...base, matchOnly: true }).map((r) => r.id)).toEqual(["1"]);
    expect(filterQuotes(rows, { ...base, mineOnly: true, userId: "u" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterQuotes(rows, { ...base, search: "الاسرة" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterQuotes(rows, { ...base, search: "hq-1003" }).map((r) => r.id)).toEqual(["3"]);
  });

  it("counts by status", () => {
    expect(statusCounts(rows)).toEqual({ all: 3, new: 1, contacted: 0, quote_sent: 1, contracted: 0, rejected: 1 });
  });

  it("status change rules mirror the DB", () => {
    expect(statusChangeBlocker({ next: "quote_sent", amount: null, existingAmount: null, reason: "" })).toBe("اكتب قيمة العرض أولاً");
    expect(statusChangeBlocker({ next: "contracted", amount: null, existingAmount: 5000, reason: "" })).toBeNull();
    expect(statusChangeBlocker({ next: "rejected", amount: null, existingAmount: null, reason: " " })).toBe("اكتب سبب الرفض");
    expect(statusChangeBlocker({ next: "contacted", amount: null, existingAmount: null, reason: "" })).toBeNull();
  });

  it("Latin numerals in money, dates and refs", () => {
    expect(money(48500)).toBe("48,500 ج.م");
    expect(refLabel(1001)).toBe("HQ-1001");
    expect(formatCairo("2026-11-27T09:05:00Z")).toBe("27/11/2026 11:05");
    expect(/[\u0660-\u0669]/.test(money(1234) + formatCairo("2026-11-27T09:05:00Z"))).toBe(false);
  });

  it("maps DB errors to Arabic", () => {
    expect(b2bErrorMessage({ message: "b2b_quote_amount_required" })).toBe("اكتب قيمة العرض أولاً");
    expect(b2bErrorMessage({ message: "other" })).toBe("تعذّر تنفيذ العملية");
  });
});
