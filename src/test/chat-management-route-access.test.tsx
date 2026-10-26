import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  CHAT_MANAGEMENT_SHIFTS_PATH, CHAT_MANAGEMENT_SETTINGS_PATH, CHAT_MANAGEMENT_VIEW_ROLES, canEditChatManagement,
  CHAT_INBOX_PATH, CHAT_INBOX_ROLES, CHAT_SUPERVISOR_PATH, CHAT_SUPERVISOR_ROLES, CHAT_PHONE_REVIEW_PATH, CHAT_PHONE_REVIEW_ROLES,
  CHAT_KPIS_PATH, CHAT_KPIS_ROLES, CHAT_AD_SPEND_PATH, CHAT_AD_SPEND_ROLES, CHAT_CALLS_PATH, CHAT_CALLS_ROLES, canImportCdr, canListenRecordings, canWriteAdSpend, CHAT_AD_SPEND_WRITE_ROLES, canUploadRecordings,
  canManageConversations,
} from "@/config/chatManagement";
import { moduleSections } from "@/components/layout/SidebarMenuSections";

let currentRoles: string[] = [];
vi.mock("@/hooks/useAuth", async () => {
  const actual = await vi.importActual<any>("@/hooks/useAuth");
  return { ...actual, useAuth: () => ({ user: { id: "u" }, role: currentRoles[0], roles: currentRoles, loading: false }) };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import ProtectedRoute from "@/components/ProtectedRoute";

const renderAt = (path: string, allowed: readonly string[] = CHAT_MANAGEMENT_VIEW_ROLES) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={<ProtectedRoute allowedRoles={allowed as any}><div data-testid="page">ok</div></ProtectedRoute>} />
        <Route path="*" element={<div data-testid="redirected">x</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe("chat management route access", () => {
  beforeEach(() => cleanup());

  it.each([
    [["sales_manager"]], [["marketing_sales_manager", "sales_manager"]], [["general_manager"]],
    [["executive_manager"]], [["marketing_sales_manager"]],
    [["marketing_sales_viewer"]], [["social_media_manager"]],
  ])("allows %j", async (roles) => {
    currentRoles = roles;
    for (const p of [CHAT_MANAGEMENT_SHIFTS_PATH, CHAT_MANAGEMENT_SETTINGS_PATH]) {
      cleanup();
      renderAt(p);
      await waitFor(() => expect(screen.getByTestId("page")).toBeInTheDocument());
    }
  });

  it.each([[["sales_moderator"]], [["accountant"]], [["warehouse_supervisor"]], [["financial_manager"]]])("blocks %j", async (roles) => {
    currentRoles = roles;
    renderAt(CHAT_MANAGEMENT_SHIFTS_PATH);
    await waitFor(() => expect(screen.queryByTestId("page")).toBeNull());
  });

  it("only sales_manager and general_manager can edit", () => {
    expect(canEditChatManagement(["marketing_sales_manager", "sales_manager"])).toBe(true);
    expect(canEditChatManagement(["general_manager"])).toBe(true);
    expect(canEditChatManagement(["executive_manager"])).toBe(false);
    expect(canEditChatManagement(["marketing_sales_manager"])).toBe(false);
    expect(canEditChatManagement(["sales_moderator"])).toBe(false);
    expect(canEditChatManagement(["marketing_sales_viewer"])).toBe(false);
    expect(canEditChatManagement(["social_media_manager"])).toBe(false);
  });

  it("sidebar has the إدارة المحادثات section with all pages", () => {
    const s = moduleSections.find((x) => x.id === "chat-management")!;
    expect(s.label).toBe("إدارة المحادثات");
    expect(s.items.map((i) => i.path)).toEqual([CHAT_INBOX_PATH, CHAT_SUPERVISOR_PATH, CHAT_PHONE_REVIEW_PATH, CHAT_KPIS_PATH, CHAT_AD_SPEND_PATH, CHAT_CALLS_PATH, CHAT_MANAGEMENT_SHIFTS_PATH, CHAT_MANAGEMENT_SETTINGS_PATH]);
    const item = (p: string) => s.items.find((i) => i.path === p)!;
    expect(item(CHAT_INBOX_PATH).roles).toEqual(["sales_moderator"]);
    expect(item(CHAT_SUPERVISOR_PATH).roles).not.toContain("sales_moderator");
    expect(item(CHAT_PHONE_REVIEW_PATH).roles).not.toContain("sales_moderator");
    expect(item(CHAT_MANAGEMENT_SHIFTS_PATH).roles).not.toContain("sales_moderator");
  });

  it("sidebar section is visible to viewers and moderators, hidden from accountant", () => {
    const s = moduleSections.find((x) => x.id === "chat-management")!;
    for (const r of ["sales_manager", "general_manager", "executive_manager", "marketing_sales_manager", "marketing_sales_viewer", "social_media_manager", "sales_moderator"])
      expect(s.roles).toContain(r);
    for (const r of ["accountant", "warehouse_supervisor"]) expect(s.roles).not.toContain(r);
  });

  it("moderator reaches her inbox but not supervisor / phone review / shifts", async () => {
    currentRoles = ["sales_moderator"];
    renderAt(CHAT_INBOX_PATH, CHAT_INBOX_ROLES);
    await waitFor(() => expect(screen.getByTestId("page")).toBeInTheDocument());
    for (const [p, r] of [[CHAT_SUPERVISOR_PATH, CHAT_SUPERVISOR_ROLES], [CHAT_PHONE_REVIEW_PATH, CHAT_PHONE_REVIEW_ROLES], [CHAT_MANAGEMENT_SHIFTS_PATH, CHAT_MANAGEMENT_VIEW_ROLES], [CHAT_KPIS_PATH, CHAT_KPIS_ROLES], [CHAT_AD_SPEND_PATH, CHAT_AD_SPEND_ROLES], [CHAT_CALLS_PATH, CHAT_CALLS_ROLES]] as const) {
      cleanup(); renderAt(p, r);
      await waitFor(() => expect(screen.queryByTestId("page")).toBeNull());
    }
  });

  it.each([[["sales_manager"]], [["general_manager"]], [["executive_manager"]], [["marketing_sales_viewer"]], [["social_media_manager"]]])(
    "supervisor view allows %j", async (roles) => {
      currentRoles = roles;
      renderAt(CHAT_SUPERVISOR_PATH, CHAT_SUPERVISOR_ROLES);
      await waitFor(() => expect(screen.getByTestId("page")).toBeInTheDocument());
    });

  it("phone review: managers only, viewers blocked", async () => {
    for (const roles of [["marketing_sales_viewer"], ["social_media_manager"], ["accountant"]]) {
      currentRoles = roles; cleanup(); renderAt(CHAT_PHONE_REVIEW_PATH, CHAT_PHONE_REVIEW_ROLES);
      await waitFor(() => expect(screen.queryByTestId("page")).toBeNull());
    }
    currentRoles = ["sales_manager"]; cleanup(); renderAt(CHAT_PHONE_REVIEW_PATH, CHAT_PHONE_REVIEW_ROLES);
    await waitFor(() => expect(screen.getByTestId("page")).toBeInTheDocument());
  });

  it("reassign/cover/merge controls only for SM/GM", () => {
    expect(canManageConversations(["sales_manager"])).toBe(true);
    expect(canManageConversations(["general_manager"])).toBe(true);
    for (const r of ["executive_manager", "marketing_sales_manager", "marketing_sales_viewer", "social_media_manager", "sales_moderator"])
      expect(canManageConversations([r])).toBe(false);
  });
  it("step 4 pages: KPIs/calls/ad-spend role gates", () => {
    for (const r of [CHAT_KPIS_ROLES, CHAT_AD_SPEND_ROLES, CHAT_CALLS_ROLES]) {
      expect(r).not.toContain("sales_moderator"); expect(r).not.toContain("accountant"); expect(r).not.toContain("marketing_sales_viewer");
    }
    expect(canWriteAdSpend(["marketing_sales_manager"])).toBe(true);
    expect(canWriteAdSpend(["executive_manager"])).toBe(false);
    expect(CHAT_AD_SPEND_ROLES).toContain("executive_manager"); // EM يرى الصفحة (عرض فقط)
    expect(CHAT_AD_SPEND_WRITE_ROLES).not.toContain("executive_manager");
    expect(canUploadRecordings(["sales_manager"])).toBe(true); expect(canUploadRecordings(["general_manager"])).toBe(true);
    for (const r of ["executive_manager", "marketing_sales_manager", "sales_moderator"]) expect(canUploadRecordings([r])).toBe(false);
    expect(canImportCdr(["sales_manager"])).toBe(true);
    expect(canImportCdr(["marketing_sales_manager"])).toBe(false);
    expect(canListenRecordings(["executive_manager"])).toBe(true);
    expect(canListenRecordings(["marketing_sales_manager"])).toBe(false);
    expect(canListenRecordings(["sales_moderator"])).toBe(false);
  });
});
