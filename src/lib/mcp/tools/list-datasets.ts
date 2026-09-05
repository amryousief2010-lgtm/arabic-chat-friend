import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { DATASETS, SECTION_LABELS, FOREIGN_KEYS } from "../catalog.generated";

export default defineTool({
  name: "list_datasets",
  title: "List datasets",
  description:
    "استعراض مصادر البيانات المتاحة للقراءة (جداول وعروض) مع القسم والأعمدة والعلاقات. استخدمها لمعرفة أسماء الأعمدة قبل استدعاء query_dataset.",
  inputSchema: {
    section: z.string().optional().describe("تصفية بالقسم، مثل inventory أو finance."),
    search: z.string().optional().describe("بحث نصي في اسم المصدر أو أعمدته."),
    include_columns: z.boolean().optional().describe("تضمين أسماء الأعمدة (افتراضي true)."),
    limit: z.number().optional().describe("عدد النتائج (افتراضي 100، أقصى 400)."),
    offset: z.number().optional().describe("بداية الترقيم (افتراضي 0)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ section, search, include_columns, limit, offset }) => {
    const s = (search ?? "").trim().toLowerCase();
    const all = DATASETS.filter(
      (d) =>
        (!section || d.section === section) &&
        (!s || d.name.toLowerCase().includes(s) || d.columns.some((c) => c.toLowerCase().includes(s))),
    );
    const take = Math.min(Math.max(limit ?? 100, 1), 400);
    const skip = Math.max(offset ?? 0, 0);
    const page = all.slice(skip, skip + take).map((d) => ({
      name: d.name,
      section: d.section,
      section_label_ar: SECTION_LABELS[d.section] ?? d.section,
      kind: d.name.startsWith("v_") ? "view" : "table",
      ...(include_columns === false ? {} : { columns: d.columns }),
      references: FOREIGN_KEYS.filter((f) => f.table === d.name).map((f) => `${f.column} -> ${f.references}`),
    }));
    const payload = { total: all.length, returned: page.length, offset: skip, limit: take, datasets: page };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload as any };
  },
});
