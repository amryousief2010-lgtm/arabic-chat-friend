import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_products",
  title: "List products",
  description:
    "List products with name, category, selling price and current stock. Optionally search by name or list only low-stock items.",
  inputSchema: {
    search: z.string().optional().describe("Case-insensitive substring of the product name."),
    low_stock_only: z.boolean().optional().describe("Return only products with stock at or below 10."),
    limit: z.number().optional().describe("Max rows to return (default 50, max 200)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, low_stock_only, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("products")
      .select("name, category, price, stock, unit, is_active")
      .order("name", { ascending: true })
      .limit(Math.min(Math.max(limit ?? 50, 1), 200));
    if (search) q = q.ilike("name", `%${search}%`);
    if (low_stock_only) q = q.lte("stock", 10);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { products: data ?? [] },
    };
  },
});
