import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

const num = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export default defineTool({
  name: "sales_report",
  title: "Sales report (orders vs delivered vs collected)",
  description:
    "تقرير مبيعات تفصيلي لفترة: يفصل قيمة الطلبات المسجّلة عن المبيعات المسلّمة فعليًا عن التحصيل النقدي، مع الإلغاءات والمرتجعات والخصومات والشحن، وتوزيع حسب الحالة والمنفذ والمصدر والمودريتور.",
  inputSchema: {
    date_from: z.string().describe("من تاريخ YYYY-MM-DD (على created_at)."),
    date_to: z.string().describe("إلى تاريخ YYYY-MM-DD."),
    moderator: z.string().optional().describe("تصفية بموظفة المبيعات."),
    fulfillment_type: z.string().optional().describe("منفذ التنفيذ، مثل main_warehouse أو agouza أو delivery."),
    include_collections: z.boolean().optional().describe("تضمين التحصيل من إيداعات المناديب (افتراضي true)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ date_from, date_to, moderator, fulfillment_type, include_collections }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const from = `${date_from}T00:00:00Z`;
    const to = `${date_to}T23:59:59Z`;

    let q = supabase
      .from("orders")
      .select(
        "status, payment_status, payment_method, total, subtotal, discount, delivery_fee, moderator, fulfillment_type, source, shipping_company, created_at, delivered_at",
        { count: "exact" },
      )
      .gte("created_at", from)
      .lte("created_at", to)
      .limit(20000);
    if (moderator) q = q.eq("moderator", moderator);
    if (fulfillment_type) q = q.eq("fulfillment_type", fulfillment_type);
    const { data, error, count } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rows = (data as any[]) ?? [];

    const sum = (list: any[], f: (r: any) => number) => Number(list.reduce((s, r) => s + f(r), 0).toFixed(2));
    const delivered = rows.filter((r) => r.status === "delivered");
    const cancelled = rows.filter((r) => r.status === "cancelled");
    const returned = rows.filter((r) => r.status === "returned");
    const open = rows.filter(
      (r) => !["delivered", "cancelled", "returned"].includes(String(r.status)),
    );

    const group = (list: any[], key: string) => {
      const m = new Map<string, { orders: number; total: number }>();
      for (const r of list) {
        const k = r[key] || "غير محدد";
        const cur = m.get(k) ?? { orders: 0, total: 0 };
        cur.orders += 1;
        cur.total += num(r.total);
        m.set(k, cur);
      }
      return Array.from(m.entries())
        .map(([k, v]) => ({ key: k, orders: v.orders, total: Number(v.total.toFixed(2)) }))
        .sort((a, b) => b.total - a.total);
    };

    let collections: any = null;
    if (include_collections !== false) {
      const { data: dep } = await supabase
        .from("courier_daily_cash_deposits")
        .select("deposit_date, amount, orders_count, courier_name")
        .gte("deposit_date", date_from)
        .lte("deposit_date", date_to);
      if (dep)
        collections = {
          source: "courier_daily_cash_deposits",
          deposits_count: dep.length,
          total_deposited: sum(dep as any[], (r) => num(r.amount)),
        };
    }

    const payload = {
      period: { from: date_from, to: date_to, basis: "created_at (UTC)" },
      currency: "EGP",
      generated_at: new Date().toISOString(),
      orders_registered: { count: count ?? rows.length, value: sum(rows, (r) => num(r.total)) },
      delivered_sales: {
        count: delivered.length,
        value: sum(delivered, (r) => num(r.total)),
        subtotal: sum(delivered, (r) => num(r.subtotal)),
        discounts: sum(delivered, (r) => num(r.discount)),
        delivery_fees: sum(delivered, (r) => num(r.delivery_fee)),
        avg_order_value: delivered.length
          ? Number((sum(delivered, (r) => num(r.total)) / delivered.length).toFixed(2))
          : 0,
      },
      cancelled: { count: cancelled.length, value: sum(cancelled, (r) => num(r.total)) },
      returned: { count: returned.length, value: sum(returned, (r) => num(r.total)) },
      open_orders: { count: open.length, value: sum(open, (r) => num(r.total)) },
      collections,
      by_status: group(rows, "status"),
      by_fulfillment: group(rows, "fulfillment_type"),
      by_source: group(rows, "source"),
      by_moderator: group(rows.filter((r) => r.status !== "cancelled"), "moderator").slice(0, 25),
      by_payment_method: group(delivered, "payment_method"),
      definitions: {
        orders_registered: "قيمة كل الطلبات المسجّلة في الفترة بغض النظر عن الحالة.",
        delivered_sales: "المبيعات المعتمدة = الطلبات بحالة delivered فقط.",
        collections: "المبالغ المودعة فعليًا من المناديب في الفترة، وقد تخص طلبات من فترات سابقة.",
        formula: "total = subtotal - discount + delivery_fee. الهدايا بسعر صفر ولا تدخل الإجماليات.",
      },
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload as any };
  },
});
