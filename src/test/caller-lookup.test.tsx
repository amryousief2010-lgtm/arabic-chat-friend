import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/layout/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/layout/Header", () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

import CallerLookup from "@/pages/CallerLookup";

const renderPage = () =>
  render(
    <MemoryRouter>
      <CallerLookup />
    </MemoryRouter>,
  );

const searchFor = async (value: string) => {
  fireEvent.change(screen.getByLabelText("المصري 01 أو +20 أو 0020"), {
    target: { value },
  });
  fireEvent.click(screen.getByRole("button", { name: "بحث" }));
};

describe("caller lookup screen", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("shows the matching customer card, including last contact when stored", async () => {
    rpc.mockResolvedValue({
      data: {
        match: "customer",
        customer: {
          id: "c1",
          name: "منى أحمد",
          area: "مدينة نصر",
          governorate: "القاهرة",
          last_contact: "2026-03-15T14:30:00",
        },
        orders: [
          { created_at: "2026-03-15T14:30:00", status: "delivered", total: 250 },
          { created_at: "2026-01-01T08:00:00", status: "pending", total: 90 },
        ],
      },
      error: null,
    });

    renderPage();
    await searchFor("+20 100-123-4567");

    await waitFor(() => {
      expect(screen.getByText("منى أحمد")).toBeInTheDocument();
    });
    expect(screen.getByText("مدينة نصر")).toBeInTheDocument();
    expect(screen.getByText("تم التوصيل")).toBeInTheDocument();
    expect(screen.getByText("قيد الانتظار")).toBeInTheDocument();
    expect(screen.getByText(/250/)).toBeInTheDocument();
    expect(screen.getByText(/90/)).toBeInTheDocument();
    expect(screen.getByText("آخر تواصل:")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("lookup_caller_by_phone", {
      p_phone: "+20 100-123-4567",
    });
  });

  it("shows عميل جديد for an unknown number and no previous customer", async () => {
    rpc.mockResolvedValue({
      data: { match: "new", customer: null, orders: [] },
      error: null,
    });

    renderPage();
    await searchFor("01055554444");

    await waitFor(() => {
      expect(screen.getByText("عميل جديد")).toBeInTheDocument();
    });
    expect(screen.queryByText("منى أحمد")).not.toBeInTheDocument();
    expect(screen.queryByText("آخر تواصل:")).not.toBeInTheDocument();
  });

  it("shows no customer data when the function rejects the caller", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "not authorized", code: "42501" },
    });

    renderPage();
    await searchFor("01001234567");

    await waitFor(() => {
      expect(screen.getByText("لا يمكنك عرض بيانات العملاء")).toBeInTheDocument();
    });
    expect(screen.queryByText("عميل جديد")).not.toBeInTheDocument();
    expect(screen.queryByText("منى أحمد")).not.toBeInTheDocument();
  });

  it("shows no customer data when the role may see orders but not customers", async () => {
    rpc.mockResolvedValue({
      data: { match: "none", customer: null, orders: [] },
      error: null,
    });

    renderPage();
    await searchFor("0100 123 4567");

    await waitFor(() => {
      expect(screen.getByText("لا يمكنك عرض بيانات العملاء")).toBeInTheDocument();
    });
    expect(screen.queryByText("عميل جديد")).not.toBeInTheDocument();
  });
});
