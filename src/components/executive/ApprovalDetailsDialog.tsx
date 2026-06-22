import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { ApprovalItem } from "@/hooks/useExecutiveApprovals";
import { parseServiceCostsFromNotes } from "@/lib/meatServiceCosts";
import { openPrintWindow } from "@/lib/printPdf";

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
        } else if (item.category === "mf_purchase" && item.raw?._kind === "meat_factory_purchase") {
          const { data } = await (supabase as any)
            .from("meat_factory_purchase_lines")
            .select("*")
            .eq("purchase_id", item.id)
            .order("created_at");
          if (!cancel) setLines(data || []);
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

            {item.category === "meat" && r._source_table === "meat_manufacturing_invoices" && (() => {
              const svcTotal = parseServiceCostsFromNotes(r.notes).reduce((s, x) => s + Number(x.total || 0), 0);
              const effectiveExtra = Math.max(Number(r.extra_cost || 0), svcTotal);
              const baseCosts = Number(r.raw_cost || 0) + Number(r.spice_cost || 0) + Number(r.packaging_cost || 0);
              const effectiveTotal = Math.max(Number(r.total_manufacturing_cost || 0), baseCosts + effectiveExtra);
              const qty = Number(r.finished_qty || 0);
              const effectiveUnit = qty > 0 ? effectiveTotal / qty : Number(r.unit_cost || 0);
              return (
                <>
                  <Row label="رقم الفاتورة" value={r.invoice_no} />
                  <Row label="المنتج" value={r.product_name} />
                  <Row label="الكمية المنتجة" value={`${fmtNum(r.finished_qty, 3)} ${r.unit || ""}`} />
                  <Row label="إجمالي الخامات" value={fmtMoney(r.raw_cost)} />
                  <Row label="إجمالي البهارات" value={fmtMoney(r.spice_cost)} />
                  <Row label="إجمالي التغليف" value={fmtMoney(r.packaging_cost)} />
                  <Row label="إجمالي المواد الخدمية / التكاليف الإضافية" value={fmtMoney(effectiveExtra)} />
                  <Row label="إجمالي تكلفة التصنيع" value={fmtMoney(effectiveTotal)} />
                  <Row label="تكلفة الوحدة" value={fmtMoney(effectiveUnit)} />
                  <Row label="ملاحظات" value={r.notes} />
                </>
              );
            })()}

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

            {item.category === "mf_purchase" && r._kind === "meat_factory_purchase" && (
              <>
                <Row label="رقم الفاتورة" value={r.invoice_no || "— لم تُعتمد —"} />
                <Row label="تاريخ الفاتورة" value={r.purchase_date} />
                <Row label="المورد" value={r.supplier} />
                <Row label="نوع الفاتورة" value={({ raw: "خامات", spice: "بهارات", packaging: "تغليف", mixed: "mixed" } as any)[r.invoice_type] || r.invoice_type} />
                <Row label="طريقة الدفع" value={({ cash: "نقدي", credit: "آجل", transfer: "تحويل", other: "أخرى" } as any)[r.payment_method] || r.payment_method} />
                <Row label="رقم الإيصال" value={r.receipt_no} />
                <Row label="الإجمالي" value={fmtMoney(r.total_amount)} />
                <Row label="ملاحظات" value={r.notes} />
              </>
            )}
          </div>

          {/* Lines for meat factory purchase invoice */}
          {item.category === "mf_purchase" && r._kind === "meat_factory_purchase" && (
            <div className="rounded-lg border p-3">
              <div className="font-semibold text-sm mb-2 text-primary">بنود الفاتورة</div>
              {loading ? (
                <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : !lines || lines.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-2">لا توجد بنود مسجلة</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-1.5 text-right">الصنف</th>
                        <th className="p-1.5">القسم</th>
                        <th className="p-1.5">الوحدة</th>
                        <th className="p-1.5">الكمية</th>
                        <th className="p-1.5">سعر الوحدة</th>
                        <th className="p-1.5">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l: any, idx: number) => {
                        const kindLabel: any = { raw: "خامات", spice: "بهارات", packaging: "تغليف" };
                        return (
                          <tr key={idx} className="border-b">
                            <td className="p-1.5">{l.raw_item_name || "—"}</td>
                            <td className="p-1.5 text-center">{kindLabel[l.kind] || l.kind}</td>
                            <td className="p-1.5 text-center">{l.unit}</td>
                            <td className="p-1.5 text-center tabular-nums">{fmtNum(l.quantity, 3)}</td>
                            <td className="p-1.5 text-center tabular-nums">{fmtNum(l.unit_price)}</td>
                            <td className="p-1.5 text-center tabular-nums font-semibold">{fmtMoney(l.line_total)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Totals breakdown */}
              {lines && lines.length > 0 && (() => {
                const sum = (k: string) => lines.filter((l: any) => l.kind === k).reduce((s: number, l: any) => s + Number(l.line_total || 0), 0);
                const raw = sum("raw"), spice = sum("spice"), pack = sum("packaging");
                const total = raw + spice + pack;
                return (
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div className="rounded border bg-muted/30 p-2"><div className="text-muted-foreground">إجمالي الخامات</div><div className="font-bold tabular-nums">{fmtMoney(raw)}</div></div>
                    <div className="rounded border bg-muted/30 p-2"><div className="text-muted-foreground">إجمالي البهارات</div><div className="font-bold tabular-nums">{fmtMoney(spice)}</div></div>
                    <div className="rounded border bg-muted/30 p-2"><div className="text-muted-foreground">إجمالي التغليف</div><div className="font-bold tabular-nums">{fmtMoney(pack)}</div></div>
                    <div className="rounded border bg-primary/10 border-primary/30 p-2"><div className="text-muted-foreground">الإجمالي النهائي</div><div className="font-bold tabular-nums text-primary">{fmtMoney(r.total_amount || total)}</div></div>
                  </div>
                );
              })()}
            </div>
          )}

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

              {r._source_table === "meat_manufacturing_invoices" && (() => {
                const svc = parseServiceCostsFromNotes(r.notes);
                const svcTotal = svc.reduce((s, x) => s + Number(x.total || 0), 0);
                const residual = Math.max(0, Number(r.extra_cost || 0) - svcTotal);
                const effectiveExtra = Math.max(Number(r.extra_cost || 0), svcTotal);
                if (svc.length === 0 && residual === 0) return null;
                return (
                  <>
                    <div className="font-semibold text-sm mt-3 mb-2 text-primary">المواد الخدمية / التكاليف الإضافية</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="p-1.5 text-right">اسم البند</th>
                            <th className="p-1.5">النوع</th>
                            <th className="p-1.5">الكمية</th>
                            <th className="p-1.5">الوحدة</th>
                            <th className="p-1.5">سعر الوحدة</th>
                            <th className="p-1.5">الإجمالي</th>
                          </tr>
                        </thead>
                        <tbody>
                          {svc.map((x, idx) => (
                            <tr key={idx} className="border-b">
                              <td className="p-1.5">{x.name || "مادة خدمية"}</td>
                              <td className="p-1.5 text-center">تكلفة تشغيل</td>
                              <td className="p-1.5 text-center tabular-nums">{x.quantity != null ? fmtNum(x.quantity, 3) : "—"}</td>
                              <td className="p-1.5 text-center">{x.unit || "—"}</td>
                              <td className="p-1.5 text-center tabular-nums">{x.unit_cost != null ? fmtNum(x.unit_cost) : "—"}</td>
                              <td className="p-1.5 text-center tabular-nums font-semibold">{x.total != null ? fmtMoney(x.total) : "—"}</td>
                            </tr>
                          ))}
                          {residual > 0 && (
                            <tr className="border-b">
                              <td className="p-1.5">تكلفة إضافية</td>
                              <td className="p-1.5 text-center">تكلفة تشغيل</td>
                              <td className="p-1.5 text-center">—</td>
                              <td className="p-1.5 text-center">—</td>
                              <td className="p-1.5 text-center">—</td>
                              <td className="p-1.5 text-center tabular-nums font-semibold">{fmtMoney(residual)}</td>
                            </tr>
                          )}
                          <tr>
                            <td colSpan={5} className="p-1.5 text-end font-semibold">إجمالي المواد الخدمية</td>
                            <td className="p-1.5 text-center tabular-nums font-bold text-primary">{fmtMoney(r.extra_cost)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>

        <DialogFooter className="border-t pt-3 gap-2">
          {item.category === "mf_purchase" && r._kind === "meat_factory_purchase" && (
            <Button variant="outline" onClick={() => {
              const kindLabel: any = { raw: "خامات", spice: "بهارات", packaging: "تغليف", mixed: "mixed" };
              const payLabel: any = { cash: "نقدي", credit: "آجل", transfer: "تحويل", other: "أخرى" };
              const rowsHtml = (lines || []).map((l: any) => `
                <tr>
                  <td>${l.raw_item_name || "—"}</td>
                  <td style="text-align:center">${({raw:"خامات",spice:"بهارات",packaging:"تغليف"} as any)[l.kind] || l.kind}</td>
                  <td style="text-align:center">${l.unit || ""}</td>
                  <td style="text-align:center">${fmtNum(l.quantity, 3)}</td>
                  <td style="text-align:center">${fmtNum(l.unit_price)}</td>
                  <td style="text-align:center"><b>${fmtMoney(l.line_total)}</b></td>
                </tr>`).join("");
              const sum = (k: string) => (lines || []).filter((l: any) => l.kind === k).reduce((s: number, l: any) => s + Number(l.line_total || 0), 0);
              const body = `
                <h1 style="text-align:center;margin:0">شركة نعام العاصمة</h1>
                <h2 style="text-align:center;margin:4px 0 16px;color:#666">فاتورة مشتريات مصنع اللحوم</h2>
                <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
                  <tr><td><b>رقم الفاتورة:</b> ${r.invoice_no || "— لم تُعتمد —"}</td><td><b>التاريخ:</b> ${r.purchase_date || "—"}</td></tr>
                  <tr><td><b>المورد:</b> ${r.supplier || "—"}</td><td><b>نوع الفاتورة:</b> ${kindLabel[r.invoice_type] || r.invoice_type || "—"}</td></tr>
                  <tr><td><b>طريقة الدفع:</b> ${payLabel[r.payment_method] || r.payment_method || "—"}</td><td><b>رقم الإيصال:</b> ${r.receipt_no || "—"}</td></tr>
                  <tr><td><b>المسجِّل:</b> ${item.creator_name || "—"}</td><td><b>تاريخ التسجيل:</b> ${fmtDateTime(item.created_at)}</td></tr>
                  <tr><td colspan="2"><b>الحالة:</b> ${r.invoice_no ? "معتمدة" : "في انتظار الاعتماد"}</td></tr>
                </table>
                <table style="width:100%;border-collapse:collapse;border:1px solid #999">
                  <thead><tr style="background:#f3f4f6">
                    <th style="border:1px solid #999;padding:6px">الصنف</th>
                    <th style="border:1px solid #999;padding:6px">القسم</th>
                    <th style="border:1px solid #999;padding:6px">الوحدة</th>
                    <th style="border:1px solid #999;padding:6px">الكمية</th>
                    <th style="border:1px solid #999;padding:6px">سعر الوحدة</th>
                    <th style="border:1px solid #999;padding:6px">الإجمالي</th>
                  </tr></thead>
                  <tbody>${rowsHtml || `<tr><td colspan="6" style="padding:8px;text-align:center;color:#888">لا توجد بنود</td></tr>`}</tbody>
                </table>
                <table style="width:100%;border-collapse:collapse;margin-top:12px">
                  <tr><td><b>إجمالي الخامات:</b> ${fmtMoney(sum("raw"))}</td><td><b>إجمالي البهارات:</b> ${fmtMoney(sum("spice"))}</td></tr>
                  <tr><td><b>إجمالي التغليف:</b> ${fmtMoney(sum("packaging"))}</td><td style="font-size:14px"><b>الإجمالي النهائي:</b> <span style="color:#7c3aed;font-weight:bold">${fmtMoney(r.total_amount)}</span></td></tr>
                </table>
                ${r.notes ? `<div style="margin-top:12px;padding:8px;background:#fffbeb;border:1px solid #fde68a"><b>ملاحظات:</b> ${r.notes}</div>` : ""}
                <div style="margin-top:30px;display:flex;justify-content:space-between">
                  <div>المسجِّل: ${item.creator_name || "—"}<br/><br/>التوقيع: ____________</div>
                  <div>اعتماد المدير: ____________<br/><br/>التوقيع: ____________</div>
                </div>`;
              openPrintWindow(`فاتورة مشتريات مصنع اللحوم - ${r.invoice_no || r.id?.slice(0,8) || ""}`, body);
            }}>
              <Printer className="h-4 w-4 ml-1" />طباعة
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
