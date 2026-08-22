import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SidebarToggleButton from "@/components/layout/SidebarToggleButton";
import {
  SIDEBAR_COLLAPSED_KEY,
  useSidebarCollapsed,
  readSidebarCollapsed,
} from "@/hooks/useSidebarCollapsed";

const MOBILE_WIDTH = 390;
const DESKTOP_WIDTH = 1280;

/** Force a viewport width and a matching matchMedia implementation. */
const setViewport = (width: number) => {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => {
      const max = /max-width:\s*(\d+)px/.exec(query);
      const min = /min-width:\s*(\d+)px/.exec(query);
      const matches = max ? width <= Number(max[1]) : min ? width >= Number(min[1]) : false;
      return {
        matches,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      };
    },
  });
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
};

/**
 * Mini-shell mirroring DashboardLayout's responsive contract:
 * - desktop sidebar container: `hidden` when collapsed, `hidden md:block` otherwise
 * - mobile bottom navigation: always mounted, independent of the sidebar state
 * - gestures (pull-to-refresh + swipe navigation): enabled purely by `isMobile`
 */
const Shell = ({ path, isMobile }: { path: string; isMobile: boolean }) => {
  const { collapsed, toggle } = useSidebarCollapsed();
  return (
    <div>
      <div
        data-testid="desktop-sidebar-container"
        className={collapsed ? "hidden" : "hidden md:block"}
      >
        <aside data-testid="app-sidebar">sidebar</aside>
      </div>

      <SidebarToggleButton collapsed={collapsed} onToggle={toggle} />

      <nav data-testid="mobile-bottom-nav" aria-label="التنقل السفلي">
        <a href="/orders">الطلبات</a>
      </nav>

      <main
        data-testid="main-content"
        data-pull-to-refresh={isMobile ? "enabled" : "disabled"}
        data-swipe-navigation={isMobile ? "enabled" : "disabled"}
        className={`${collapsed ? "" : "md:mr-64"} p-4 md:p-8 pb-32 md:pb-8`}
      >
        page:{path}
      </main>
    </div>
  );
};

const renderShell = (path: string, isMobile = true) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Shell path={path} isMobile={isMobile} />
    </MemoryRouter>
  );

describe("sidebar on small screens does not conflict with navigation or gestures", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setViewport(MOBILE_WIDTH);
  });

  afterEach(() => {
    cleanup();
    setViewport(DESKTOP_WIDTH);
  });

  it("keeps bottom navigation and gestures available while toggling the sidebar", () => {
    renderShell("/orders");

    expect(screen.getByTestId("mobile-bottom-nav")).toBeInTheDocument();
    expect(screen.getByTestId("main-content")).toHaveAttribute("data-pull-to-refresh", "enabled");
    expect(screen.getByTestId("main-content")).toHaveAttribute("data-swipe-navigation", "enabled");

    fireEvent.click(screen.getByTestId("sidebar-toggle"));

    // collapsing must never remove the mobile navigation or disable gestures
    expect(screen.getByTestId("mobile-bottom-nav")).toBeInTheDocument();
    expect(screen.getByTestId("main-content")).toHaveAttribute("data-pull-to-refresh", "enabled");
    expect(screen.getByTestId("main-content")).toHaveAttribute("data-swipe-navigation", "enabled");
  });

  it("never overlays the desktop sidebar or its toggle over mobile content", () => {
    renderShell("/products");

    // toggle exists but is desktop-only (hidden below the md breakpoint)
    const toggle = screen.getByTestId("sidebar-toggle");
    expect(toggle.className).toContain("hidden");
    expect(toggle.className).toContain("md:flex");

    // sidebar container is hidden on mobile in both states
    const container = screen.getByTestId("desktop-sidebar-container");
    expect(container.className).toContain("hidden");
    expect(container.className).toContain("md:block");

    fireEvent.click(toggle);
    expect(screen.getByTestId("desktop-sidebar-container").className).toBe("hidden");

    // content is never pushed by the desktop sidebar margin on mobile
    expect(screen.getByTestId("main-content").className).not.toContain("md:mr-64");
    expect(screen.getByTestId("main-content").className).toContain("pb-32");
  });

  it("keeps the collapsed state stable across page navigation on mobile", () => {
    renderShell("/orders");
    fireEvent.click(screen.getByTestId("sidebar-toggle"));
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe("1");

    // navigate to another page (remount)
    cleanup();
    renderShell("/customers");
    expect(readSidebarCollapsed()).toBe(true);
    expect(screen.getByTestId("desktop-sidebar-container").className).toBe("hidden");
    expect(screen.getByTestId("mobile-bottom-nav")).toBeInTheDocument();

    // ...and again after a third navigation, the state is still remembered
    cleanup();
    renderShell("/reports");
    expect(screen.getByTestId("desktop-sidebar-container").className).toBe("hidden");
  });

  it("survives a refresh and rotating from mobile to desktop", () => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "1");
    renderShell("/orders");
    expect(screen.getByTestId("desktop-sidebar-container").className).toBe("hidden");

    // rotate / resize to desktop: still collapsed, toggle brings it back
    setViewport(DESKTOP_WIDTH);
    cleanup();
    renderShell("/orders", false);
    expect(screen.getByTestId("desktop-sidebar-container").className).toBe("hidden");

    fireEvent.click(screen.getByTestId("sidebar-toggle"));
    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-sidebar-container").className).toContain("md:block");
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe("0");
  });

  it("stays in sync between two mounted consumers on mobile", () => {
    const Two = () => (
      <MemoryRouter>
        <Shell path="/a" isMobile />
        <div data-testid="second">
          <Shell path="/b" isMobile />
        </div>
      </MemoryRouter>
    );
    render(<Two />);

    const toggles = screen.getAllByTestId("sidebar-toggle");
    fireEvent.click(toggles[0]);

    for (const c of screen.getAllByTestId("desktop-sidebar-container")) {
      expect(c.className).toBe("hidden");
    }
    expect(screen.getAllByTestId("mobile-bottom-nav")).toHaveLength(2);
  });
});

// keep vi referenced for consistent tooling behaviour across the suite
void vi;
