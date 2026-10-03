import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EditOrderItemsDialog from "@/components/orders/EditOrderItemsDialog";

const OFFER = "بوكس العيلة";

const { rpcMock, sideEffects } = vi.hoisted(() => ({
  rpcMock: vi.fn(async () => ({ data: null, error: null })),
  sideEffects: [] as string[],
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/ui/select", () => {
  const React = require("react");
  const collectItems = (node: any, out: any[] = []) => {
    React.Children.forEach(node, (c: any) => {
      if (!c) return;
      if (c.props?.value !== undefined) out.push({ value: c.props.value, children: c.props.children });
      else if (c.props?.children) collectItems(c.props.children, out);
    });
    return out;
  };
  const Select = ({ value, onValueChange, children }: any) => {
    const items = collectItems(children);
    return (
      <select value={value ?? ""} onChange={(e) => onValueChange?.(e.target.value)}>
        <option value="" disabled>--</option>
        {items.map((it: any, i: number) => (
          <option key={`${it.value}-${i}`} value={it.value}>
            {it.children}
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
    SelectGroup: Passthrough,
    SelectLabel: Passthrough,
    SelectSeparator: () => null,
  };
});

vi.mock("@/integrations/supabase/client", () => {
  const products = [
    { id: "p-kofta", name: "كفتة", price: 450, unit: "kg" },
    { id: "p-steak", name: "استيك", price: 500, unit: "kg" },
  ];
  const boxes = [
    {
      name: "بوكس العيلة",
      offer_box_items: [
        { custom_price: 290, is_gift: false, products: { name: "كفتة" } },
        { custom_price: 310, is_gift: false, products: { name: "استيك" } },
      ],
    },
  ];
  const from = (table: string) => {
    if (table === "products") {
      return {
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: products, error: null }),
          }),
        }),
      };
    }
    if (table === "offer_boxes") {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: boxes, error: null }),
        }),
      };
    }
    if (table === "orders") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { source_warehouse_id: null }, error: null }),
          }),
        }),
      };
    }
    if (table === "order_offer_instances") {
      return {
        select: () => ({
          eq: () => {
            sideEffects.push("select-instances");
            return Promise.resolve({ data: [{ id: "inst-1", offer_name: "بوكس العيلة" }], error: null });
          },
        }),
        delete: () => ({
          in: (_col: string, ids: string[]) => {
            sideEffects.push(`delete:${ids.join(",")}`);
            return Promise.resolve({ error: null });
          },
        }),
        insert: (rows: unknown) => {
          sideEffects.push(`insert:${JSON.stringify(rows)}`);
          return Promise.resolve({ error: null });
        },
      };
    }
    return { select: () => Promise.resolve({ data: [], error: null }) };
  };
  return { supabase: { from, rpc: (...args: unknown[]) => rpcMock(...args) } };
});

const offerLine = {
  id: "line-offer",
  product_id: "p-kofta",
  product_name: "كفتة",
  quantity: 2,
  unit_price: 290,
  offer_name: OFFER,
};

const money = (n: number) => `${n.toLocaleString()} ج.م`;

function rows() {
  return Array.from(document.querySelectorAll("div.rounded-lg.border"));
}

function rowFields(row: Element) {
  const selects = Array.from(row.querySelectorAll("select")) as HTMLSelectElement[];
  const inputs = Array.from(row.querySelectorAll("input")) as HTMLInputElement[];
  const buttons = Array.from(row.querySelectorAll("button"));
  return {
    product: selects[0],
    offer: selects[1],
    qty: inputs[0],
    price: inputs[1],
    lineTotal: row.querySelector(".text-sm.font-semibold")?.textContent?.trim() ?? "",
    remove: buttons[buttons.length - 1] as HTMLButtonElement,
  };
}

function valueBeside(label: string) {
  const node = screen.getByText(label);
  const spans = node.parentElement?.querySelectorAll("span") ?? [];
  return spans[spans.length - 1]?.textContent?.trim() ?? "";
}

function inputBeside(label: string) {
  const input = screen.getByText(label).parentElement?.querySelector("input");
  if (!input) throw new Error(`missing input for ${label}`);
  return input as HTMLInputElement;
}

