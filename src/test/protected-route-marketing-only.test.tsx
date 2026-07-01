import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";

import ProtectedRoute from "@/components/ProtectedRoute";

// --- Mock useAuth: marketing_sales_manager as the ONLY role (Mohamed Sayed) ---
vi.mock("@/hooks/useAuth", async () => {
  const actual = await vi.importActual<any>("@/hooks/useAuth");
  return {
    ...actual,
    useAuth: () => ({
      user: { id: "u-marketing-only" },
      role: "marketing_sales_manager",
      roles: ["marketing_sales_manager"],
      loading: false,
    }),
  };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const Page = ({ label }: { label: string }) => <div data-testid="page">{label}</div>;
const Landing = () => <div data-testid="landing">marketing-dashboard</div>;

const renderAt = (path: string, protectedPath: string, children: ReactNode) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={protectedPath} element={<ProtectedRoute>{children}</ProtectedRoute>} />
        <Route path="/social-media/marketing-dashboard" element={<Landing />} />
        <Route path="*" element={<div data-testid="fallback">fallback</div>} />
      </Routes>
    </MemoryRouter>,
  );

const BLOCKED_PATHS = [
  "/",
  "/orders",
  "/orders/new",
  "/chick-orders",
  "/customers",
  "/products",
  "/offer-boxes",
  "/modules/warehouses",
  "/modules/warehouses/agouza",
  "/warehouse-stock",
  "/warehouse-stock/agouza",
  "/main-treasury",
  "/lab-treasury",
  "/courier-order-custody",
  "/modules/slaughterhouse",
  "/modules/farm",
  "/modules/hatchery",
  "/modules/meat-factory",
  "/modules/feed-factory",
  "/modules/hr",
  "/hr/employees",
  "/private-courier",
  "/private-courier/planning",
];

const ALLOWED_PATHS = [
  "/social-media/marketing-dashboard",
  "/social-media/dashboard",
  "/social-media/expenses",
  "/social-media/export",
  "/reports",
  "/notifications",
  "/internal-messages",
  "/org-chart",
  "/permissions",
  // Moved into the social-media sidebar section via
  // @/config/sidebarOverrides — must remain reachable.
  "/sales/daily-performance-analysis",
  // Kept in their original "Sales & Marketing" section but explicitly
  // allowlisted for Mohamed Sayed so he can open them without a redirect.
  "/team-performance",
  "/moderator-performance",
];


describe("ProtectedRoute — marketing_sales_manager (only role)", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(BLOCKED_PATHS)("blocks %s and redirects to marketing dashboard", async (p) => {
    renderAt(p, p, <Page label={p} />);
    await waitFor(() => {
      expect(screen.queryByTestId("page")).toBeNull();
      expect(screen.getByTestId("landing")).toBeInTheDocument();
    });
  });

  it.each(ALLOWED_PATHS)("allows %s", async (p) => {
    renderAt(p, p, <Page label={p} />);
    await waitFor(() =>
      expect(screen.getByTestId("page")).toHaveTextContent(p),
    );
  });
});

// --- Regression: users with an extra role (e.g. Alaa: marketing + sales_manager)
// must NOT be affected by the marketing-only lockdown. ---
describe("ProtectedRoute — marketing_sales_manager + sales_manager (Alaa)", () => {
  beforeEach(() => vi.resetModules());

  it("does not block /orders for a multi-role user", async () => {
    vi.doMock("@/hooks/useAuth", async () => {
      const actual = await vi.importActual<any>("@/hooks/useAuth");
      return {
        ...actual,
        useAuth: () => ({
          user: { id: "u-multi" },
          role: "sales_manager",
          roles: ["marketing_sales_manager", "sales_manager"],
          loading: false,
        }),
      };
    });
    const { default: ProtectedRouteFresh } = await import("@/components/ProtectedRoute");
    render(
      <MemoryRouter initialEntries={["/orders"]}>
        <Routes>
          <Route
            path="/orders"
            element={
              <ProtectedRouteFresh>
                <div data-testid="page">orders</div>
              </ProtectedRouteFresh>
            }
          />
          <Route path="*" element={<div data-testid="fallback">fallback</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("page")).toHaveTextContent("orders"),
    );
  });
});
