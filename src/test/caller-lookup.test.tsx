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
        total_spent: 415,
        orders_count: 8,
        last_order: {
          order_number: "CL-NEW-1",
          created_at: "2026-03-15T14:30:00",
          total: 250,
          status: "delivered",
        },
        open_order: {
          order_number: "CL-MID-1",
          status: "shipped",
          created_at: "2026-02-01T08:00:00",
          total: 10,
        },
        address: "15 شارع عباس العقاد",
        governorate: "القاهرة",
        moderator: "نورا",
        top_products: [
          { name: "فيليه", qty: 6 },
          { name: "ستيك", qty: 4 },
          { name: "مفروم", qty: 2 },
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
    expect(screen.getByText("القاهرة")).toBeInTheDocument();
    expect(screen.getByText("15 شارع عباس العقاد")).toBeInTheDocument();
    expect(screen.getByText("نورا")).toBeInTheDocument();
    expect(screen.getByText("إجمالي المشتريات:")).toBeInTheDocument();
    expect(screen.getByText(/415/)).toBeInTheDocument();
    expect(screen.getByText("عدد الطلبات:")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("آخر طلب")).toBeInTheDocument();
    expect(screen.getByText("CL-NEW-1")).toBeInTheDocument();
    expect(screen.getByText("طلب مفتوح")).toBeInTheDocument();
    expect(screen.getByText("CL-MID-1")).toBeInTheDocument();
    expect(screen.getByText("تم الشحن")).toBeInTheDocument();
    expect(screen.getByText("أكثر المنتجات")).toBeInTheDocument();
    expect(screen.getByText("فيليه")).toBeInTheDocument();
    expect(screen.getByText("ستيك")).toBeInTheDocument();
    expect(screen.getByText("مفروم")).toBeInTheDocument();
    expect(screen.getAllByText("تم التوصيل").length).toBeGreaterThan(0);
    expect(screen.getByText("قيد الانتظار")).toBeInTheDocument();
    expect(screen.getAllByText(/250/).length).toBeGreaterThan(0);
    expect(screen.getByText(/90/)).toBeInTheDocument();
    expect(screen.getByText("آخر تواصل:")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("lookup_caller_by_phone", {
      p_phone: "+20 100-123-4567",
    });
  });

  it("shows an empty open order and no products when the customer has none", async () => {
    rpc.mockResolvedValue({
      data: {
        match: "customer",
        customer: {
          id: "c2",
          name: "سامي حسن",
          area: null,
          governorate: "الجيزة",
          last_contact: null,
        },
        orders: [],
        total_spent: 0,
        orders_count: 0,
        last_order: null,
        open_order: null,
        address: null,
        governorate: "الجيزة",
        moderator: null,
        top_products: [],
      },
      error: null,
    });

    renderPage();
    await searchFor("01223334455");

    await waitFor(() => {
      expect(screen.getByText("سامي حسن")).toBeInTheDocument();
    });
    expect(screen.getByText("لا يوجد طلب")).toBeInTheDocument();
    expect(screen.getByText("لا يوجد طلب مفتوح")).toBeInTheDocument();
    expect(screen.getByText("لا توجد منتجات")).toBeInTheDocument();
    expect(screen.getAllByText("غير محدد").length).toBeGreaterThan(0);
    expect(screen.queryByText("عميل جديد")).not.toBeInTheDocument();
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

  it("finds the customer when the hotline adds 02 before the mobile", async () => {
    rpc.mockResolvedValue({
      data: {
        match: "customer",
        customer: {
          id: "c3",
          name: "عميلة الخط الساخن",
          area: null,
          governorate: null,
          last_contact: null,
        },
        orders: [],
      },
      error: null,
    });

    renderPage();
    await searchFor("0201009875678");

    await waitFor(() => {
      expect(screen.getByText("عميلة الخط الساخن")).toBeInTheDocument();
    });
    expect(rpc).toHaveBeenCalledWith("lookup_caller_by_phone", {
      p_phone: "0201009875678",
    });
    expect(screen.queryByText("أدخل رقم موبايل مصري. المسافات والشرطات مقبولة.")).not.toBeInTheDocument();
  });

  it.each(["+20 2 01009875678", "02 0100 987 5678"])(
    "sends the hotline form %s to the lookup",
    async (value) => {
      rpc.mockResolvedValue({
        data: { match: "new", customer: null, orders: [] },
        error: null,
      });

      renderPage();
      await searchFor(value);

      await waitFor(() => {
        expect(rpc).toHaveBeenCalledWith("lookup_caller_by_phone", { p_phone: value });
      });
    },
  );

  it.each(["0223456789", "02012345678"])(
    "keeps a landline or short 02 number %s invalid without calling the lookup",
    async (value) => {
      renderPage();
      await searchFor(value);

      expect(rpc).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.getByText(/أدخل رقم موبايل مصري/)).toBeInTheDocument();
      });
    },
  );
});
