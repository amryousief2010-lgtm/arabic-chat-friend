import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";

import ProtectedRoute from "@/components/ProtectedRoute";
import { isOrderForModerator, MODERATORS } from "@/constants/moderators";

// --- Mock useAuth so ProtectedRoute thinks a sales_moderator is logged in ---
vi.mock("@/hooks/useAuth", async () => {
  const actual = await vi.importActual<any>("@/hooks/useAuth");
  return {
    ...actual,
    useAuth: () => ({
      user: { id: "u-mod-1" },
      role: "sales_moderator",
      loading: false,
    }),
  };
});

// Silence sonner toasts in the redirect path.
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const Page = ({ label }: { label: string }) => <div data-testid="page">{label}</div>;

const renderAt = (path: string, children: ReactNode) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/orders" element={<ProtectedRoute>{children}</ProtectedRoute>} />
        <Route
          path="/warehouse-stock"
          element={<ProtectedRoute>{children}</ProtectedRoute>}
        />
        <Route
          path="/warehouse-stock/moderator/:slug"
          element={<ProtectedRoute>{children}</ProtectedRoute>}
        />
        <Route path="*" element={<div data-testid="redirected">redirected</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe("sales_moderator access + May moderator attribution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders /orders for sales_moderator (not redirected)", async () => {
    renderAt("/orders", <Page label="orders" />);
    await waitFor(() =>
      expect(screen.getByTestId("page")).toHaveTextContent("orders"),
    );
  });

  it("renders /warehouse-stock for sales_moderator (not redirected)", async () => {
    renderAt("/warehouse-stock", <Page label="warehouse-stock" />);
    await waitFor(() =>
      expect(screen.getByTestId("page")).toHaveTextContent("warehouse-stock"),
    );
  });

  it("renders per-moderator warehouse pages for sales_moderator", async () => {
    for (const m of MODERATORS) {
      const { unmount } = renderAt(
        `/warehouse-stock/moderator/${m.slug}`,
        <Page label={`mod-${m.slug}`} />,
      );
      await waitFor(() =>
        expect(screen.getByTestId("page")).toHaveTextContent(`mod-${m.slug}`),
      );
      unmount();
    }
  });

  // --- Order attribution: every current moderator's canonical name and each
  // of her aliases must map to exactly that moderator card (no overlaps).
  // Derived from MODERATORS so it does not break when a moderator leaves.
  it("attributes each moderator's orders to exactly her own card", () => {
    expect(MODERATORS.length).toBeGreaterThan(0);
    for (const expected of MODERATORS) {
      for (const raw of [expected.canonicalModerator, ...expected.aliases]) {
        const matches = MODERATORS.filter((m) => isOrderForModerator(m, raw, null));
        expect(matches.map((m) => m.slug), `raw="${raw}"`).toEqual([expected.slug]);
      }
    }
  });

  it("does not misattribute shipping-company orders to any moderator", () => {
    const matches = MODERATORS.filter((m) =>
      isOrderForModerator(m, "شركة الشحن", null),
    );
    expect(matches).toHaveLength(0);
  });
});
