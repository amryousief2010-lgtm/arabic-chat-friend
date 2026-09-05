import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

function num(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export default defineTool({
  name: "sales_summary",
  title: "Sales summary",
  description:
    "Aggregated sales summary for a date range: order counts by status, total sales, average order value, and top moderators.",
  inputSchema: {
    date_from: z.string().describe("Start date (YYYY-MM-DD)."),
    date_to: z.string().describe("End date (YYYY-MM-DD)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ date_from, date_to }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("orders")
      .select("status, total, moderator")
      .gte("created_at", `${date_from}T00:00:00Z`)
      .lte("created_at", `${date_to}T23:59:59Z`)
      .limit(5000);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const rows = data ?? [];
    const valid = rows.filter((r) => r.status !== "cancelled");
    const totalSales = valid.reduce((s, r) => s + num(r.total), 0);
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const byMod = new Map<string, { orders: number; total: number }>();
    for (const r of valid) {
      const key = r.moderator || "غير محدد";
      const cur = byMod.get(key) ?? { orders: 0, total: 0 };
      cur.orders += 1;
      cur.total += num(r.total);
      byMod.set(key, cur);
    }
    const summary = {
      range: { from: date_from, to: date_to },
      orders_count: rows.length,
      valid_orders: valid.length,
      cancelled_orders: rows.length - valid.length,
      total_sales: Number(totalSales.toFixed(2)),
      avg_order_value: valid.length ? Number((totalSales / valid.length).toFixed(2)) : 0,
      by_status: byStatus,
      top_moderators: Array.from(byMod.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 10)
        .map(([moderator, v]) => ({ moderator, orders: v.orders, total: Number(v.total.toFixed(2)) })),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(summary) }],
      structuredContent: summary,
    };
  },
});