async function openDialog(
  initialItems: Array<Record<string, unknown>> = [offerLine],
  initialDeliveryFee = 75,
) {
  const view = render(
    <EditOrderItemsDialog
      open
      onOpenChange={() => {}}
      orderId="order-1"
      initialItems={initialItems as any}
      initialDiscount={0}
      initialDeliveryFee={initialDeliveryFee}
      onSaved={() => {}}
    />,
  );
  await waitFor(() => {
    expect(rowFields(rows()[0]).product.querySelector('option[value="p-kofta"]')).toBeTruthy();
  });
  return view;
}

describe("EditOrderItemsDialog individual product lines", () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });

  beforeEach(() => {
    rpcMock.mockClear();
    sideEffects.length = 0;
  });

  it("leaves an offer-only order unchanged until an individual line is added", async () => {
    await openDialog();

    const offer = rowFields(rows()[0]);
    expect(rows()).toHaveLength(1);
    expect(offer.product.value).toBe("p-kofta");
    expect(offer.qty.value).toBe("2");
    expect(offer.price.value).toBe("290");
    expect(offer.offer.value).toBe(OFFER);
    expect(offer.lineTotal).toBe(money(580));
    expect(valueBeside("المجموع الفرعي للأصناف")).toBe(money(580));
    expect(valueBeside("الإجمالي بعد الخصم")).toBe(money(655));
    expect(inputBeside("الشحن").value).toBe("75");
  });

  it("prices a newly added individual line from the catalog and keeps it separate from the offer", async () => {
    const view = await openDialog();

    fireEvent.click(screen.getByRole("button", { name: /إضافة منتج/ }));

    expect(rows()).toHaveLength(2);
    const added = rowFields(rows()[1]);
    expect(added.offer.value).toBe("__none__");
    expect(added.offer.selectedOptions[0]?.textContent).toBe("بدون عرض");

    fireEvent.change(added.product, { target: { value: "p-kofta" } });

    const individual = rowFields(rows()[1]);
    const offer = rowFields(rows()[0]);
    expect(individual.product.value).toBe("p-kofta");
    expect(individual.offer.value).toBe("__none__");
    expect(individual.offer.selectedOptions[0]?.textContent).toBe("بدون عرض");
    expect(individual.price.value).toBe("450");
    expect(individual.qty.value).toBe("1");
    expect(individual.lineTotal).toBe(money(450));
    expect(offer.price.value).toBe("290");
    expect(offer.qty.value).toBe("2");
    expect(offer.offer.value).toBe(OFFER);
    expect(valueBeside("المجموع الفرعي للأصناف")).toBe(money(1030));
    expect(valueBeside("الإجمالي بعد الخصم")).toBe(money(1105));
    expect(inputBeside("الشحن").value).toBe("75");

    fireEvent.change(individual.qty, { target: { value: "3" } });
    expect(rowFields(rows()[1]).lineTotal).toBe(money(1350));
    expect(rowFields(rows()[0]).qty.value).toBe("2");
    expect(rowFields(rows()[0]).price.value).toBe("290");
    expect(valueBeside("المجموع الفرعي للأصناف")).toBe(money(1930));
    expect(valueBeside("الإجمالي بعد الخصم")).toBe(money(2005));
    expect(inputBeside("الشحن").value).toBe("75");

    fireEvent.change(rowFields(rows()[1]).qty, { target: { value: "1" } });
    fireEvent.click(rowFields(rows()[1]).remove);
    expect(rows()).toHaveLength(1);
    expect(rowFields(rows()[0]).qty.value).toBe("2");
    expect(rowFields(rows()[0]).price.value).toBe("290");
    expect(rowFields(rows()[0]).offer.value).toBe(OFFER);
    expect(valueBeside("المجموع الفرعي للأصناف")).toBe(money(580));
    expect(valueBeside("الإجمالي بعد الخصم")).toBe(money(655));
    expect(inputBeside("الشحن").value).toBe("75");

    fireEvent.click(screen.getByRole("button", { name: /إضافة منتج/ }));
    fireEvent.change(rowFields(rows()[1]).product, { target: { value: "p-kofta" } });
    fireEvent.click(screen.getByRole("button", { name: /حفظ التغييرات/ }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(rpcMock).toHaveBeenCalledWith(
      "save_order_items_edit",
      expect.objectContaining({
        p_order_id: "order-1",
        p_discount: 0,
        p_delivery_fee: 75,
        p_subtotal: 1030,
        p_total: 1105,
      }),
    );
    const savedItems = rpcMock.mock.calls[0][1].p_items;
    expect(savedItems).toEqual([
      expect.objectContaining({
        id: "line-offer",
        product_id: "p-kofta",
        product_name: "كفتة",
        quantity: 2,
        unit_price: 290,
        offer_name: OFFER,
        _deleted: false,
      }),
      expect.objectContaining({
        id: null,
        product_id: "p-kofta",
        product_name: "كفتة",
        quantity: 1,
        unit_price: 450,
        offer_name: null,
        _deleted: false,
      }),
    ]);
    expect(sideEffects).toEqual(["select-instances"]);

    view.unmount();
    await openDialog([
      offerLine,
      {
        id: "line-individual",
        product_id: "p-kofta",
        product_name: "كفتة",
        quantity: 1,
        unit_price: 450,
        offer_name: null,
      },
    ]);

    expect(rows()).toHaveLength(2);
    expect(rowFields(rows()[0]).offer.value).toBe(OFFER);
    expect(rowFields(rows()[0]).price.value).toBe("290");
    expect(rowFields(rows()[0]).qty.value).toBe("2");
    expect(rowFields(rows()[1]).product.value).toBe("p-kofta");
    expect(rowFields(rows()[1]).offer.value).toBe("__none__");
    expect(rowFields(rows()[1]).offer.selectedOptions[0]?.textContent).toBe("بدون عرض");
    expect(rowFields(rows()[1]).price.value).toBe("450");
    expect(inputBeside("الشحن").value).toBe("75");
    expect(valueBeside("المجموع الفرعي للأصناف")).toBe(money(1030));
  });

  it("uses the catalog price when an unsaved line is set back to بدون عرض, and does not reprice a saved line", async () => {
    await openDialog();

    fireEvent.click(screen.getByRole("button", { name: /إضافة منتج/ }));
    fireEvent.change(rowFields(rows()[1]).offer, { target: { value: OFFER } });
    fireEvent.change(rowFields(rows()[1]).product, { target: { value: "p-kofta" } });
    expect(rowFields(rows()[1]).price.value).toBe("290");

    fireEvent.change(rowFields(rows()[1]).offer, { target: { value: "__none__" } });
    expect(rowFields(rows()[1]).offer.selectedOptions[0]?.textContent).toBe("بدون عرض");
    expect(rowFields(rows()[1]).price.value).toBe("450");
    expect(rowFields(rows()[0]).price.value).toBe("290");

    fireEvent.click(screen.getByRole("button", { name: /إضافة منتج/ }));
    fireEvent.change(rowFields(rows()[2]).offer, { target: { value: OFFER } });
    fireEvent.change(rowFields(rows()[2]).product, { target: { value: "p-steak" } });
    expect(rowFields(rows()[2]).price.value).toBe("310");
    fireEvent.change(rowFields(rows()[2]).offer, { target: { value: "__none__" } });
    expect(rowFields(rows()[2]).price.value).toBe("500");
    expect(rowFields(rows()[2]).offer.value).toBe("__none__");

    fireEvent.change(rowFields(rows()[0]).offer, { target: { value: "__none__" } });
    expect(rowFields(rows()[0]).offer.value).toBe("__none__");
    expect(rowFields(rows()[0]).price.value).toBe("290");
    expect(inputBeside("الشحن").value).toBe("75");
  });

  it("still attaches a new gift to the order's only offer", async () => {
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: /إضافة هدية/ }));
    const gift = rowFields(rows()[1]);
    expect(gift.offer.value).toBe(OFFER);
    expect(gift.price.value).toBe("");
    fireEvent.change(gift.product, { target: { value: "p-kofta" } });
    fireEvent.change(rowFields(rows()[1]).offer, { target: { value: "__none__" } });
    expect(rowFields(rows()[1]).offer.value).toBe("__none__");
    expect(rowFields(rows()[1]).price.value).toBe("");
    expect(rowFields(rows()[0]).price.value).toBe("290");
  });
});
