import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { DATASETS, FOREIGN_KEYS } from "../catalog.generated";

export default defineTool({
  name: "get_record",
  title: "Get record details",
  description:
    "قراءة سجل واحد من أي مصدر بيانات بالمعرّف (أو بعمود آخر)، مع تحميل السجلات المرتبطة به من الجداول الأبناء (البنود، الحركات، المرفقات، سجل التعديلات).",
  inputSchema: {
    dataset: z.string().describe("اسم الجدول، مثل orders أو meat_factory_batches."),
    id: z.string().describe("قيمة المعرّف."),
    id_column: z.string().optional().describe("عمود المعرّف (افتراضي id)."),
    include_related: z.boolean().optional().describe("تحميل السجلات المرتبطة (افتراضي true)."),
    related_limit: z.number().optional().describe("عدد السجلات المرتبطة لكل جدول (افتراضي 50، أقصى 200)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ dataset, id, id_column, include_related, related_limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const meta = DATASETS.find((d) => d.name === dataset);
    if (!meta)
      return { content: [{ type: "text", text: `مصدر بيانات غير معروف: ${dataset}` }], isError: true };
    const key = id_column ?? "id";
    if (!meta.columns.includes(key))
      return { content: [{ type: "text", text: `عمود غير موجود: ${key}` }], isError: true };

    const supabase = supabaseForUser(ctx);
    const { data: record, error } = await supabase.from(dataset).select("*").eq(key, id).maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!record)
      return { content: [{ type: "text", text: `لا يوجد سجل بالقيمة ${id} في ${dataset}` }], isError: true };

    const related: Record<string, unknown> = {};
    if (include_related !== false && key === "id") {
      const cap = Math.min(Math.max(related_limit ?? 50, 1), 200);
      const children = FOREIGN_KEYS.filter((f) => f.references === dataset).slice(0, 12);
      for (const c of children) {
        const { data } = await supabase.from(c.table).select("*").eq(c.column, id).limit(cap);
        if (data && data.length) related[`${c.table}.${c.column}`] = data;
      }
    }

    const payload = { dataset, id, record, related, currency: "EGP", timestamps: "UTC" };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload as any };
  },
});
