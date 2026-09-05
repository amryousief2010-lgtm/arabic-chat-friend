import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

const num = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export default defineTool({
  name: "finance_report",
  title: "Finance report",
  description:
    "التقرير المالي: أرصدة الخزائن (الرئيسية، المعمل، المصانع، عُهد المجزر)، والمصروفات والإيرادات خلال فترة، والمديونيات المفتوحة. كل القيم بالجنيه المصري وتظهر حسب صلاحيات المستخدم.",
  inputSchema: {
    date_from: z.string().optional().describe("من تاريخ YYYY-MM-DD (للحركات)."),
    date_to: z.string().optional().describe("إلى تاريخ YYYY-MM-DD."),
    include_balances: z.boolean().optional().describe("تضمين أرصدة الخزائن (افتراضي true)."),
    include_receivables: z.boolean().optional().describe("تضمين مديونيات العملاء (افتراضي true)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ date_from, date_to, include_balances, include_receivables }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const notes: string[] = [];
    const payload: Record<string, unknown> = {
      currency: "EGP",
      generated_at: new Date().toISOString(),
      period: { from: date_from ?? null, to: date_to ?? null },
    };

    if (include_balances !== false) {
      const balances: Record<string, unknown> = {};
      for (const [key, view] of [
        ["main_treasury", "v_main_treasury_balance"],
        ["lab_treasury", "v_lab_treasury_balances"],
        ["inter_treasury", "v_treasury_inter_balances"],
        ["slaughter_custody", "v_slaughter_custody_balance"],
        ["feed_internal", "v_feed_internal_balances"],
      ] as const) {
        const { data, error } = await supabase.from(view).select("*").limit(200);
        if (error) notes.push(`${key}: ${error.message}`);
        else balances[key] = data ?? [];
      }
      payload.treasury_balances = balances;
    }

    if (date_from && date_to) {
      const { data, error } = await supabase
        .from("main_treasury_transactions")
        .select("transaction_type, category, amount, transaction_date, status")
        .gte("transaction_date", date_from)
        .lte("transaction_date", date_to)
        .limit(10000);
      if (error) notes.push(`main_treasury_transactions: ${error.message}`);
      const rows = (data as any[]) ?? [];
      const bucket = (type: string) => rows.filter((r) => String(r.transaction_type) === type);
      const byCat = (list: any[]) => {
        const m = new Map<string, number>();
        for (const r of list) m.set(r.category || "غير مصنف", (m.get(r.category || "غير مصنف") ?? 0) + num(r.amount));
        return Array.from(m.entries())
          .map(([category, total]) => ({ category, total: Number(total.toFixed(2)) }))
          .sort((a, b) => b.total - a.total);
      };
      payload.main_treasury_flows = {
        transactions: rows.length,
        income_total: Number(bucket("income").reduce((s, r) => s + num(r.amount), 0).toFixed(2)),
        expense_total: Number(bucket("expense").reduce((s, r) => s + num(r.amount), 0).toFixed(2)),
        income_by_category: byCat(bucket("income")),
        expense_by_category: byCat(bucket("expense")),
      };
    }

    if (include_receivables !== false) {
      const { data, error } = await supabase.from("v_lab_customer_balances").select("*").limit(500);
      if (error) notes.push(`v_lab_customer_balances: ${error.message}`);
      else payload.lab_customer_balances = data ?? [];
    }

    payload.definitions = {
      treasury_balances: "الرصيد الحالي لكل خزينة كما تعرضه شاشات الخزائن.",
      income_total: "إجمالي الوارد المسجل في الخزينة الرئيسية خلال الفترة.",
      expense_total: "إجمالي المنصرف المسجل في الخزينة الرئيسية خلال الفترة.",
      receivables: "أرصدة العملاء المدينة (مستحق التحصيل).",
    };
    payload.access_notes = notes;
    payload.note = "أي عنصر مفقود هنا يعني أن دور المستخدم الحالي لا يملك صلاحية قراءته.";

    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload as any };
  },
});
