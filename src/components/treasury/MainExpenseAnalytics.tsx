import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import ExpenseAnalyticsPanel, { AnalyticsRow } from "./ExpenseAnalyticsPanel";

type Txn = {
  id: string;
  txn_date: string;
  txn_type: string;
  amount: number | string;
  status: string;
  category_id: string | null;
  description?: string;
  payment_method?: string;
  created_by?: string;
};

type Category = { id: string; code: string; label: string };

type Props = {
  txns: Txn[];
  categories: Category[];
  typeLabels: Record<string, string>;
};

const INCOME_TYPES = new Set(["deposit", "bank_deposit", "transfer_from_custody"]);
const EXPENSE_TYPES = new Set([
  "expense", "withdrawal", "bank_withdrawal", "loan_installment",
  "bank_fees", "transfer_to_custody", "transfer_to_sub_treasury", "transfer_to_bank",
]);

export default function MainExpenseAnalytics({ txns, categories, typeLabels }: Props) {
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  useEffect(() => {
    const ids = [...new Set(txns.map(t => t.created_by).filter(Boolean) as string[])];
    if (!ids.length) return;
    (supabase as any).from("profile_directory").select("user_id, full_name").in("user_id", ids).then(({ data }: any) => {
      const m: Record<string, string> = {};
      (data || []).forEach((p: any) => { if (p.full_name) m[p.user_id] = p.full_name; });
      setUserMap(m);
    });
  }, [txns]);

  const catMap = useMemo(() => {
    const m: Record<string, string> = {};
    categories.forEach(c => { m[c.id] = c.label; });
    return m;
  }, [categories]);

  const rows: AnalyticsRow[] = useMemo(() => txns.map(t => {
    const isIncome = INCOME_TYPES.has(t.txn_type);
    // Prefer expense category, then transaction type label as fallback
    const categoryFromBucket = t.category_id ? catMap[t.category_id] : null;
    const fallback = typeLabels[t.txn_type] || t.txn_type;
    return {
      id: t.id,
      date: t.txn_date,
      category: categoryFromBucket || fallback,
      amount: Number(t.amount),
      type: isIncome ? "income" as const : "expense" as const,
      status: t.status,
      paymentMethod: (t as any).payment_method,
      createdByName: t.created_by ? (userMap[t.created_by] || t.created_by.slice(0, 8)) : "—",
    };
  }).filter(r => INCOME_TYPES.has((txns.find(t => t.id === r.id) as any).txn_type) || EXPENSE_TYPES.has((txns.find(t => t.id === r.id) as any).txn_type)), [txns, catMap, typeLabels, userMap]);

  return (
    <ExpenseAnalyticsPanel
      title="تحليل مصروفات الخزنة الرئيسية"
      treasuryName="الخزنة الرئيسية"
      rows={rows}
      approvedStatuses={["posted", "approved"]}
      pendingStatuses={["pending_approval", "draft"]}
    />
  );
}
