import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "customers_report",
  title: "Customers report",
  description:
    "تحليل العملاء: العدد الإجمالي، التوزيع حسب المحافظة والمصدر وقناة التواصل، أعلى العملاء إنفاقًا، والعملاء الجدد خلال فترة. بيانات الاتصال لا تُرجع إلا عند طلبها صراحةً ووفق صلاحيات المستخدم.",
  inputSchema: {
    date_from: z.string().optional().describe("من تاريخ إنشاء العميل YYYY-MM-DD."),
    date_to: z.string().optional().describe("إلى تاريخ YYYY-MM-DD."),
    governorate: z.string().optional().describe("تصفية بالمحافظة."),
    source: z.string().optional().describe("تصفية بمصدر العميل."),
    min_total_spent: z.number().optional().describe("حد أدنى لإجمالي إنفاق العميل."),
    include_contacts: z.boolean().optional().describe("إرجاع الاسم والهاتف (افتراضي false)."),
    top_limit: z.number().optional().describe("عدد أعلى العملاء (افتراضي 20، أقصى 200)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (
    { date_from, date_to, governorate, source, min_total_spent, include_contacts, top_limit },
    ctx,
  ) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const cap = Math.min(Math.max(top_limit ?? 20, 1), 200);

    const cols = include_contacts
      ? "id,name,phone,governorate,area,source,communication_channel,shipping_company,total_orders,total_spent,created_at"
      : "id,governorate,area,source,communication_channel,shipping_company,total_orders,total_spent,created_at";

    let base = supabase.from("customers").select(cols, { count: "exact", head: true });
    let list = supabase.from("customers").select(cols).order("total_spent", { ascending: false }).limit(cap);
    let agg = supabase
      .from("customers")
      .select("governorate,source,communication_channel,total_orders,total_spent")
      .limit(5000);

    const applyAll = <T extends { eq: any; gte: any; lte: any }>(q: T): T => {
      let r: any = q;
      if (date_from) r = r.gte("created_at", `${date_from}T00:00:00Z`);
      if (date_to) r = r.lte("created_at", `${date_to}T23:59:59Z`);
      if (governorate) r = r.eq("governorate", governorate);
      if (source) r = r.eq("source", source);
      if (min_total_spent != null) r = r.gte("total_spent", min_total_spent);
      return r;
    };
    base = applyAll(base as any);
    list = applyAll(list as any);
    agg = applyAll(agg as any);

    const [countRes, listRes, aggRes] = await Promise.all([base, list, agg]);
    const err = countRes.error || listRes.error || aggRes.error;
    if (err) return { content: [{ type: "text", text: err.message }], isError: true };

    const rows = (aggRes.data as any[]) ?? [];
    const group = (k: string) =>
      rows.reduce<Record<string, { customers: number; spent: number }>>((acc, r) => {
        const key = String(r[k] ?? "غير محدد");
        acc[key] = acc[key] ?? { customers: 0, spent: 0 };
        acc[key].customers += 1;
        acc[key].spent += Number(r.total_spent ?? 0);
        return acc;
      }, {});

    const payload = {
      period: { from: date_from ?? null, to: date_to ?? null },
      currency: "EGP",
      total_customers: countRes.count ?? 0,
      sampled_for_grouping: rows.length,
      totals: {
        orders: rows.reduce((a, r: any) => a + Number(r.total_orders ?? 0), 0),
        spent: rows.reduce((a, r: any) => a + Number(r.total_spent ?? 0), 0),
      },
      by_governorate: group("governorate"),
      by_source: group("source"),
      by_channel: group("communication_channel"),
      top_customers: listRes.data ?? [],
      contacts_included: Boolean(include_contacts),
      note: "total_spent/total_orders حقول تجميعية على العميل؛ للمبيعات المسلّمة الدقيقة استخدم sales_report. التجميع محسوب على عيّنة حتى 5000 عميل.",
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload as any };
  },
});
