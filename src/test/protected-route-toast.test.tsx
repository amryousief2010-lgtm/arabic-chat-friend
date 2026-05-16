import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: toastErrorMock },
}));

const useAuthMock = vi.fn();
vi.mock("@/hooks/useAuth", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useAuth")>(
    "@/hooks/useAuth"
  );
  return { ...actual, useAuth: () => useAuthMock() };
});

import ProtectedRoute from "@/components/ProtectedRoute";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/orders" element={<div data-testid="page">orders</div>} />
        <Route path="/org-chart" element={<div data-testid="page">orgchart</div>} />
        <Route
          path="/"
          element={
            <ProtectedRoute allowedRoles={["general_manager"]}>
              <div data-testid="page">home</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );

describe("ProtectedRoute silent landing", () => {
  beforeEach(() => {
    toastErrorMock.mockClear();
    useAuthMock.mockReset();
  });

  it("does NOT show a toast for private_delivery_rep landing on /", async () => {
    useAuthMock.mockReturnValue({
      user: { id: "u1" },
      role: "private_delivery_rep",
      loading: false,
    });
    renderAt("/");
    await waitFor(() => {
      // Should redirect silently to /orders
    });
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("does NOT show a toast for sales_moderator landing on /", async () => {
    useAuthMock.mockReturnValue({
      user: { id: "u2" },
      role: "sales_moderator",
      loading: false,
    });
    renderAt("/");
    await waitFor(() => {});
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("DOES show a toast when an unrelated role hits a forbidden page", async () => {
    useAuthMock.mockReturnValue({
      user: { id: "u3" },
      role: "accountant",
      loading: false,
    });
    renderAt("/");
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalled();
    });
  });
});
