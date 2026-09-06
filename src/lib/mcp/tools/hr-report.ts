import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "hr_report",
  title: "HR report",
  description:
    "تقرير الموارد البشرية: الموظفون النشطون والموقوفون حسب القسم والموقع ونوع التعيين، والخصومات المعتمدة، ومسيّرات الرواتب (الأساسي/البونص/السلف/الخصومات/الصافي) لشهر محدد. قراءة فقط بصلاحيات المستخدم.",
  inputSchema: {
    month: z.number().optional().describe("الشهر 1-12 (افتراضي الشهر الحالي)."),
    year: z.number().optional().describe("السنة (افتراضي السنة الحالية)."),
    department: z.string().optional().describe("تصفية بالقسم."),
    status: z.string().optional().describe("حالة الموظف: active أو inactive."),
    include_employees: z.boolean().optional().describe("إرجاع قائمة الموظفين (افتراضي false، ملخص فقط)."),
    limit: z.number().optional().describe("حد صفوف القوائم (افتراضي 200، أقصى 1000)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ month, year, department, status, include_employees, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const now = new Date();
    const m = month ?? now.getUTCMonth() + 1;
    const y = year ?? now.getUTCFullYear();
    const cap = Math.min(Math.max(limit ?? 200, 1), 1000);

    let empQ = supabase
      .from("hr_employees")
      .select(
        "id,code,full_name,job_title,department,employment_type,base_salary,daily_rate,status,is_suspended,start_date,current_location_id",
      )
      .limit(cap);
    if (department) empQ = empQ.eq("department", department);
    if (status) empQ = empQ.eq("status", status as any);

    const [emp, ded, pay] = await Promise.all([
      empQ,
      supabase
        .from("hr_deductions")
        .select("id,employee_id,deduction_type,amount,status,deduction_date")
        .eq("month", m)
        .eq("year", y)
        .limit(cap),
      supabase
        .from("hr_payroll_payouts")
        .select(
          "id,employee_id,base_salary,bonus_amount,advances_amount,penalties_amount,absence_amount,other_deductions_amount,net_amount,status,pay_day",
        )
        .eq("month", m)
        .eq("year", y)
        .limit(cap),
    ]);

    const err = emp.error || ded.error || pay.error;
    if (err) return { content: [{ type: "text", text: err.message }], isError: true };

    const employees = emp.data ?? [];
    const deductions = ded.data ?? [];
    const payouts = pay.data ?? [];
    const sum = (rows: any[], k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
    const byKey = (rows: any[], k: string) =>
      rows.reduce<Record<string, number>>((acc, r) => {
        const key = String(r[k] ?? "غير محدد");
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});

    const payload = {
      period: { month: m, year: y },
      currency: "EGP",
      employees_summary: {
        total: employees.length,
        active: employees.filter((e: any) => e.status === "active").length,
        suspended: employees.filter((e: any) => e.is_suspended).length,
        by_department: byKey(employees, "department"),
        by_employment_type: byKey(employees, "employment_type"),
        total_base_salaries: sum(employees, "base_salary"),
      },
      deductions_summary: {
        count: deductions.length,
        total_amount: sum(deductions, "amount"),
        approved_amount: sum(
          deductions.filter((d: any) => d.status === "approved"),
          "amount",
        ),
        by_type: deductions.reduce<Record<string, number>>((acc, d: any) => {
          const k = String(d.deduction_type ?? "other");
          acc[k] = (acc[k] ?? 0) + Number(d.amount ?? 0);
          return acc;
        }, {}),
      },
      payroll_summary: {
        payouts_count: payouts.length,
        base: sum(payouts, "base_salary"),
        bonus: sum(payouts, "bonus_amount"),
        advances: sum(payouts, "advances_amount"),
        penalties: sum(payouts, "penalties_amount"),
        absence: sum(payouts, "absence_amount"),
        other_deductions: sum(payouts, "other_deductions_amount"),
        net_total: sum(payouts, "net_amount"),
      },
      ...(include_employees ? { employees } : {}),
      note: "الرواتب والخصومات بالجنيه المصري. الصفوف غير المصرح بها لا تظهر بسبب سياسات الأمان (RLS).",
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload as any };
  },
});
