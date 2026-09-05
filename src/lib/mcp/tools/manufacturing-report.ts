import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

const num = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export default defineTool({
  name: "manufacturing_report",
  title: "Manufacturing report",
  description:
    "تقرير التصنيع لفترة: مصنع اللحوم (فواتير التصنيع والكميات المنتجة والملغاة)، مصنع الأعلاف (دفعات الإنتاج وتكلفتها)، والمجزر (دفعات الذبح ومخرجاتها). يوضح الكميات بالكيلو والتكاليف بالجنيه.",
  inputSchema: {
    date_from: z.string().describe("من تاريخ YYYY-MM-DD."),
    date_to: z.string().describe("إلى تاريخ YYYY-MM-DD."),
    unit: z
      .enum(["meat", "feed", "slaughter", "all"])
      .optional()
      .describe("الوحدة الإنتاجية المطلوبة (افتراضي all)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ date_from, date_to, unit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const u = unit ?? "all";
    const from = `${date_from}T00:00:00Z`;
    const to = `${date_to}T23:59:59Z`;
    const out: Record<string, unknown> = {};
    const notes: string[] = [];

    if (u === "meat" || u === "all") {
      const { data, error } = await supabase
        .from("meat_manufacturing_invoices")
        .select("*")
        .gte("created_at", from)
        .lte("created_at", to)
        .limit(2000);
      if (error) notes.push(`meat: ${error.message}`);
      const rows = (data as any[]) ?? [];
      const active = rows.filter((r) => String(r.status ?? "").toLowerCase() !== "cancelled");
      out.meat_factory = {
        invoices_total: rows.length,
        invoices_active: active.length,
        invoices_cancelled: rows.length - active.length,
        produced_kg: Number(
          active.reduce((s, r) => s + num(r.total_output_kg ?? r.output_kg ?? r.total_kg), 0).toFixed(2),
        ),
        total_cost: Number(
          active.reduce((s, r) => s + num(r.total_cost ?? r.cost_total), 0).toFixed(2),
        ),
        rows: active.slice(0, 100),
      };
    }

    if (u === "feed" || u === "all") {
      const { data, error } = await supabase
        .from("feed_production_batches")
        .select("*")
        .gte("created_at", from)
        .lte("created_at", to)
        .limit(2000);
      if (error) notes.push(`feed: ${error.message}`);
      const rows = (data as any[]) ?? [];
      out.feed_factory = {
        batches: rows.length,
        produced_kg: Number(
          rows.reduce((s, r) => s + num(r.produced_qty ?? r.output_kg ?? r.total_kg), 0).toFixed(2),
        ),
        total_cost: Number(rows.reduce((s, r) => s + num(r.total_cost), 0).toFixed(2)),
        rows: rows.slice(0, 100),
      };
    }

    if (u === "slaughter" || u === "all") {
      const { data, error } = await supabase
        .from("slaughter_batches")
        .select("*")
        .gte("created_at", from)
        .lte("created_at", to)
        .limit(2000);
      if (error) notes.push(`slaughter: ${error.message}`);
      const rows = ((data as any[]) ?? []).filter(
        (r) => String(r.status ?? "").toLowerCase() !== "cancelled",
      );
      out.slaughterhouse = {
        batches: rows.length,
        birds: rows.reduce((s, r) => s + num(r.birds_count ?? r.bird_count), 0),
        output_kg: Number(
          rows.reduce((s, r) => s + num(r.total_output_kg ?? r.net_weight ?? r.total_kg), 0).toFixed(2),
        ),
        total_cost: Number(rows.reduce((s, r) => s + num(r.total_cost), 0).toFixed(2)),
        rows: rows.slice(0, 100),
      };
    }

    const payload = {
      period: { from: date_from, to: date_to },
      currency: "EGP",
      weight_unit: "kg",
      generated_at: new Date().toISOString(),
      note:
        "الفواتير الملغاة مستبعدة من الكميات والتكاليف (وكمياتها ترتد للمخزون). التكاليف تظهر فقط للأدوار المصرح لها.",
      access_notes: notes,
      ...out,
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload as any };
  },
});
