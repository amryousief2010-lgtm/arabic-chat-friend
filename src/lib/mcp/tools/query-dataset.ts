import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { DATASETS } from "../catalog.generated";

const OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is_null", "not_null"] as const;

export default defineTool({
  name: "query_dataset",
  title: "Query dataset",
  description:
    "استعلام عام للقراءة من أي مصدر بيانات في النظام (جدول أو عرض) مع فلاتر وترتيب وترقيم صفحات وعدد إجمالي دقيق. القراءة تتم بصلاحيات المستخدم الموقّع فقط. استخدم list_datasets لمعرفة الأعمدة.",
  inputSchema: {
    dataset: z.string().describe("اسم الجدول أو العرض، مثل orders أو inventory_movements."),
    select: z.string().optional().describe("أعمدة مفصولة بفواصل (افتراضي كل الأعمدة)."),
    filters: z
      .array(
        z.object({
          column: z.string().describe("اسم العمود."),
          op: z.enum(OPS).describe("المُعامل: eq, neq, gt, gte, lt, lte, like, ilike, in, is_null, not_null."),
          value: z.string().optional().describe("القيمة؛ لـ in افصل بفواصل. غير مطلوبة مع is_null/not_null."),
        }),
      )
      .optional()
      .describe("قائمة الفلاتر."),
    search: z.string().optional().describe("بحث نصي (ilike) في العمود المحدد في search_column."),
    search_column: z.string().optional().describe("العمود المستخدم مع search."),
    order_by: z.string().optional().describe("عمود الترتيب (افتراضي created_at إن وُجد)."),
    ascending: z.boolean().optional().describe("ترتيب تصاعدي (افتراضي false)."),
    page: z.number().optional().describe("رقم الصفحة يبدأ من 1."),
    page_size: z.number().optional().describe("حجم الصفحة (افتراضي 50، أقصى 500)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (
    { dataset, select, filters, search, search_column, order_by, ascending, page, page_size },
    ctx,
  ) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const meta = DATASETS.find((d) => d.name === dataset);
    if (!meta)
      return {
        content: [{ type: "text", text: `مصدر البيانات "${dataset}" غير معروف. استخدم list_datasets.` }],
        isError: true,
      };
    const cols = new Set(meta.columns);
    const badCol = (c: string) => !cols.has(c);

    const size = Math.min(Math.max(page_size ?? 50, 1), 500);
    const pg = Math.max(page ?? 1, 1);
    const from = (pg - 1) * size;

    const supabase = supabaseForUser(ctx);
    let q = supabase.from(dataset).select(select?.trim() || "*", { count: "exact" });

    for (const f of filters ?? []) {
      if (badCol(f.column))
        return { content: [{ type: "text", text: `عمود غير موجود: ${f.column}` }], isError: true };
      const v = f.value ?? "";
      switch (f.op) {
        case "eq": q = q.eq(f.column, v); break;
        case "neq": q = q.neq(f.column, v); break;
        case "gt": q = q.gt(f.column, v); break;
        case "gte": q = q.gte(f.column, v); break;
        case "lt": q = q.lt(f.column, v); break;
        case "lte": q = q.lte(f.column, v); break;
        case "like": q = q.like(f.column, `%${v}%`); break;
        case "ilike": q = q.ilike(f.column, `%${v}%`); break;
        case "in": q = q.in(f.column, v.split(",").map((x) => x.trim())); break;
        case "is_null": q = q.is(f.column, null); break;
        case "not_null": q = q.not(f.column, "is", null); break;
      }
    }
    if (search && search_column) {
      if (badCol(search_column))
        return { content: [{ type: "text", text: `عمود غير موجود: ${search_column}` }], isError: true };
      q = q.ilike(search_column, `%${search}%`);
    }

    const orderCol = order_by ?? (cols.has("created_at") ? "created_at" : undefined);
    if (orderCol) {
      if (badCol(orderCol))
        return { content: [{ type: "text", text: `عمود غير موجود: ${orderCol}` }], isError: true };
      q = q.order(orderCol, { ascending: ascending ?? false });
    }

    const { data, error, count } = await q.range(from, from + size - 1);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const total = count ?? 0;
    const payload = {
      dataset,
      total_count: total,
      page: pg,
      page_size: size,
      returned: (data ?? []).length,
      total_pages: Math.ceil(total / size),
      has_more: from + (data ?? []).length < total,
      note: "القراءة بصلاحيات المستخدم (RLS)؛ الصفوف غير المصرح بها لا تظهر ولا تُحتسب. القيم المالية بالجنيه المصري والتواريخ UTC.",
      rows: data ?? [],
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload as any };
  },
});
