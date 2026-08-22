import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PageTransition from "@/components/layout/PageTransition";
import { SIDEBAR_COLLAPSED_KEY } from "@/hooks/useSidebarCollapsed";

// Light-weight stand-in for the real shell (which pulls in realtime/auth hooks).
vi.mock("@/components/layout/DashboardLayout", async () => {
  const React = await import("react");
  const { useSidebarCollapsed } = await import("@/hooks/useSidebarCollapsed");
  const Layout = ({ children }: { children: React.ReactNode }) => {
    const { collapsed, toggle } = useSidebarCollapsed();
    return (
      <div>
        {!collapsed && <aside data-testid="app-sidebar">sidebar</aside>}
        <button data-testid="sidebar-toggle" onClick={toggle}>
          toggle
        </button>
        <main>{children}</main>
      </div>
    );
  };
  return { default: Layout, useInsideDashboardLayout: () => false };
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <PageTransition>
        <div>page</div>
      </PageTransition>
    </MemoryRouter>
  );

const SHELL_ROUTES = [
  "/",
  "/orders",
  "/products",
  "/customers",
  "/notifications",
  "/sales-targets",
  "/team-performance",
  "/modules/department-monthly-budget",
  "/modules/warehouses/zodex-review",
  "/modules/slaughterhouse",
  "/hr/dashboard",
  "/social-media/marketing-dashboard",
  "/catering",
  "/reports",
  "/settings",
];

const CHROMELESS_ROUTES = ["/auth", "/trust", "/install", "/unauthorized"];

describe("sidebar visibility across routes", () => {
  beforeEach(() => {
    window.localStorage.clear();
    cleanup();
  });

  it.each(SHELL_ROUTES)("renders the sidebar on %s", (path) => {
    renderAt(path);
    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();
  });

  it.each(CHROMELESS_ROUTES)("hides the shell on %s", (path) => {
    renderAt(path);
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
    expect(screen.getByText("page")).toBeInTheDocument();
  });

  it("keeps the in-app toggle available and persists the collapsed state", () => {
    renderAt("/orders");
    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("sidebar-toggle"));
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();
    // toggle itself never disappears
    expect(screen.getByTestId("sidebar-toggle")).toBeInTheDocument();
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe("1");

    // state survives navigation to another page
    cleanup();
    renderAt("/products");
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("sidebar-toggle"));
    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe("0");
  });
});
