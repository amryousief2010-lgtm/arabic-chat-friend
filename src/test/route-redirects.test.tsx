import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";

const LocationProbe = () => {
  const { pathname } = useLocation();
  return <div data-testid="pathname">{pathname}</div>;
};

const TestRoutes = () => (
  <Routes>
    <Route path="/farm" element={<Navigate to="/modules/farm" replace />} />
    <Route path="/hatchery" element={<Navigate to="/modules/hatchery" replace />} />
    <Route path="/modules/farm" element={<LocationProbe />} />
    <Route path="/modules/hatchery" element={<LocationProbe />} />
    <Route path="*" element={<div data-testid="pathname">404</div>} />
  </Routes>
);

describe("Short route redirects", () => {
  it("redirects /farm -> /modules/farm", () => {
    render(
      <MemoryRouter initialEntries={["/farm"]}>
        <TestRoutes />
      </MemoryRouter>
    );
    expect(screen.getByTestId("pathname").textContent).toBe("/modules/farm");
  });

  it("redirects /hatchery -> /modules/hatchery", () => {
    render(
      <MemoryRouter initialEntries={["/hatchery"]}>
        <TestRoutes />
      </MemoryRouter>
    );
    expect(screen.getByTestId("pathname").textContent).toBe("/modules/hatchery");
  });

  it("does not 404 on the short routes", () => {
    render(
      <MemoryRouter initialEntries={["/farm"]}>
        <TestRoutes />
      </MemoryRouter>
    );
    expect(screen.getByTestId("pathname").textContent).not.toBe("404");
  });
});
