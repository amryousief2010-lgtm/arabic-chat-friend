import { describe, expect, it } from "vitest";
import { computeTodayKg } from "@/lib/todayOrderedKg";

const girls = [{ key: "نورا", name: "نورا" }];
describe("kg counter: display-only rows + gifts", () => {
  it("gives مريم/فاطمة their own rows and keeps totals", () => {
    const r = computeTodayKg(
      [{ id: "1", moderator: "مريم", created_by: null, status: "new" },
       { id: "2", moderator: null, created_by: "u", status: "new" },
       { id: "3", moderator: "الشركة", created_by: null, status: "new" }],
      [{ order_id: "1", product_name: "كفتة", quantity: 2 }, { order_id: "2", product_name: "برجر", quantity: 1 },
       { order_id: "3", product_name: "سجق", quantity: 1 },
       { order_id: "1", product_name: " لحم قطع ", quantity: 0.5, is_gift: true, product_id: "p" }],
      new Map([["u", "فاطمه علي"]]), girls, new Map([["p", "كيلو"]]));
    expect(r.perGirl.map((g) => [g.name, g.orders])).toEqual([["نورا", 0], ["مريم", 1], ["فاطمة", 1]]);
    expect(r.unassigned.orders).toBe(1);
    expect(r.total.orders).toBe(3);
    expect(r.gifts).toEqual([{ name: "لحم قطع", quantity: 0.5, unit: "كيلو", lines: 1 }]);
  });
});
