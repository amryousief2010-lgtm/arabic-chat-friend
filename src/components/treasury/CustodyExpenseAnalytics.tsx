import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import ExpenseAnalyticsPanel, { AnalyticsRow } from "./ExpenseAnalyticsPanel";

type ExpenseLike = {
  id: string;
  expense_date: string;
  category: string;
  amount: number | string;
  status: string;
  payment_method?: string;
  created_by?: string | null;
};

type Props = {
  expenses: ExpenseLike[];
  catLabel: Record<string, string>;
};

const PM_LBL: Record<string, string> = {
  cash: "نقدي", vodafone_cash: "فودافون كاش",
  instapay: "إنستا باي", bank_transfer: "تحويل بنكي",
};

export default function CustodyExpenseAnalytics({ expenses, catLabel }: Props) {
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  useEffect(() => {
    const ids = [...new Set(expenses.map(e => e.created_by).filter(Boolean) as string[])];
    if (!ids.length) return;
    (supabase as any).from("profile_directory").select("user_id, full_name").in("user_id", ids).then(({ data }: any) => {
      const m: Record<string, string> = {};
      (data || []).forEach((p: any) => { if (p.full_name) m[p.user_id] = p.full_name; });
      setUserMap(m);
    });
  }, [expenses]);

  const rows: AnalyticsRow[] = useMemo(() => expenses.map(e => ({
    id: e.id,
    date: e.expense_date,
    category: catLabel[e.category] || e.category,
    categoryCode: e.category,
    amount: Number(e.amount),
    type: "expense" as const,
    status: e.status,
    paymentMethod: e.payment_method ? (PM_LBL[e.payment_method] || e.payment_method) : undefined,
    createdByName: e.created_by ? (userMap[e.created_by] || e.created_by.slice(0, 8)) : "—",
  })), [expenses, catLabel, userMap]);

  return (
    <ExpenseAnalyticsPanel
      title="تحليل مصروفات خزنة العهدة"
      treasuryName="خزنة العهدة"
      rows={rows}
    />
  );
}
