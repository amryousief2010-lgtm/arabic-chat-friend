import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

const num = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const r2 = (n: number) => Number(n.toFixed(2));
const notCancelled = (r: any) => String(r.status ?? "").toLowerCase() !== "cancelled";

const SECTIONS = [
  "manufacturing",
  "batches",
  "inventory",
  "purchases",
  "sales",
  "returns",
  "transfers",
  "carryover_dough",
  "stocktaking",
  "treasury",
  "recipes",
  "products",
] as const;

export default defineTool({
  name: "meat_factory_report",
  title: "Meat factory full report",
  description:
    "تقرير شامل لمصنع اللحوم بكل فروعه الداخلية: فواتير التصنيع وبنودها، دفعات الإنتاج والاستهلاك والتعبئة، مخزون الخامات والتوابل والتغليف والمنتج التام، المشتريات والموردين، المبيعات والمرتجعات، التحويلات للمخزن الرئيسي، العجينة المرحّلة (carryover)، الجرد والفروقات، خزينة المصنع، والوصفات (BOM) وإصداراتها، بالإضافة إلى المنتجات وتكاليفها. الكميات بالكيلو/الوحدة والقيم بالجنيه المصري. قراءة فقط وحسب صلاحيات المستخدم (RLS).",
  inputSchema: {
    date_from: z.string().optional().describe("من تاريخ YYYY-MM-DD (افتراضي أول الشهر الحالي)."),
    date_to: z.string().optional().describe("إلى تاريخ YYYY-MM-DD (افتراضي اليوم)."),
    sections: z
      .array(z.enum(SECTIONS))
      .optional()
      .describe("الأقسام المطلوبة؛ الافتراضي كل الأقسام."),
    include_lines: z
      .boolean()
      .optional()
      .describe("تضمين بنود الفواتير والدفعات التفصيلية (افتراضي false للاختصار)."),
    limit: z.number().int().min(1).max(500).optional().describe("أقصى عدد سجلات لكل قسم (افتراضي 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ date_from, date_to, sections, include_lines, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);

    const today = new Date().toISOString().slice(0, 10);
    const dFrom = date_from ?? `${today.slice(0, 7)}-01`;
    const dTo = date_to ?? today;
    const tsFrom = `${dFrom}T00:00:00Z`;
    const tsTo = `${dTo}T23:59:59Z`;
    const cap = limit ?? 100;
    const want = (s: (typeof SECTIONS)[number]) => !sections || sections.length === 0 || sections.includes(s);

    const notes: string[] = [];
    const out: Record<string, unknown> = {};
    const grab = async (label: string, q: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
      const { data, error } = await q;
      if (error) {
        notes.push(`${label}: ${error.message}`);
        return [] as any[];
      }
      return ((data as any[]) ?? []) as any[];
    };

    if (want("manufacturing")) {
      const rows = await grab(
        "meat_manufacturing_invoices",
        supabase
          .from("meat_manufacturing_invoices")
          .select("*")
          .gte("created_at", tsFrom)
          .lte("created_at", tsTo)
          .order("created_at", { ascending: false })
          .limit(2000),
      );
      const active = rows.filter(notCancelled);
      let lines: any[] = [];
      if (include_lines && active.length) {
        lines = await grab(
          "meat_manufacturing_invoice_lines",
          supabase
            .from("meat_manufacturing_invoice_lines")
            .select("*")
            .in("invoice_id", active.slice(0, cap).map((r) => r.id))
            .limit(5000),
        );
      }
      const byStatus = new Map<string, number>();
      rows.forEach((r) => byStatus.set(String(r.status ?? "-"), (byStatus.get(String(r.status ?? "-")) ?? 0) + 1));
      out.manufacturing = {
        invoices_total: rows.length,
        invoices_active: active.length,
        invoices_cancelled: rows.length - active.length,
        by_status: Object.fromEntries(byStatus),
        produced_qty: r2(active.reduce((s, r) => s + num(r.finished_qty), 0)),
        cost_breakdown: {
          raw: r2(active.reduce((s, r) => s + num(r.raw_cost), 0)),
          spices: r2(active.reduce((s, r) => s + num(r.spice_cost), 0)),
          packaging: r2(active.reduce((s, r) => s + num(r.packaging_cost), 0)),
          extra: r2(active.reduce((s, r) => s + num(r.extra_cost), 0)),
          total: r2(
            active.reduce((s, r) => s + num(r.total_manufacturing_cost ?? r.materials_total_cost), 0),
          ),
        },
        rows: active.slice(0, cap),
        lines: include_lines ? lines : undefined,
      };
    }

    if (want("batches")) {
      const rows = await grab(
        "meat_factory_batches",
        supabase
          .from("meat_factory_batches")
          .select("*")
          .gte("created_at", tsFrom)
          .lte("created_at", tsTo)
          .order("created_at", { ascending: false })
          .limit(2000),
      );
      const active = rows.filter(notCancelled);
      let consumption: any[] = [];
      let packaging: any[] = [];
      if (include_lines && active.length) {
        const ids = active.slice(0, cap).map((r) => r.id);
        consumption = await grab(
          "meat_factory_batch_consumption",
          supabase.from("meat_factory_batch_consumption").select("*").in("batch_id", ids).limit(5000),
        );
        packaging = await grab(
          "meat_factory_batch_packaging",
          supabase.from("meat_factory_batch_packaging").select("*").in("batch_id", ids).limit(5000),
        );
      }
      out.batches = {
        total: rows.length,
        active: active.length,
        cancelled: rows.length - active.length,
        planned_qty: r2(active.reduce((s, r) => s + num(r.planned_qty), 0)),
        actual_qty: r2(active.reduce((s, r) => s + num(r.actual_qty), 0)),
        waste_qty: r2(active.reduce((s, r) => s + num(r.waste_qty), 0)),
        total_cost: r2(active.reduce((s, r) => s + num(r.total_cost), 0)),
        posted_to_inventory: active.filter((r) => r.posted_to_inventory).length,
        rows: active.slice(0, cap),
        consumption_lines: include_lines ? consumption : undefined,
        packaging_lines: include_lines ? packaging : undefined,
      };
    }

    if (want("inventory")) {
      const [raw, spice, pack, finished, moves] = await Promise.all([
        grab("meat_raw_inventory", supabase.from("meat_raw_inventory").select("*").limit(1000)),
        grab("meat_factory_raw_items", supabase.from("meat_factory_raw_items").select("*").limit(1000)),
        grab("meat_packaging_inventory", supabase.from("meat_packaging_inventory").select("*").limit(1000)),
        grab("meat_finished_inventory", supabase.from("meat_finished_inventory").select("*").limit(1000)),
        grab(
          "meat_factory_inventory_moves",
          supabase
            .from("meat_factory_inventory_moves")
            .select("*")
            .gte("created_at", tsFrom)
            .lte("created_at", tsTo)
            .order("created_at", { ascending: false })
            .limit(cap),
        ),
      ]);
      const value = (rows: any[], costKey: string) =>
        r2(rows.reduce((s, r) => s + num(r.stock ?? r.current_stock) * num(r[costKey]), 0));
      out.inventory = {
        raw_materials: {
          items: raw.length,
          stock_value: value(raw, "avg_cost"),
          low_stock: raw.filter((r) => num(r.stock) <= num(r.reorder_level)).length,
          rows: raw.slice(0, cap),
        },
        raw_and_spice_items: {
          items: spice.length,
          stock_value: value(spice, "avg_cost"),
          rows: spice.slice(0, cap),
        },
        packaging: {
          items: pack.length,
          stock_value: value(pack, "avg_cost"),
          rows: pack.slice(0, cap),
        },
        finished_goods: {
          items: finished.length,
          stock_value: value(finished, "avg_prod_cost"),
          rows: finished.slice(0, cap),
        },
        recent_moves: moves,
      };
    }

    if (want("purchases")) {
      const rows = await grab(
        "meat_factory_purchases",
        supabase
          .from("meat_factory_purchases")
          .select("*")
          .gte("purchase_date", dFrom)
          .lte("purchase_date", dTo)
          .order("purchase_date", { ascending: false })
          .limit(2000),
      );
      const active = rows.filter(notCancelled);
      let lines: any[] = [];
      if (include_lines && active.length) {
        lines = await grab(
          "meat_factory_purchase_lines",
          supabase
            .from("meat_factory_purchase_lines")
            .select("*")
            .in("purchase_id", active.slice(0, cap).map((r) => r.id))
            .limit(5000),
        );
      }
      const bySupplier = new Map<string, number>();
      active.forEach((r) =>
        bySupplier.set(String(r.supplier ?? "-"), r2((bySupplier.get(String(r.supplier ?? "-")) ?? 0) + num(r.total_amount))),
      );
      out.purchases = {
        count: active.length,
        total_amount: r2(active.reduce((s, r) => s + num(r.total_amount), 0)),
        by_supplier: Object.fromEntries(bySupplier),
        rows: active.slice(0, cap),
        lines: include_lines ? lines : undefined,
      };
    }

    if (want("sales")) {
      const rows = await grab(
        "meat_factory_sales",
        supabase
          .from("meat_factory_sales")
          .select("*")
          .gte("sale_date", dFrom)
          .lte("sale_date", dTo)
          .order("sale_date", { ascending: false })
          .limit(2000),
      );
      const active = rows.filter(notCancelled);
      let lines: any[] = [];
      if (active.length) {
        lines = await grab(
          "meat_factory_sales_lines",
          supabase
            .from("meat_factory_sales_lines")
            .select("*")
            .in("sale_id", active.map((r) => r.id).slice(0, 500))
            .limit(5000),
        );
      }
      out.sales = {
        invoices: active.length,
        total_amount: r2(active.reduce((s, r) => s + num(r.total_amount), 0)),
        qty_sold: r2(lines.reduce((s, r) => s + num(r.quantity), 0)),
        cost_of_sales: r2(lines.reduce((s, r) => s + num(r.quantity) * num(r.unit_cost_snapshot), 0)),
        rows: active.slice(0, cap),
        lines: include_lines ? lines : undefined,
      };
    }

    if (want("returns")) {
      const rows = await grab(
        "meat_factory_sales_returns",
        supabase
          .from("meat_factory_sales_returns")
          .select("*")
          .gte("return_date", dFrom)
          .lte("return_date", dTo)
          .order("return_date", { ascending: false })
          .limit(1000),
      );
      const active = rows.filter(notCancelled);
      out.returns = {
        count: active.length,
        total_amount: r2(active.reduce((s, r) => s + num(r.total_amount), 0)),
        rows: active.slice(0, cap),
      };
    }

    if (want("transfers")) {
      const rows = await grab(
        "meat_production_transfers",
        supabase
          .from("meat_production_transfers")
          .select("*")
          .gte("created_at", tsFrom)
          .lte("created_at", tsTo)
          .order("created_at", { ascending: false })
          .limit(2000),
      );
      const byStatus = new Map<string, number>();
      rows.forEach((r) => byStatus.set(String(r.status ?? "-"), (byStatus.get(String(r.status ?? "-")) ?? 0) + 1));
      out.transfers = {
        count: rows.length,
        by_status: Object.fromEntries(byStatus),
        qty: r2(rows.reduce((s, r) => s + num(r.quantity), 0)),
        total_cost: r2(rows.reduce((s, r) => s + num(r.total_cost), 0)),
        pending_receipt: rows.filter((r) => String(r.status ?? "").toLowerCase() === "pending").length,
        rows: rows.slice(0, cap),
      };
    }

    if (want("carryover_dough")) {
      const [rows, usage] = await Promise.all([
        grab("meat_factory_carryover_dough", supabase.from("meat_factory_carryover_dough").select("*").limit(1000)),
        grab(
          "meat_factory_carryover_dough_usage",
          supabase
            .from("meat_factory_carryover_dough_usage")
            .select("*")
            .gte("created_at", tsFrom)
            .lte("created_at", tsTo)
            .limit(1000),
        ),
      ]);
      out.carryover_dough = {
        records: rows.length,
        remaining_kg: r2(rows.reduce((s, r) => s + num(r.remaining_qty_kg), 0)),
        remaining_value: r2(rows.reduce((s, r) => s + num(r.remaining_qty_kg) * num(r.unit_cost), 0)),
        used_in_period_kg: r2(usage.reduce((s, r) => s + num(r.used_qty_kg), 0)),
        rows: rows.slice(0, cap),
        usage: usage.slice(0, cap),
      };
    }

    if (want("stocktaking")) {
      const rows = await grab(
        "meat_factory_stocktaking",
        supabase
          .from("meat_factory_stocktaking")
          .select("*")
          .gte("taken_date", dFrom)
          .lte("taken_date", dTo)
          .order("taken_date", { ascending: false })
          .limit(500),
      );
      let lines: any[] = [];
      if (rows.length) {
        lines = await grab(
          "meat_factory_stocktaking_lines",
          supabase
            .from("meat_factory_stocktaking_lines")
            .select("*")
            .in("stocktake_id", rows.map((r) => r.id).slice(0, 200))
            .limit(5000),
        );
      }
      out.stocktaking = {
        sessions: rows.length,
        diff_value: r2(lines.reduce((s, r) => s + num(r.diff_value), 0)),
        lines_with_diff: lines.filter((r) => num(r.diff_qty) !== 0).length,
        rows: rows.slice(0, cap),
        lines: include_lines ? lines : undefined,
      };
    }

    if (want("treasury")) {
      const rows = await grab(
        "meat_factory_treasury_txns",
        supabase
          .from("meat_factory_treasury_txns")
          .select("*")
          .gte("txn_date", dFrom)
          .lte("txn_date", dTo)
          .order("txn_date", { ascending: false })
          .limit(5000),
      );
      const dir = (d: string) =>
        r2(rows.filter((r) => String(r.direction) === d).reduce((s, r) => s + num(r.amount), 0));
      out.treasury = {
        transactions: rows.length,
        income: dir("in"),
        expense: dir("out"),
        net: r2(dir("in") - dir("out")),
        rows: rows.slice(0, cap),
      };
    }

    if (want("recipes")) {
      const [recipes, status] = await Promise.all([
        grab("meat_factory_recipes", supabase.from("meat_factory_recipes").select("*").limit(3000)),
        grab("meat_recipe_version_status", supabase.from("meat_recipe_version_status").select("*").limit(1000)),
      ]);
      const byProduct = new Map<string, Set<number>>();
      recipes.forEach((r) => {
        const k = String(r.product_code);
        if (!byProduct.has(k)) byProduct.set(k, new Set());
        byProduct.get(k)!.add(num(r.version));
      });
      out.recipes = {
        products_with_bom: byProduct.size,
        lines: recipes.length,
        active_versions: status.filter((s) => s.is_active),
        versions: Array.from(byProduct.entries()).map(([code, vs]) => ({
          product_code: code,
          versions: Array.from(vs).sort((a, b) => a - b),
        })),
        rows: include_lines ? recipes.slice(0, 1000) : undefined,
      };
    }

    if (want("products")) {
      const rows = await grab(
        "meat_factory_products",
        supabase.from("meat_factory_products").select("*").limit(1000),
      );
      out.products = {
        count: rows.length,
        active: rows.filter((r) => r.is_active !== false).length,
        rows: rows.slice(0, cap),
      };
    }

    const payload = {
      module: "meat_factory",
      period: { from: dFrom, to: dTo },
      currency: "EGP",
      weight_unit: "kg",
      generated_at: new Date().toISOString(),
      note:
        "الفواتير والدفعات الملغاة مستبعدة من الكميات والتكاليف (كمياتها ترتد للمخزون تلقائيًا). التكلفة والقيم المالية تظهر فقط للأدوار المصرّح لها عبر RLS. مصدر أرصدة المخزون هو جداول مخزون المصنع وليس products.stock.",
      access_notes: notes,
      sections_returned: Object.keys(out),
      ...out,
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload as any };
  },
});
