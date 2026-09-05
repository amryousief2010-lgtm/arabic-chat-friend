import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "inventory_movements",
  title: "Inventory movements",
  description:
    "حركات الأصناف (استلام، صرف، تحويل بين المخازن، جرد، هالك، تسويات) من نفس الطبقة الآمنة المستخدمة في التطبيق، مع فلاتر بالتاريخ والمخزن والصنف ونوع الحركة.",
  inputSchema: {
    warehouse_ids: z.string().optional().describe("معرفات مخازن مفصولة بفواصل."),
    modules: z.string().optional().describe("موديولات مفصولة بفواصل."),
    movement_types: z.string().optional().describe("أنواع الحركة مفصولة بفواصل، مثل in,out,transfer,adjustment."),
    item_id: z.string().optional().describe("معرّف صنف المخزون."),
    date_from: z.string().optional().describe("من تاريخ YYYY-MM-DD."),
    date_to: z.string().optional().describe("إلى تاريخ YYYY-MM-DD."),
    include_cost: z.boolean().optional().describe("إرجاع التكلفة (للأدوار المالية فقط)."),
    page: z.number().optional().describe("رقم الصفحة يبدأ من 1."),
    page_size: z.number().optional().describe("حجم الصفحة (افتراضي 100، أقصى 500)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (
    { warehouse_ids, modules, movement_types, item_id, date_from, date_to, include_cost, page, page_size },
    ctx,
  ) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const size = Math.min(Math.max(page_size ?? 100, 1), 500);
    const pg = Math.max(page ?? 1, 1);
    const split = (s?: string) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : null);
    const args = {
      p_warehouse_ids: split(warehouse_ids),
      p_modules: split(modules),
      p_movement_types: split(movement_types),
      p_item_id: item_id || null,
      p_date_from: date_from ? `${date_from}T00:00:00Z` : null,
      p_date_to: date_to ? `${date_to}T23:59:59Z` : null,
      p_limit: size,
      p_offset: (pg - 1) * size,
    };

    let costVisible = Boolean(include_cost);
    let { data, error } = await (supabase as any).rpc(
      include_cost ? "inv_get_financial_movements" : "inv_get_operational_movements",
      args,
    );
    if (error && include_cost) {
      costVisible = false;
      const res = await (supabase as any).rpc("inv_get_operational_movements", args);
      data = res.data;
      error = res.error;
    }
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const rows = (data as any[]) ?? [];
    const payload = {
      page: pg,
      page_size: size,
      returned: rows.length,
      has_more: rows.length === size,
      cost_visible: costVisible,
      currency: "EGP",
      period: { from: date_from ?? null, to: date_to ?? null },
      note: "الكميات موجبة للداخل وسالبة للخارج حسب نوع الحركة؛ التواريخ UTC.",
      rows,
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload as any };
  },
});
