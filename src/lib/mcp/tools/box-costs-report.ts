import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

const num = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export default defineTool({
  name: "box_costs_report",
  title: "Box costs & manufacturing cost variance",
  description:
    "تقرير تكلفة كل بوكس/عرض (خامات + توابل + تغليف + مصاريف) والربح مقابل سعر العرض، بالإضافة إلى فروقات تكلفة الصنف التام بين المتوسط المسجّل والتكلفة الفعلية المحسوبة من فواتير التصنيع المعتمدة أو المحوّلة. العملة الجنيه المصري والأوزان بالكيلو. القراءة فقط وبصلاحيات المستخدم (RLS).",
  inputSchema: {
    section: z
      .enum(["boxes", "variance", "both"])
      .optional()
      .describe("boxes = تكلفة وربح البوكسات، variance = فروقات تكلفة الأصناف التامة، both = الاثنان (افتراضي)."),
    search: z.string().optional().describe("بحث باسم البوكس أو اسم الصنف التام."),
    active_only: z.boolean().optional().describe("البوكسات النشطة فقط (افتراضي true)."),
    below_min_profit_only: z.boolean().optional().describe("البوكسات التي ربحها أقل من الحد الأدنى 100 جنيه فقط."),
    variance_only: z.boolean().optional().describe("الأصناف التي بها فرق تكلفة فعلي فقط."),
    include_box_lines: z.boolean().optional().describe("إرجاع تفاصيل أصناف كل بوكس وتكلفتها."),
    page: z.number().optional().describe("رقم الصفحة يبدأ من 1."),
    page_size: z.number().optional().describe("حجم الصفحة (افتراضي 100، أقصى 500)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (
    { section, search, active_only, below_min_profit_only, variance_only, include_box_lines, page, page_size },
    ctx,
  ) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };

    const supabase = supabaseForUser(ctx);
    const sec = section ?? "both";
    const size = Math.min(Math.max(page_size ?? 100, 1), 500);
    const pg = Math.max(page ?? 1, 1);
    const from = (pg - 1) * size;
    const to = from + size - 1;
    const term = search?.trim();

    const result: Record<string, unknown> = {
      meta: {
        currency: "EGP",
        min_profit_threshold: 100,
        cost_source: "فواتير تصنيع مصنع اللحوم بحالة approved أو transferred",
        generated_at: new Date().toISOString(),
        page: pg,
        page_size: size,
      },
    };

    if (sec === "boxes" || sec === "both") {
      let q = (supabase as any)
        .from("v_offer_box_costs")
        .select("*", { count: "exact" })
        .order("box_name")
        .range(from, to);
      if (active_only ?? true) q = q.eq("is_active", true);
      if (below_min_profit_only) q = q.eq("below_min_profit", true);
      if (term) q = q.ilike("box_name", `%${term}%`);
      const { data, error, count } = await q;
      if (error) return { content: [{ type: "text", text: `boxes error: ${error.message}` }], isError: true };

      const boxes = (data ?? []) as any[];
      result.boxes = {
        total_count: count ?? boxes.length,
        rows: boxes.map((b) => ({
          box_id: b.box_id,
          box_name: b.box_name,
          is_active: b.is_active,
          offer_price: num(b.offer_price),
          shipping_cost: num(b.shipping_cost),
          items_count: num(b.items_count),
          total_qty: num(b.total_qty),
          cost_breakdown: {
            raw: num(b.raw_cost),
            spice: num(b.spice_cost),
            packaging: num(b.packaging_cost),
            extra: num(b.extra_cost),
            legacy_fallback: num(b.legacy_cost),
            total: num(b.total_cost),
          },
          items_value: num(b.items_value),
          profit: num(b.profit),
          profit_pct: num(b.profit_pct),
          below_min_profit: Boolean(b.below_min_profit),
          items_without_cost: num(b.items_without_cost),
        })),
        summary: {
          boxes: boxes.length,
          below_min_profit: boxes.filter((b) => b.below_min_profit).length,
          avg_profit: boxes.length ? boxes.reduce((s, b) => s + num(b.profit), 0) / boxes.length : 0,
        },
      };

      if (include_box_lines && boxes.length) {
        const ids = boxes.map((b) => b.box_id);
        const { data: lines } = await (supabase as any)
          .from("v_offer_box_cost_lines")
          .select("*")
          .in("box_id", ids);
        result.box_lines = (lines ?? []).map((l: any) => ({
          box_id: l.box_id,
          box_name: l.box_name,
          product_name: l.product_name,
          quantity: num(l.quantity),
          is_gift: Boolean(l.is_gift),
          line_price: num(l.line_price),
          actual_unit_cost: l.actual_unit_cost == null ? null : num(l.actual_unit_cost),
          product_cost_price: l.product_cost_price == null ? null : num(l.product_cost_price),
          per_unit: {
            raw: num(l.raw_per_unit),
            spice: num(l.spice_per_unit),
            packaging: num(l.packaging_per_unit),
            extra: num(l.extra_per_unit),
          },
          line_cost: num(l.line_cost),
        }));
      }
    }

    if (sec === "variance" || sec === "both") {
      let q = (supabase as any)
        .from("v_meat_cost_variance")
        .select("*", { count: "exact" })
        .order("product_name")
        .range(from, to);
      if (term) q = q.ilike("product_name", `%${term}%`);
      const { data, error, count } = await q;
      if (error) return { content: [{ type: "text", text: `variance error: ${error.message}` }], isError: true };

      let rows = (data ?? []) as any[];
      if (variance_only) rows = rows.filter((r) => Math.abs(num(r.variance)) > 0.01);

      result.cost_variance = {
        total_count: count ?? rows.length,
        rows: rows.map((r) => ({
          product_name: r.product_name,
          invoices_count: num(r.invoices_count),
          total_qty: num(r.total_qty),
          cost_breakdown: {
            raw: num(r.raw_cost),
            spice: num(r.spice_cost),
            packaging: num(r.packaging_cost),
            extra: num(r.extra_cost),
            total: num(r.total_cost),
          },
          per_unit: {
            raw: num(r.raw_per_unit),
            spice: num(r.spice_per_unit),
            packaging: num(r.packaging_per_unit),
            extra: num(r.extra_per_unit),
          },
          actual_unit_cost: num(r.actual_unit_cost),
          recorded_avg_cost: r.finished_avg_cost == null ? null : num(r.finished_avg_cost),
          product_cost_price: r.product_cost_price == null ? null : num(r.product_cost_price),
          product_sale_price: r.product_sale_price == null ? null : num(r.product_sale_price),
          variance: num(r.variance),
          variance_pct: num(r.variance_pct),
          last_approved_at: r.last_approved_at,
        })),
        summary: {
          items: rows.length,
          mismatched: rows.filter((r) => Math.abs(num(r.variance)) > 0.01).length,
        },
      };
    }

    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
});
