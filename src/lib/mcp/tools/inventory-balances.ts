import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

const num = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export default defineTool({
  name: "inventory_balances",
  title: "Inventory balances",
  description:
    "أرصدة المخزون لكل صنف داخل كل مخزن من نفس الطبقة الآمنة التي تستخدمها شاشات التطبيق: الرصيد الفعلي والمحجوز والمحظور والمتاح ووحدة القياس. أعمدة التكلفة والقيمة تظهر فقط للأدوار المالية المصرح لها.",
  inputSchema: {
    search: z.string().optional().describe("بحث في اسم الصنف أو كوده."),
    warehouse_ids: z.string().optional().describe("معرفات مخازن مفصولة بفواصل."),
    modules: z.string().optional().describe("وحدات/موديولات مفصولة بفواصل، مثل main,agouza,meat."),
    active_only: z.boolean().optional().describe("الأصناف النشطة فقط (افتراضي true)."),
    include_cost: z.boolean().optional().describe("محاولة إرجاع التكلفة والقيمة (للأدوار المالية فقط)."),
    low_stock_only: z.boolean().optional().describe("الأصناف تحت حد إعادة الطلب فقط."),
    page: z.number().optional().describe("رقم الصفحة يبدأ من 1."),
    page_size: z.number().optional().describe("حجم الصفحة (افتراضي 100، أقصى 500)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (
    { search, warehouse_ids, modules, active_only, include_cost, low_stock_only, page, page_size },
    ctx,
  ) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const size = Math.min(Math.max(page_size ?? 100, 1), 500);
    const pg = Math.max(page ?? 1, 1);
    const split = (s?: string) =>
      s ? s.split(",").map((x) => x.trim()).filter(Boolean) : null;

    const fn = include_cost ? "inv_get_financial_balances" : "inv_get_operational_balances";
    const args: Record<string, unknown> = {
      p_warehouse_ids: split(warehouse_ids),
      p_modules: split(modules),
      p_active_only: active_only ?? true,
      p_limit: size,
      p_offset: (pg - 1) * size,
    };
    if (!include_cost) args.p_search = search?.trim() || null;

    let { data, error } = await (supabase as any).rpc(fn, args);
    let costVisible = Boolean(include_cost);
    if (error && include_cost) {
      // Fall back to the operational (cost-free) layer when the role lacks cost visibility.
      costVisible = false;
      const res = await (supabase as any).rpc("inv_get_operational_balances", {
        p_warehouse_ids: split(warehouse_ids),
        p_modules: split(modules),
        p_active_only: active_only ?? true,
        p_search: search?.trim() || null,
        p_limit: size,
        p_offset: (pg - 1) * size,
      });
      data = res.data;
      error = res.error;
    }
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    let rows = ((data as any[]) ?? []).map((r) => ({
      inventory_item_id: r.id ?? r.inventory_item_id,
      item_code: r.item_code ?? null,
      item_name: r.name ?? r.item_name ?? null,
      category: r.category ?? null,
      module: r.module ?? null,
      unit: r.unit ?? null,
      warehouse_id: r.warehouse_id ?? null,
      warehouse_name: r.warehouse_name ?? null,
      current_stock: num(r.current_stock),
      reserved_stock: num(r.reserved_stock),
      blocked_stock: num(r.blocked_stock),
      available_stock: num(r.available_stock),
      is_low_stock: Boolean(r.is_low_stock),
      last_movement_date: r.last_movement_date ?? null,
      ...(costVisible ? { unit_cost: num(r.unit_cost), total_value: num(r.total_value) } : {}),
    }));
    if (low_stock_only) rows = rows.filter((r) => r.is_low_stock);
    if (include_cost && search) {
      const s = search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.item_name ?? "").toLowerCase().includes(s) || (r.item_code ?? "").toLowerCase().includes(s),
      );
    }

    const payload = {
      as_of: new Date().toISOString(),
      source: fn,
      cost_visible: costVisible,
      page: pg,
      page_size: size,
      returned: rows.length,
      has_more: rows.length === size,
      definitions: {
        current_stock: "الرصيد الفعلي المسجل للصنف داخل هذا المخزن بوحدة القياس المذكورة.",
        reserved_stock: "الكمية المحجوزة لطلبات/عمليات قائمة ولم تخرج بعد.",
        blocked_stock: "كمية محظورة (جرد/مشكلة جودة) غير قابلة للصرف.",
        available_stock: "المتاح للصرف = الفعلي - المحجوز - المحظور.",
        unit: "وحدة القياس (كجم/عدد/عبوة) حسب تعريف الصنف.",
        unit_cost: "متوسط تكلفة الوحدة بالجنيه المصري (يظهر للأدوار المالية فقط).",
      },
      note:
        "هذه هي نفس أرصدة شاشة محرك المخزون. حقل products.stock القديم لا يُستخدم هنا ولا يمثل رصيد مخزن محدد.",
      rows,
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload as any };
  },
});
