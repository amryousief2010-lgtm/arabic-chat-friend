import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_order",
  title: "Get order details",
  description:
    "Get one order by its order number, including its line items (product, quantity, prices).",
  inputSchema: {
    order_number: z.string().trim().describe("The order number, e.g. ORD-20260904-303259."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ order_number }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const { data: order, error } = await supabase
      .from("orders")
      .select(
        "id, order_number, status, payment_status, payment_method, subtotal, discount, delivery_fee, total, moderator, fulfillment_type, shipping_company, shipping_bill_no, notes, created_at, delivered_at",
      )
      .eq("order_number", order_number)
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!order)
      return { content: [{ type: "text", text: `No order found with number ${order_number}` }], isError: true };

    const { data: items } = await supabase
      .from("order_items")
      .select("product_name, quantity, unit_price, total_price, offer_name")
      .eq("order_id", order.id);

    const result = { ...order, items: items ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: { order: result },
    };
  },
});
