import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "delivery_report",
  title: "Delivery & couriers report",
  description:
    "تقرير الشحن والتوصيل: الطلبات حسب شركة الشحن ومنفذ التنفيذ وحالة التسليم والتحصيل، وبوالص الشحن، وتكليفات المناديب، وإغلاقات يوم المندوب (بضاعة خارجة/مرتجعة/نقد محصّل/عجز أو فائض).",
  inputSchema: {
    date_from: z.string().optional().describe("من تاريخ YYYY-MM-DD (على تاريخ إنشاء الطلب)."),
    date_to: z.string().optional().describe("إلى تاريخ YYYY-MM-DD."),
    shipping_company: z.string().optional().describe("تصفية بشركة الشحن."),
    courier_name: z.string().optional().describe("تصفية باسم المندوب في التكليفات والإغلاقات."),
    include_closures: z.boolean().optional().describe("تضمين إغلاقات يوم المندوب (افتراضي true)."),
    limit: z.number().optional().describe("حد الصفوف التفصيلية (افتراضي 500، أقصى 2000)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (
    { date_from, date_to, shipping_company, courier_name, include_closures, limit },
    ctx,
  ) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const cap = Math.min(Math.max(limit ?? 500, 1), 2000);

    let ordersQ = supabase
      .from("orders")
      .select(
        "id,order_number,status,collection_status,shipping_company,fulfillment_type,shipping_bill_no,delivery_fee,total,delivered_at,created_at,courier_cash_due,collection_method",
      )
      .order("created_at", { ascending: false })
      .limit(cap);
    if (date_from) ordersQ = ordersQ.gte("created_at", `${date_from}T00:00:00Z`);
    if (date_to) ordersQ = ordersQ.lte("created_at", `${date_to}T23:59:59Z`);
    if (shipping_company) ordersQ = ordersQ.eq("shipping_company", shipping_company);

    let assignQ = supabase
      .from("courier_order_assignments")
      .select("id,order_id,courier_name,status,assigned_at,delivered_at,collected_at,returned_at")
      .order("assigned_at", { ascending: false })
      .limit(cap);
    if (courier_name) assignQ = assignQ.eq("courier_name", courier_name);
    if (date_from) assignQ = assignQ.gte("assigned_at", `${date_from}T00:00:00Z`);
    if (date_to) assignQ = assignQ.lte("assigned_at", `${date_to}T23:59:59Z`);

    let closuresQ = supabase
      .from("courier_daily_closures")
      .select(
        "id,closure_date,goods_out,goods_returned,sales_value,discounts_value,cash_collected,remaining_goods,remaining_cash,deficit_or_surplus,status",
      )
      .order("closure_date", { ascending: false })
      .limit(cap);
    if (date_from) closuresQ = closuresQ.gte("closure_date", date_from);
    if (date_to) closuresQ = closuresQ.lte("closure_date", date_to);

    const [ord, asg, clo] = await Promise.all([
      ordersQ,
      assignQ,
      include_closures === false ? Promise.resolve({ data: [], error: null } as any) : closuresQ,
    ]);
    const err = ord.error || asg.error || clo.error;
    if (err) return { content: [{ type: "text", text: err.message }], isError: true };

    const orders = (ord.data as any[]) ?? [];
    const num = (v: any) => Number(v ?? 0);
    const group = (k: string) =>
      orders.reduce<Record<string, { orders: number; value: number; delivered: number }>>((acc, o) => {
        const key = String(o[k] ?? "غير محدد");
        acc[key] = acc[key] ?? { orders: 0, value: 0, delivered: 0 };
        acc[key].orders += 1;
        acc[key].value += num(o.total);
        if (o.status === "delivered") acc[key].delivered += 1;
        return acc;
      }, {});

    const closures = (clo.data as any[]) ?? [];
    const payload = {
      period: { from: date_from ?? null, to: date_to ?? null },
      currency: "EGP",
      orders_sampled: orders.length,
      totals: {
        orders_value: orders.reduce((a, o) => a + num(o.total), 0),
        delivered_value: orders.filter((o) => o.status === "delivered").reduce((a, o) => a + num(o.total), 0),
        delivery_fees: orders.reduce((a, o) => a + num(o.delivery_fee), 0),
        without_shipping_bill: orders.filter((o) => !o.shipping_bill_no).length,
      },
      by_shipping_company: group("shipping_company"),
      by_fulfillment_type: group("fulfillment_type"),
      by_status: group("status"),
      by_collection_status: group("collection_status"),
      courier_assignments: asg.data ?? [],
      courier_closures: closures,
      closures_totals: {
        cash_collected: closures.reduce((a, c) => a + num(c.cash_collected), 0),
        deficit_or_surplus: closures.reduce((a, c) => a + num(c.deficit_or_surplus), 0),
      },
      note: "الفترة محسوبة على تاريخ إنشاء الطلب (UTC)؛ التسليم يُقاس بحالة delivered. الأرقام محدودة بعدد الصفوف المسحوبة (limit).",
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload as any };
  },
});
