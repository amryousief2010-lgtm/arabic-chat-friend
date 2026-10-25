import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  CHAT_MANAGEMENT_SHIFTS_PATH, CHAT_MANAGEMENT_SETTINGS_PATH, CHAT_MANAGEMENT_VIEW_ROLES, canEditChatManagement,
} from "@/config/chatManagement";
import { moduleSections } from "@/components/layout/SidebarMenuSections";

let currentRoles: string[] = [];
vi.mock("@/hooks/useAuth", async () => {
  const actual = await vi.importActual<any>("@/hooks/useAuth");
  return { ...actual, useAuth: () => ({ user: { id: "u" }, role: currentRoles[0], roles: currentRoles, loading: false }) };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import ProtectedRoute from "@/components/ProtectedRoute";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={<ProtectedRoute allowedRoles={CHAT_MANAGEMENT_VIEW_ROLES}><div data-testid="page">ok</div></ProtectedRoute>} />
        <Route path="*" element={<div data-testid="redirected">x</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe("chat management route access", () => {
  beforeEach(() => cleanup());

  it.each([
    [["sales_manager"]], [["marketing_sales_manager", "sales_manager"]], [["general_manager"]],
    [["executive_manager"]], [["marketing_sales_manager"]],
  ])("allows %j", async (roles) => {
    currentRoles = roles;
    for (const p of [CHAT_MANAGEMENT_SHIFTS_PATH, CHAT_MANAGEMENT_SETTINGS_PATH]) {
      cleanup();
      renderAt(p);
      await waitFor(() => expect(screen.getByTestId("page")).toBeInTheDocument());
    }
  });

  it.each([[["sales_moderator"]], [["accountant"]], [["social_media_manager"]], [["marketing_sales_viewer"]]])("blocks %j", async (roles) => {
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
  });

  it("sidebar has the إدارة المحادثات section with both pages", () => {
    const s = moduleSections.find((x) => x.id === "chat-management")!;
    expect(s.label).toBe("إدارة المحادثات");
    expect(s.items.map((i) => i.path)).toEqual([CHAT_MANAGEMENT_SHIFTS_PATH, CHAT_MANAGEMENT_SETTINGS_PATH]);
  });
});
