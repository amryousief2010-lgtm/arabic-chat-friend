import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EditOrderItemsDialog from "@/components/orders/EditOrderItemsDialog";
import { toast } from "sonner";

const OFFER = "بوكس العيلة";

const { rpcMock, sideEffects } = vi.hoisted(() => ({
  rpcMock: vi.fn(async () => ({ data: null, error: null })),
  sideEffects: [] as string[],
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
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
    { id: "p-steak", name: "استيك", price: 500, unit: "kg", fixed_weight_kg: null },
    { id: "p-drum", name: "دبوس بالعظم", price: 390, unit: "kg", fixed_weight_kg: 6 },
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
    if (table === "order_items") {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
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
  return { supabase: { from, rpc: (...args: unknown[]) => (rpcMock as (...a: unknown[]) => unknown)(...args) } };
});


const drumLine = { id: "line-drum", product_id: "p-drum", product_name: "دبوس بالعظم", quantity: 6, unit_price: 390, offer_name: null };
const steakLine = { id: "line-steak", product_id: "p-steak", product_name: "استيك", quantity: 1.5, unit_price: 500, offer_name: null };

async function open(items: Array<Record<string, unknown>>) {
  const view = render(
    <EditOrderItemsDialog open onOpenChange={() => {}} orderId="order-1" initialItems={items as any}
      initialDiscount={0} initialDeliveryFee={0} onSaved={() => {}} />,
  );
  await waitFor(() => expect(document.querySelector('option[value="p-drum"]')).toBeTruthy());
  return view;
}

describe("EditOrderItemsDialog fixed-weight lock", () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });
  beforeEach(() => {
    rpcMock.mockClear();
    sideEffects.length = 0;
    vi.mocked(toast.error).mockClear();
  });

  it("steps by the fixed weight and explains the lock", async () => {
    await open([drumLine, steakLine]);
    const inputs = screen.getAllByTestId("qty-input") as HTMLInputElement[];
    expect(inputs[0].step).toBe("6");
    expect(inputs[1].step).toBe("any");
    expect(screen.getAllByTestId("fixed-weight-note")).toHaveLength(1);
    expect(screen.getByTestId("fixed-weight-note").textContent).toContain("6 كجم");
  });

  it("snaps an invalid quantity up to a whole piece on blur", async () => {
    await open([drumLine]);
    const qty = screen.getByTestId("qty-input") as HTMLInputElement;
    fireEvent.change(qty, { target: { value: "7" } });
    fireEvent.blur(qty);
    expect(qty.value).toBe("12");
  });

  it("keeps 12 kg (two pieces) valid and does not touch regular products", async () => {
    await open([{ ...drumLine, quantity: 12 }, steakLine]);
    const inputs = screen.getAllByTestId("qty-input") as HTMLInputElement[];
    fireEvent.blur(inputs[0]);
    fireEvent.blur(inputs[1]);
    expect(inputs[0].value).toBe("12");
    expect(inputs[1].value).toBe("1.5");
    expect(screen.getByTestId("fixed-weight-note").textContent).toContain("2 قطعة");
  });

  it("refuses to save an invalid fixed-weight quantity", async () => {
    await open([drumLine]);
    const qty = screen.getByTestId("qty-input") as HTMLInputElement;
    fireEvent.change(qty, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /حفظ/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toContain("وزنها ثابت 6 كجم");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
