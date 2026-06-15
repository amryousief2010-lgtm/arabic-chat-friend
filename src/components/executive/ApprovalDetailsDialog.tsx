import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { ApprovalItem } from "@/hooks/useExecutiveApprovals";

const fmtMoney = (n: any) =>
  `${Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م`;
const fmtDateTime = (d: any) =>
  d ? new Date(d).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }) : "—";
const fmtNum = (n: any, d = 2) =>
  Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: d });

function Row({ label, value }: { label: string; value: any }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex justify-between gap-3 text-sm border-b border-dashed py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground text-left" dir="auto">{value}</span>
    </div>
  );
}

export default function ApprovalDetailsDialog({
  item,
  onClose,
}: {
  item: ApprovalItem | null;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<any[] | null>(null);
  const [packLines, setPackLines] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!item) {
      setLines(null);
      setPackLines(null);
      return;
    }
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        // Manufacturing invoices → load lines
        if (item.category === "meat" && item.raw?._source_table === "meat_manufacturing_invoices") {
          const { data } = await (supabase as any)
            .from("meat_manufacturing_invoice_lines")
            .select("*, meat_factory_raw_items(name, unit)")
            .eq("invoice_id", item.id);
          if (!cancel) setLines(data || []);
        } else if (item.category === "meat" && item.raw?._source_table === "meat_factory_manufacturing") {
          const [{ data: raw }, { data: pack }] = await Promise.all([
            (supabase as any)
              .from("meat_factory_manufacturing_lines")
              .select("*")
              .eq("manufacturing_id", item.id),
            (supabase as any)
              .from("meat_factory_manufacturing_packaging_lines")
              .select("*")
              .eq("manufacturing_id", item.id),
          ]);
          if (!cancel) {
            setLines(raw || []);
            setPackLines(pack || []);
          }
        }
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [item]);

  if (!item) return null;
  const r = item.raw || {};

  return (
    <Dialog open={!!item} onOpenChange={(v) => !v && onClose()}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[88vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            تفاصيل قبل الاعتماد
            <Badge variant="secondary" className="ml-2">{item.source}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto space-y-4 pr-1">
          {/* Header summary */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
            <div className="font-bold text-base">{item.title}</div>
            {item.subtitle && (
              <div className="text-xs text-muted-foreground">{item.subtitle}</div>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pt-1">
              <span>التاريخ: <b>{fmtDateTime(item.created_at)}</b></span>
              <span>المسجِّل: <b>{item.creator_name || "—"}</b></span>
              {item.amount != null && <span>المبلغ: <b className="text-primary">{fmtMoney(item.amount)}</b></span>}
              {item.qty != null && <span>الكمية: <b>{fmtNum(item.qty, 3)} {item.unit || ""}</b></span>}
            </div>
          </div>

          {/* Category-specific fields */}
          <div className="rounded-lg border p-3">
            <div className="font-semibold text-sm mb-2 text-primary">بيانات السجل</div>

            {item.category === "treasury" && (
              <>
                <Row label="رقم المرجع" value={r.reference_no} />
                <Row label="نوع الحركة" value={r.txn_type} />
                <Row label="الغرض" value={r.deposit_purpose} />
                <Row label="مصدر التوريد" value={r.incoming_source} />
                <Row label="الطرف المقابل" value={r.counterparty} />
                <Row label="طريقة الدفع" value={r.payment_method} />
                <Row label="تاريخ الحركة" value={fmtDateTime(r.txn_date)} />
                <Row label="الوصف" value={r.description} />
              </>
            )}

            {item.category === "lab" && (
              <>
                <Row label="نوع الحركة" value={r.movement_type} />
                <Row label="بند الإيراد" value={r.income_category} />
                <Row label="بند المصروف" value={r.expense_category} />
                <Row label="العميل" value={r.customer_name} />
                <Row label="المستفيد" value={r.beneficiary} />
                <Row label="طريقة الدفع" value={r.payment_method} />
                <Row label="تاريخ" value={fmtDateTime(r.movement_date)} />
                <Row label="الوصف" value={r.description} />
                <Row label="ملاحظات" value={r.notes} />
              </>
            )}

            {item.category === "meat" && r._source_table === "meat_manufacturing_invoices" && (
              <>
                <Row label="رقم الفاتورة" value={r.invoice_no} />
                <Row label="المنتج" value={r.product_name} />
                <Row label="الكمية المنتجة" value={`${fmtNum(r.finished_qty, 3)} ${r.unit || ""}`} />
                <Row label="تكلفة الخامات" value={fmtMoney(r.materials_total_cost)} />
                <Row label="تكلفة التغليف" value={fmtMoney(r.packaging_cost)} />
                <Row label="إجمالي تكلفة التصنيع" value={fmtMoney(r.total_manufacturing_cost)} />
                <Row label="ملاحظات" value={r.notes} />
              </>
            )}

            {item.category === "meat" && r._source_table === "meat_factory_manufacturing" && (
              <>
                <Row label="رقم التصنيع" value={r.invoice_number} />
                <Row label="المنتج النهائي" value={r.finished_item_name} />
                <Row label="الكمية المنتجة" value={fmtNum(r.produced_qty, 3)} />
                <Row label="إجمالي التكلفة" value={fmtMoney(r.total_cost)} />
                <Row label="تاريخ التصنيع" value={fmtDateTime(r.mfg_date)} />
                <Row label="ملاحظات" value={r.notes} />
              </>
            )}

            {item.category === "custody" && (
              <>
                <Row label="البند" value={r.category} />
                <Row label="المستفيد" value={r.beneficiary} />
                <Row label="طريقة الدفع" value={r.payment_method} />
                <Row label="تاريخ المصروف" value={fmtDateTime(r.expense_date)} />
                <Row label="تجاوز الحد" value={r.over_limit ? "نعم" : "لا"} />
                <Row label="الوصف" value={r.description} />
                <Row label="ملاحظات" value={r.notes} />
              </>
            )}

            {item.category === "slaughter" && (
              <>
                <Row label="رقم التقسيمة" value={r.batch_number} />
                <Row label="الوردية" value={r.shift} />
                <Row label="تاريخ الذبح" value={fmtDateTime(r.slaughter_date)} />
                <Row label="عدد النعام" value={fmtNum(r.birds_slaughtered, 0)} />
                <Row label="الوزن الحي" value={`${fmtNum(r.total_live_weight_kg)} كجم`} />
                <Row label="اللحم الناتج" value={`${fmtNum(r.total_meat_kg)} كجم`} />
                <Row label="نسبة التصافي" value={`${fmtNum(r.actual_yield_pct)} %`} />
                <Row label="ملاحظات" value={r.notes} />
              </>
            )}
          </div>

          {/* Lines for meat manufacturing */}
          {item.category === "meat" && (
            <div className="rounded-lg border p-3">
              <div className="font-semibold text-sm mb-2 text-primary">
                بنود التصنيع (خامات وبهارات)
              </div>
              {loading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : !lines || lines.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-2">
                  لا توجد بنود مسجلة
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-1.5 text-right">الصنف</th>
                        <th className="p-1.5">الكمية</th>
                        <th className="p-1.5">الوحدة</th>
                        <th className="p-1.5">سعر الوحدة</th>
                        <th className="p-1.5">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l: any, idx: number) => {
                        const name = l.meat_factory_raw_items?.name || l.item_name || l.raw_item_name || "—";
                        const unit = l.meat_factory_raw_items?.unit || l.unit || "";
                        const qty = l.quantity ?? l.qty ?? 0;
                        const unitCost = l.unit_cost ?? l.cost_per_unit ?? 0;
                        const total = l.total_cost ?? Number(qty) * Number(unitCost);
                        return (
                          <tr key={idx} className="border-b">
                            <td className="p-1.5">{name}</td>
                            <td className="p-1.5 text-center tabular-nums">{fmtNum(qty, 3)}</td>
                            <td className="p-1.5 text-center">{unit}</td>
                            <td className="p-1.5 text-center tabular-nums">{fmtNum(unitCost)}</td>
                            <td className="p-1.5 text-center tabular-nums font-semibold">{fmtMoney(total)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {packLines && packLines.length > 0 && (
                <>
                  <div className="font-semibold text-sm mt-3 mb-2 text-primary">خامات التغليف</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="p-1.5 text-right">الصنف</th>
                          <th className="p-1.5">الكمية</th>
                          <th className="p-1.5">سعر الوحدة</th>
                          <th className="p-1.5">الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {packLines.map((l: any, idx: number) => (
                          <tr key={idx} className="border-b">
                            <td className="p-1.5">{l.item_name || "—"}</td>
                            <td className="p-1.5 text-center tabular-nums">{fmtNum(l.quantity, 3)}</td>
                            <td className="p-1.5 text-center tabular-nums">{fmtNum(l.unit_cost)}</td>
                            <td className="p-1.5 text-center tabular-nums font-semibold">
                              {fmtMoney(l.total_cost ?? Number(l.quantity) * Number(l.unit_cost))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="border-t pt-3">
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
