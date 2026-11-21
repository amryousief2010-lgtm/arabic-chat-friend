import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PhoneReviewQueueView, type PhoneReviewItem } from "./PhoneReviewQueueView";

const item: PhoneReviewItem = {
  id: "rev-1",
  issue: "multi_customer",
  phone_raw: null,
  phone_norm: "01077770041",
  created_at: "2026-11-08T10:00:00Z",
  customers: [
    {
      id: "cust-a",
      name: "عميل اختبار أ",
      phone: "01077770041",
      phone2: null,
      edit_fields: ["phone"],
      order_count: 1,
      orders: [{
        id: "ord-1",
        order_number: "ORD-TEST-1",
        created_at: "2026-11-08T10:00:00Z",
        status: "pending",
        total: 120,
        moderator: "اختبار",
      }],
    },
    {
      id: "cust-b",
      name: "عميل اختبار ب",
      phone: null,
      phone2: "01077770041",
      edit_fields: ["phone2"],
      order_count: 0,
      orders: [],
    },
  ],
};

describe("PhoneReviewQueueView", () => {
  it("shows each duplicate customer, their orders, and an edit control on the source field", () => {
    render(
      <MemoryRouter>
        <PhoneReviewQueueView
          items={[item]}
          canCorrect
          canManage={false}
          onEdit={vi.fn()}
          onDismiss={vi.fn()}
          onMerge={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("نفس الرقم لأكثر من عميل")).toBeInTheDocument();
    expect(screen.getByText("عميل اختبار أ")).toBeInTheDocument();
    expect(screen.getByText("عميل اختبار ب")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ORD-TEST-1" })).toHaveAttribute("href", "/orders/ord-1");
    expect(screen.getByText("قيد الانتظار")).toBeInTheDocument();
    expect(screen.getByText("لا طلبات في هذا النطاق")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /تعديل/ })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "تجاهل" })).not.toBeInTheDocument();
  });
});
