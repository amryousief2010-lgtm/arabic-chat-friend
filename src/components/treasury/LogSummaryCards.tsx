import { Card, CardContent } from "@/components/ui/card";
import { fmtNum } from "@/lib/printPdf";
import { TrendingUp, TrendingDown, Wallet, Hash, ArrowUpRight, ArrowDownRight, CreditCard } from "lucide-react";

type Row = { amount: number; payment_method?: string | null; movement_type?: "income" | "expense" | string };

const PM_LBL: Record<string, string> = {
  cash: "نقدي", vodafone_cash: "فودافون كاش",
  instapay: "إنستا باي", bank_transfer: "تحويل بنكي", transfer: "تحويل",
};

interface Props {
  /** "all" | "income" | "expense" — selected type filter */
  typeFilter: "all" | "income" | "expense";
  /** Filtered income rows (already after all filters). Ignored when typeFilter==="expense". */
  incomes?: Row[];
  /** Filtered expense rows (already after all filters). Ignored when typeFilter==="income". */
  expenses?: Row[];
  /** Optional title above the cards */
  title?: string;
  /** Show per-payment-method breakdown for the dominant side */
  showPaymentBreakdown?: boolean;
}

function Stat({ icon, label, value, tone = "default" }: { icon: React.ReactNode; label: string; value: string; tone?: "default" | "success" | "danger" | "primary" }) {
  const toneCls =
    tone === "success" ? "border-emerald-500/30 bg-emerald-500/5" :
    tone === "danger" ? "border-rose-500/30 bg-rose-500/5" :
    tone === "primary" ? "border-primary/30 bg-primary/5" :
    "border-border bg-card";
  const iconCls =
    tone === "success" ? "text-emerald-600" :
    tone === "danger" ? "text-rose-600" :
    tone === "primary" ? "text-primary" :
    "text-muted-foreground";
  return (
    <Card className={toneCls}>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={iconCls}>{icon}</span>
          <span>{label}</span>
        </div>
        <div className="mt-1 font-mono font-bold text-lg tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function LogSummaryCards({ typeFilter, incomes = [], expenses = [], title = "ملخص النتائج حسب الفلتر الحالي", showPaymentBreakdown = true }: Props) {
  const inSum = incomes.reduce((s, r) => s + Number(r.amount || 0), 0);
  const exSum = expenses.reduce((s, r) => s + Number(r.amount || 0), 0);

  const incPmTotals: Record<string, number> = {};
  incomes.forEach(r => { const k = r.payment_method || "—"; incPmTotals[k] = (incPmTotals[k] || 0) + Number(r.amount || 0); });
  const exPmTotals: Record<string, number> = {};
  expenses.forEach(r => { const k = r.payment_method || "—"; exPmTotals[k] = (exPmTotals[k] || 0) + Number(r.amount || 0); });

  const maxInc = incomes.length ? Math.max(...incomes.map(r => Number(r.amount || 0))) : 0;
  const maxExp = expenses.length ? Math.max(...expenses.map(r => Number(r.amount || 0))) : 0;
  const lastInc = incomes.length ? Number(incomes[0]?.amount || 0) : 0;
  const lastExp = expenses.length ? Number(expenses[0]?.amount || 0) : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Wallet className="w-4 h-4 text-primary" />
        <span>{title}</span>
      </div>

      {typeFilter === "income" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat icon={<Hash className="w-4 h-4" />} label="عدد حركات الإيراد" value={String(incomes.length)} tone="primary" />
          <Stat icon={<TrendingUp className="w-4 h-4" />} label="إجمالي الإيراد" value={fmtNum(inSum, 2)} tone="success" />
          <Stat icon={<ArrowUpRight className="w-4 h-4" />} label="أعلى إيراد" value={fmtNum(maxInc, 2)} tone="success" />
          <Stat icon={<TrendingUp className="w-4 h-4" />} label="آخر إيراد" value={fmtNum(lastInc, 2)} tone="default" />
        </div>
      )}

      {typeFilter === "expense" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat icon={<Hash className="w-4 h-4" />} label="عدد حركات المصروف" value={String(expenses.length)} tone="primary" />
          <Stat icon={<TrendingDown className="w-4 h-4" />} label="إجمالي المصروف" value={fmtNum(exSum, 2)} tone="danger" />
          <Stat icon={<ArrowDownRight className="w-4 h-4" />} label="أعلى مصروف" value={fmtNum(maxExp, 2)} tone="danger" />
          <Stat icon={<TrendingDown className="w-4 h-4" />} label="آخر مصروف" value={fmtNum(lastExp, 2)} tone="default" />
        </div>
      )}

      {typeFilter === "all" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat icon={<Hash className="w-4 h-4" />} label="عدد الحركات" value={String(incomes.length + expenses.length)} tone="primary" />
          <Stat icon={<TrendingUp className="w-4 h-4" />} label="إجمالي الإيرادات" value={fmtNum(inSum, 2)} tone="success" />
          <Stat icon={<TrendingDown className="w-4 h-4" />} label="إجمالي المصروفات" value={fmtNum(exSum, 2)} tone="danger" />
          <Stat icon={<Wallet className="w-4 h-4" />} label="الصافي" value={fmtNum(inSum - exSum, 2)} tone={inSum - exSum >= 0 ? "success" : "danger"} />
        </div>
      )}

      {showPaymentBreakdown && (typeFilter === "income" ? Object.keys(incPmTotals).length > 1 : typeFilter === "expense" ? Object.keys(exPmTotals).length > 1 : (Object.keys(incPmTotals).length > 1 || Object.keys(exPmTotals).length > 1)) && (
        <Card className="border-dashed">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground mb-2">
              <CreditCard className="w-3.5 h-3.5" /> توزيع حسب طريقة الدفع
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              {typeFilter !== "expense" && Object.entries(incPmTotals).map(([k, v]) => (
                <div key={"i-" + k} className="rounded border px-2 py-1 bg-emerald-500/5">
                  <div className="text-muted-foreground">إيراد — {PM_LBL[k] || k}</div>
                  <div className="font-mono font-bold">{fmtNum(v, 2)}</div>
                </div>
              ))}
              {typeFilter !== "income" && Object.entries(exPmTotals).map(([k, v]) => (
                <div key={"e-" + k} className="rounded border px-2 py-1 bg-rose-500/5">
                  <div className="text-muted-foreground">مصروف — {PM_LBL[k] || k}</div>
                  <div className="font-mono font-bold">{fmtNum(v, 2)}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
