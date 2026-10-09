import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SwapOfferDialog from "@/components/orders/SwapOfferDialog";

const rpcMock = vi.hoisted(() => vi.fn(async (name: string, _args?: Record<string, unknown>) => {
  if (name === "order_box_snapshot_token") return { data: "snap-1", error: null };
  return { data: { ok: true }, error: null };
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/ui/select", () => {
  const React = require("react");
  const collectItems = (node: any, out: any[] = []) => {
    React.Children.forEach(node, (child: any) => {
      if (!child) return;
      if (child.props?.value !== undefined) out.push({ value: child.props.value, children: child.props.children });
      else if (child.props?.children) collectItems(child.props.children, out);
    });
    return out;
  };
  const Select = ({ value, onValueChange, children }: any) => {
    const items = collectItems(children);
    return (
      <select value={value ?? ""} onChange={(event) => onValueChange?.(event.target.value)}>
        <option value="">--</option>
        {items.map((item: any, index: number) => (
          <option key={`${item.value}-${index}`} value={item.value}>
            {item.children}
          </option>
        ))}
      </select>
    );
  };
  const Passthrough = ({ children }: any) => <>{children}</>;
  return {
    Select,
    SelectTrigger: Passthrough,
    SelectValue: Passthrough,
    SelectContent: Passthrough,
    SelectItem: ({ children }: any) => <>{children}</>,
  };
});

vi.mock("@/integrations/supabase/client", () => {
  const rows: Record<string, any> = {
    orders: { discount: 0, extra_charge: 0, delivery_fee: 240, total: 3200, subtotal: 2960 },
    order_items: [
      { id: "b", product_id: "p1", product_name: "برجر", quantity: 2, unit_price: 400, total_price: 800, offer_name: "بوكس الشهر 1600", offer_copy_id: null, is_gift: false },
      { id: "k", product_id: "p2", product_name: "كفتة", quantity: 2, unit_price: 340, total_price: 680, offer_name: "بوكس الشهر 1600", offer_copy_id: null, is_gift: false },
      { id: "s", product_id: "p3", product_name: "سجق", quantity: 2, unit_price: 740, total_price: 1480, offer_name: "بوكس الشهر 1600", offer_copy_id: null, is_gift: false },
    ],
    order_offer_instances: [
      { id: "inst-month", offer_name: "بوكس الشهر 1600", quantity: 2, offer_box_id: "box-month" },
    ],
    order_box_copies: [],
    offer_boxes: [
      { id: "box-month", name: "بوكس الشهر 1600", shipping_cost: 120, is_active: true, offer_price: 1600 },
      { id: "box-neck", name: "عرض الرقاب", shipping_cost: 40, is_active: true, offer_price: 540 },
    ],
    products: [
      { id: "p4", name: "ستيك", price: 100 },
      { id: "p5", name: "كبدة", price: 80 },
    ],
    offer_box_items: [],
  };
  const builder = (data: any) => {
    const promise = Promise.resolve({ data, error: null });
    const chain: any = promise;
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.order = () => chain;
    chain.in = () => chain;
    chain.single = () => Promise.resolve({ data, error: null });
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => ({ select: () => builder(rows[table] ?? []) }),
      rpc: rpcMock,
    },
  };
});

describe("SwapOfferDialog", () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });

  it("lists each identical box separately and deletes only the selected copy", async () => {
    render(
      <SwapOfferDialog
        open
        onOpenChange={() => {}}
        orderId="order-1"
        currentItems={[]}
        onSaved={() => {}}
      />,
    );

    const first = await screen.findByRole("button", { name: /بوكس رقم 1/ });
    const second = screen.getByRole("button", { name: /بوكس رقم 2/ });
    expect(first).toHaveTextContent(/1[,.]?480/);
    expect(second).toHaveTextContent(/1[,.]?480/);

    fireEvent.click(first);
    fireEvent.click(screen.getByRole("button", { name: "حذف نهائي دون استبدال" }));
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الحذف" }));
    const confirmButtons = await screen.findAllByRole("button", { name: "تأكيد الحذف" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith(
      "apply_order_box_copy_change",
      expect.objectContaining({
        p_order_id: "order-1",
        p_target_key: "inst:inst-month:1",
        p_operation: "delete",
        p_snapshot_token: "snap-1",
      }),
    ));
    const args = rpcMock.mock.calls.find((call) => call[0] === "apply_order_box_copy_change")?.[1] as {
      p_target_key: string;
      p_idempotency_key: string;
    };
    expect(args.p_target_key).not.toContain(":2");
    expect(args.p_idempotency_key).toBeTruthy();
  });
});
