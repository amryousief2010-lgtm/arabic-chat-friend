import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";

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
    renderAt("/farm");
    expect(screen.getByTestId("loc").textContent).not.toBe("404");
    renderAt("/hatchery");
    expect(screen.getByTestId("loc").textContent).not.toBe("404");
  });
});
