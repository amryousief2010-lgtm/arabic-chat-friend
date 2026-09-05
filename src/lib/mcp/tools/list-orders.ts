import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_orders",
  title: "List orders",
  description:
    "List recent orders (order number, status, totals, dates). Optionally filter by status, moderator, or a created_at date range.",
  inputSchema: {
    status: z.string().optional().describe("Order status filter, e.g. pending, delivered, cancelled."),
    moderator: z.string().optional().describe("Moderator name filter (exact match)."),
    date_from: z.string().optional().describe("ISO date (YYYY-MM-DD) lower bound on created_at."),
    date_to: z.string().optional().describe("ISO date (YYYY-MM-DD) upper bound on created_at."),
    limit: z.number().optional().describe("Max rows to return (default 25, max 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, moderator, date_from, date_to, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("orders")
      .select(
        "order_number, status, payment_status, total, subtotal, delivery_fee, moderator, fulfillment_type, shipping_company, created_at, delivered_at",
      )
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(limit ?? 25, 1), 100));
    if (status) q = q.eq("status", status);
    if (moderator) q = q.eq("moderator", moderator);
    if (date_from) q = q.gte("created_at", `${date_from}T00:00:00Z`);
    if (date_to) q = q.lte("created_at", `${date_to}T23:59:59Z`);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { orders: data ?? [] },
    };
  },
});
