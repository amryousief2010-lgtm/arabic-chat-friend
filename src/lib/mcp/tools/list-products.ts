import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_products",
  title: "List products",
  description:
    "قائمة المنتجات بأسمائها وفئاتها وسعر البيع ووحدة القياس. تحذير: حقل stock هنا حقل تجميعي قديم على مستوى المنتج ولا يمثل رصيد مخزن محدد — لأرصدة المخازن (فعلي/محجوز/متاح) استخدم أداة inventory_balances.",
  inputSchema: {
    search: z.string().optional().describe("بحث جزئي في اسم المنتج."),
    category: z.string().optional().describe("تصفية بالفئة."),
    active_only: z.boolean().optional().describe("المنتجات النشطة فقط."),
    page: z.number().optional().describe("رقم الصفحة يبدأ من 1."),
    page_size: z.number().optional().describe("حجم الصفحة (افتراضي 50، أقصى 200)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, category, active_only, page, page_size }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const size = Math.min(Math.max(page_size ?? 50, 1), 200);
    const pg = Math.max(page ?? 1, 1);
    const from = (pg - 1) * size;
    let q = supabase
      .from("products")
      .select("id, name, category, price, unit, stock, is_active", { count: "exact" })
      .order("name", { ascending: true });
    if (search) q = q.ilike("name", `%${search}%`);
    if (category) q = q.eq("category", category);
    if (active_only) q = q.eq("is_active", true);
    const { data, error, count } = await q.range(from, from + size - 1);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const payload = {
      total_count: count ?? 0,
      page: pg,
      page_size: size,
      returned: (data ?? []).length,
      has_more: from + (data ?? []).length < (count ?? 0),
      currency: "EGP",
      stock_field_note:
        "products.stock حقل قديم على مستوى المنتج (ليس رصيد مخزن). استخدم inventory_balances للرصيد الفعلي والمحجوز والمتاح لكل مخزن ووحدة.",
      products: data ?? [],
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload as any };
  },
});
