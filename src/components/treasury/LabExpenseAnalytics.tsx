import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import ExpenseAnalyticsPanel, { AnalyticsRow } from "./ExpenseAnalyticsPanel";

type Movement = {
  id: string;
  movement_date: string;
  movement_type: "income" | "expense";
  income_category?: string | null;
  expense_category?: string | null;
  amount: number | string;
  status: string;
  payment_method?: string;
  created_by?: string | null;
};

type Props = {
  movements: Movement[];
  incomeLabels: Record<string, string>;
  expenseLabels: Record<string, string>;
};

const PM_LBL: Record<string, string> = {
  cash: "نقدي", vodafone_cash: "فودافون كاش",
  instapay: "إنستا باي", bank_transfer: "تحويل بنكي",
};

export default function LabExpenseAnalytics({ movements, incomeLabels, expenseLabels }: Props) {
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  useEffect(() => {
    const ids = [...new Set(movements.map(m => m.created_by).filter(Boolean) as string[])];
    if (!ids.length) return;
    (supabase as any).from("profile_directory").select("user_id, full_name").in("user_id", ids).then(({ data }: any) => {
      const m: Record<string, string> = {};
      (data || []).forEach((p: any) => { if (p.full_name) m[p.user_id] = p.full_name; });
      setUserMap(m);
    });
  }, [movements]);

  const rows: AnalyticsRow[] = useMemo(() => movements.map(m => ({
    id: m.id,
    date: m.movement_date,
    category: m.movement_type === "income"
      ? (incomeLabels[m.income_category || ""] || m.income_category || "—")
      : (expenseLabels[m.expense_category || ""] || m.expense_category || "—"),
    categoryCode: m.movement_type === "income" ? (m.income_category || "") : (m.expense_category || ""),
    amount: Number(m.amount),
    type: m.movement_type,
    status: m.status,
    paymentMethod: m.payment_method ? (PM_LBL[m.payment_method] || m.payment_method) : undefined,
    createdByName: m.created_by ? (userMap[m.created_by] || m.created_by.slice(0, 8)) : "—",
  })), [movements, incomeLabels, expenseLabels, userMap]);

  return (
    <ExpenseAnalyticsPanel
      title="تحليل مصروفات خزنة المعمل"
      treasuryName="خزنة المعمل"
      rows={rows}
    />
  );
}
