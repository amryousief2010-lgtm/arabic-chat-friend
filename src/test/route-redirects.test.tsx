import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import {
  LEGACY_WAREHOUSE_STOCK_HUB_REDIRECTS,
  LEGACY_WAREHOUSE_STOCK_KEEP,
  warehouseHubTabPath,
} from "@/lib/warehouseHubPaths";

const RedirectWithQuery = ({ to }: { to: string }) => {
  const location = useLocation();
  return <Navigate to={{ pathname: to, search: location.search, hash: location.hash }} replace />;
};

const LocationProbe = () => {
  const { pathname, search, hash } = useLocation();
  return <div data-testid="loc">{pathname + search + hash}</div>;
};

const TestRoutes = () => (
  <Routes>
    <Route path="/farm" element={<RedirectWithQuery to="/modules/farm" />} />
    <Route path="/hatchery" element={<RedirectWithQuery to="/modules/hatchery" />} />
    <Route path="/modules/farm" element={<LocationProbe />} />
    <Route path="/modules/hatchery" element={<LocationProbe />} />
    <Route path="/modules/warehouses" element={<LocationProbe />} />
    {LEGACY_WAREHOUSE_STOCK_HUB_REDIRECTS.map(({ from, tab }) => (
      <Route key={from} path={from} element={<Navigate to={warehouseHubTabPath(tab)} replace />} />
    ))}
    <Route path={LEGACY_WAREHOUSE_STOCK_KEEP.moderatorAvailable} element={<LocationProbe />} />
    <Route path={LEGACY_WAREHOUSE_STOCK_KEEP.agouzaKeeperLanding} element={<LocationProbe />} />
    <Route path={LEGACY_WAREHOUSE_STOCK_KEEP.moderatorSlug} element={<LocationProbe />} />
    <Route path={LEGACY_WAREHOUSE_STOCK_KEEP.mainGuide} element={<LocationProbe />} />
    <Route path="*" element={<div data-testid="loc">404</div>} />
  </Routes>
);

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <TestRoutes />
    </MemoryRouter>
  );

describe("Short route redirects (share links)", () => {
  it("redirects /farm -> /modules/farm", () => {
    renderAt("/farm");
    expect(screen.getByTestId("loc").textContent).toBe("/modules/farm");
  });

  it("redirects /hatchery -> /modules/hatchery", () => {
    renderAt("/hatchery");
    expect(screen.getByTestId("loc").textContent).toBe("/modules/hatchery");
  });

  it("preserves __lovable_token query param on /farm share links", () => {
    renderAt("/farm?__lovable_token=abc.def.ghi");
    expect(screen.getByTestId("loc").textContent).toBe(
      "/modules/farm?__lovable_token=abc.def.ghi"
    );
  });

  it("preserves __lovable_token query param on /hatchery share links", () => {
    renderAt("/hatchery?__lovable_token=xyz123");
    expect(screen.getByTestId("loc").textContent).toBe(
      "/modules/hatchery?__lovable_token=xyz123"
    );
  });

  it("preserves multiple query params + hash", () => {
    renderAt("/farm?foo=1&bar=2#section");
    expect(screen.getByTestId("loc").textContent).toBe(
      "/modules/farm?foo=1&bar=2#section"
    );
  });

  it("does not 404 on the short routes", () => {
    const { getByTestId, unmount } = renderAt("/farm");
    expect(getByTestId("loc").textContent).not.toBe("404");
    unmount();
    const { getByTestId: getByTestId2 } = renderAt("/hatchery");
    expect(getByTestId2("loc").textContent).not.toBe("404");
  });
});

describe("Legacy /warehouse-stock hub redirects (Phase 3)", () => {
  it.each(LEGACY_WAREHOUSE_STOCK_HUB_REDIRECTS)(
    "redirects $from to the matching hub tab",
    ({ from, tab }) => {
      const { unmount } = renderAt(from);
      expect(screen.getByTestId("loc").textContent).toBe(warehouseHubTabPath(tab));
      unmount();
    },
  );

  it("keeps moderator available, agouza landing, slug routes, and the any-auth guide", () => {
    const kept = [
      "/warehouse-stock",
      "/warehouse-stock/agouza",
      "/warehouse-stock/moderator/aya",
      "/warehouse-stock/main/guide",
    ];
    for (const path of kept) {
      const { unmount } = renderAt(path);
      expect(screen.getByTestId("loc").textContent).toBe(path);
      unmount();
    }
  });
});
