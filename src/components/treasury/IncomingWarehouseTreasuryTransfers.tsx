import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Warehouse, CheckCircle2, XCircle, Loader2, Printer } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface Row {
  id: string;
  amount: number;
  reference: string | null;
  notes: string | null;
  courier_name: string | null;
  performed_by: string | null;
  performed_at: string;
  status: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

export default function IncomingWarehouseTreasuryTransfers({ onReceived }: { onReceived?: () => void }) {
  const { roles, isGeneralManager, isExecutiveManager } = useAuth();
  const rs = (roles || []) as string[];
  const canApprove =
    isGeneralManager ||
    isExecutiveManager ||
    rs.includes("financial_manager") ||
    rs.includes("main_treasury_approver") ||
    rs.includes("main_treasury_accountant");

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [names, setNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("main_warehouse_treasury_txns")
      .select("id, amount, reference, notes, courier_name, performed_by, performed_at, status")
      .eq("category", "transfer_from_main_warehouse_treasury")
      .eq("direction", "out")
      .eq("status", "pending_approval")
      .order("performed_at", { ascending: false });
    if (error) {
      console.error("MWT load error", error);
      toast.error(error.message || "تعذر تحميل تحويلات المخزن الرئيسي");
      setLoading(false);
      return;
    }
    const list = (data || []) as Row[];
    setRows(list);
    const ids = Array.from(new Set(list.map((r) => r.performed_by).filter(Boolean))) as string[];
    if (ids.length) {
      const { data: profs } = await (supabase as any)
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      const map: Record<string, string> = {};
      (profs || []).forEach((p: any) => { map[p.id] = p.full_name || ""; });
      setNames(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (r: Row) => {
    if (!canApprove) return;
    if (!window.confirm(`اعتماد تحويل بمبلغ ${fmt(r.amount)} ج.م؟ سيُضاف للخزينة الرئيسية.`)) return;
    setBusy(r.id);
    const { error } = await (supabase as any).rpc("approve_main_warehouse_transfer", { _txn_id: r.id });
    setBusy(null);
    if (error) {
      toast.error(error.message || "تعذر الاعتماد");
      return;
    }
    toast.success("تم اعتماد التحويل وإضافته للخزينة الرئيسية");
    load();
    onReceived?.();
  };

  const reject = async (r: Row) => {
    if (!canApprove) return;
    const reason = window.prompt("سبب الرفض:", "") || "";
    if (!reason.trim()) {
      toast.error("أدخل سبب الرفض");
      return;
    }
    setBusy(r.id);
    const { error } = await (supabase as any).rpc("reject_main_warehouse_transfer", {
      _txn_id: r.id,
      _reason: reason,
    });
    setBusy(null);
    if (error) {
      toast.error(error.message || "تعذر الرفض");
      return;
    }
    toast.success("تم رفض التحويل");
    load();
    onReceived?.();
  };

  const printTransfer = async (r: Row) => {
    const w = window.open("", "_blank", "width=1000,height=1100");
    if (!w) return;
    w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/><title>جاري التحميل...</title></head><body style="font-family:Cairo,Tahoma,sans-serif;padding:24px;text-align:center">جاري تحميل تفاصيل الأوردرات...</body></html>`);
    const performedBy = (r.performed_by && names[r.performed_by]) || "—";
    const dayStr = new Date(r.performed_at).toLocaleDateString("ar-EG", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

    const notes = r.notes || "";
    // Primary source: deposits linked to this transfer (authoritative).
    // Fallback: parse ORD-... numbers from the notes text.
    let orderNumbers: string[] = [];
    let linkedDeposits: Array<{ deposit_date: string; courier_name: string | null; amount: number; orders_count: number; order_numbers: string[] | null }> = [];
    try {
      const { data: deps } = await (supabase as any)
        .from("courier_daily_cash_deposits")
        .select("deposit_date, courier_name, amount, orders_count, order_numbers")
        .eq("transferred_txn_id", r.id)
        .order("deposit_date", { ascending: false });
      linkedDeposits = (deps || []) as any;
      linkedDeposits.forEach((d) => {
        (d.order_numbers || []).forEach((n) => { if (n) orderNumbers.push(n); });
      });
    } catch { /* ignore */ }
    if (orderNumbers.length === 0) {
      orderNumbers = (notes.match(/ORD-\d+-\d+/g) || []) as string[];
    }
    orderNumbers = Array.from(new Set(orderNumbers));

    type OrderRow = {
      id: string; order_number: string; total: number | null; courier_cash_due: number | null;
      collection_method: string | null; customer_id: string | null; status: string | null;
      vodafone_cash_amount: number | null; instapay_amount: number | null; bank_transfer_amount: number | null;
    };
    type ItemRow = { order_id: string; product_name: string | null; offer_name: string | null; quantity: number | null; unit_price: number | null; total_price: number | null; is_gift: boolean | null; is_half_kg: boolean | null; };

    let orders: OrderRow[] = [];
    let itemsByOrder: Record<string, ItemRow[]> = {};
    let customerMap: Record<string, string> = {};

    if (orderNumbers.length) {
      const { data: ords } = await (supabase as any)
        .from("orders")
        .select("id,order_number,total,courier_cash_due,collection_method,customer_id,status,vodafone_cash_amount,instapay_amount,bank_transfer_amount")
        .in("order_number", orderNumbers);
      orders = (ords || []) as OrderRow[];

      const oids = orders.map((o) => o.id);
      if (oids.length) {
        const { data: its } = await (supabase as any)
          .from("order_items")
          .select("order_id,product_name,offer_name,quantity,unit_price,total_price,is_gift,is_half_kg")
          .in("order_id", oids);
        (its || []).forEach((it: ItemRow) => {
          (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(it);
        });
      }

      const cids = Array.from(new Set(orders.map((o) => o.customer_id).filter(Boolean))) as string[];
      if (cids.length) {
        const { data: custs } = await (supabase as any).from("customers").select("id,name").in("id", cids);
        (custs || []).forEach((c: any) => { customerMap[c.id] = c.name || ""; });
      }
    }

    const cmLabel = (m: string | null) => ({
      cash_with_courier: "كاش مع المندوب", vodafone_cash: "فودافون كاش", instapay: "إنستاباي",
      bank_transfer: "تحويل بنكي", mixed: "مختلط", prepaid: "مدفوع مسبقًا", free: "مجاني", none: "لا يوجد",
    } as any)[m || ""] || m || "—";

    const statusLabel = (s: string | null) => ({
      delivered: "تم التسليم للعميل", pending: "قيد الانتظار", processing: "قيد التنفيذ",
      shipped: "تم الشحن", cancelled: "ملغي", returned: "مرتجع",
    } as any)[s || ""] || s || "—";

    // Ordered by orderNumbers order
    const orderedOrders = orderNumbers
      .map((n) => orders.find((o) => o.order_number === n))
      .filter(Boolean) as OrderRow[];

    const mixedCount = orderedOrders.filter((o) => o.collection_method === "mixed").length;
    const freeCount = orderedOrders.filter((o) => o.collection_method === "free").length;

    const orderBlocks = orderedOrders.map((o, idx) => {
      const items = itemsByOrder[o.id] || [];
      const customer = (o.customer_id && customerMap[o.customer_id]) || "—";
      const itemsRows = items.length
        ? items.map((it) => `<tr>
            <td>${(it.product_name || "—")}${it.offer_name ? ` <span class="muted">(${it.offer_name})</span>` : ""}${it.is_gift ? ' <span style="color:#059669">🎁</span>' : ""}${it.is_half_kg ? ' <span class="muted">½ك</span>' : ""}</td>
            <td class="num">${Number(it.quantity || 0)}</td>
            <td class="num">${fmt(Number(it.unit_price || 0))}</td>
            <td class="num strong">${fmt(Number(it.total_price || 0))}</td>
          </tr>`).join("")
        : `<tr><td colspan="4" style="text-align:center;color:#888">لا توجد أصناف</td></tr>`;

      const paymentBadges: string[] = [];
      if (Number(o.vodafone_cash_amount || 0) > 0) paymentBadges.push(`📱 فودافون: ${fmt(Number(o.vodafone_cash_amount))}`);
      if (Number(o.instapay_amount || 0) > 0) paymentBadges.push(`💳 إنستاباي: ${fmt(Number(o.instapay_amount))}`);
      if (Number(o.bank_transfer_amount || 0) > 0) paymentBadges.push(`🏦 تحويل: ${fmt(Number(o.bank_transfer_amount))}`);

      return `<section class="order">
        <div class="order-head">
          <span class="badge">#${idx + 1}</span>
          <b>${o.order_number}</b>
          <span class="muted">—</span>
          <span>${customer}</span>
          <span class="status">${statusLabel(o.status)}</span>
        </div>
        <div class="order-sub">
          <span>إجمالي الأوردر: <b>${fmt(Number(o.total || 0))}</b></span>
          <span class="cash">💵 نقدي مطلوب من ${r.courier_name || "المندوب"}: <b>${fmt(Number(o.courier_cash_due || 0))}</b></span>
          ${paymentBadges.map((b) => `<span class="pay">${b}</span>`).join("")}
          <span class="muted">طريقة التحصيل: ${cmLabel(o.collection_method)}</span>
        </div>
        <table>
          <thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>إجمالي الصنف</th></tr></thead>
          <tbody>${itemsRows}</tbody>
        </table>
      </section>`;
    }).join("");

    const missing = orderNumbers.filter((n) => !orders.find((o) => o.order_number === n));
    const totalCash = orderedOrders.reduce((s, o) => s + Number(o.courier_cash_due || 0), 0);

    const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/>
<title>تفاصيل التوريد ${r.reference || ""}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'Cairo','Tahoma',sans-serif;padding:20px;color:#111;background:#fff;}
  .top{display:flex;justify-content:center;gap:10px;margin-bottom:16px;}
  .top button{padding:8px 18px;border:1px solid #ccc;background:#fff;border-radius:8px;cursor:pointer;font-family:inherit;font-size:13px;}
  .header{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:13px;border-bottom:1px solid #eee;padding-bottom:10px;margin-bottom:14px;}
  .header .item{background:#f9fafb;padding:4px 10px;border-radius:6px;}
  .muted{color:#666;font-size:11px;}
  .order{border:1px solid #eee;border-radius:8px;padding:12px;margin-bottom:14px;page-break-inside:avoid;}
  .order-head{display:flex;align-items:center;gap:8px;font-size:14px;margin-bottom:6px;flex-wrap:wrap;}
  .badge{background:#7c3aed;color:#fff;padding:2px 8px;border-radius:6px;font-size:12px;}
  .status{color:#059669;font-size:12px;margin-inline-start:auto;}
  .order-sub{display:flex;flex-wrap:wrap;gap:10px;font-size:12px;margin-bottom:8px;padding:6px 8px;background:#fafafa;border-radius:6px;}
  .cash{background:#d1fae5;padding:2px 8px;border-radius:4px;}
  .pay{background:#dbeafe;padding:2px 8px;border-radius:4px;}
  table{width:100%;border-collapse:collapse;margin-top:6px;font-size:12px;}
  th,td{border:1px solid #e5e7eb;padding:5px 8px;text-align:right;}
  th{background:#faf5ff;color:#6b21a8;font-weight:700;}
  td.num{font-family:monospace;text-align:center;} td.strong{font-weight:700;}
  .footer{text-align:center;color:#666;font-size:11px;margin-top:20px;padding-top:10px;border-top:1px solid #eee;}
  .grand{background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:14px;display:flex;justify-content:space-between;}
  @media print{.top{display:none;}}
</style></head><body>
<div class="top">
  <button onclick="window.print()">طباعة / حفظ كـ PDF</button>
  <button onclick="window.close()">إغلاق</button>
</div>
<div class="header">
  <span class="item">المندوب: <b>${r.courier_name || (linkedDeposits[0]?.courier_name) || "—"}</b></span>
  <span class="item">اليوم: <b>${linkedDeposits[0]?.deposit_date ? new Date(linkedDeposits[0].deposit_date).toLocaleDateString("ar-EG", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : dayStr}</b></span>
  <span class="item">عدد الأوردرات: <b>${orderedOrders.length}</b></span>
  <span class="item">مجاني: <b>${freeCount}</b></span>
  <span class="item">مختلط: <b>${mixedCount}</b></span>
  <span class="item">بواسطة: <b>${performedBy}</b></span>
  <span class="item">المرجع: <b>${r.reference || "—"}</b></span>
</div>
<div class="grand">
  <span>إجمالي التوريد</span>
  <b style="color:#059669">${fmt(Number(r.amount || 0))} ج.م</b>
  <span class="muted">مجموع النقدي على المندوب من الأوردرات: ${fmt(totalCash)}</span>
</div>
${orderBlocks || '<div class="muted" style="text-align:center;padding:20px">لا توجد أوردرات</div>'}
${missing.length ? `<div class="muted" style="color:#b91c1c;text-align:center;margin-top:10px">أوردرات غير موجودة: ${missing.join(", ")}</div>` : ""}
<div class="footer">شركة نعم العاصمة — Na'am Al-Asimah • Capital Ostrich</div>
</body></html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  if (loading) {
    return (
      <Card className="border-sky-300 bg-sky-50/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Warehouse className="w-4 h-4" /> تحويلات واردة من خزينة المخزن الرئيسي
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">جاري التحميل...</CardContent>
      </Card>
    );
  }

  if (rows.length === 0) return null;

  return (
    <Card className="border-sky-300 bg-sky-50/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Warehouse className="w-4 h-4 text-sky-700" />
          تحويلات واردة من خزينة المخزن الرئيسي
          <Badge className="bg-amber-500 text-white">{rows.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border bg-white p-3 space-y-2">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className="bg-emerald-600 text-white">{fmt(Number(r.amount || 0))} ج.م</Badge>
                  {r.courier_name && (
                    <Badge variant="outline" className="text-xs">المندوب: {r.courier_name}</Badge>
                  )}
                  {r.reference && <span className="text-xs text-muted-foreground">{r.reference}</span>}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  بواسطة: <b>{(r.performed_by && names[r.performed_by]) || "—"}</b> •{" "}
                  {new Date(r.performed_at).toLocaleString("ar-EG")}
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => printTransfer(r)}
                >
                  <Printer className="w-4 h-4 ml-1" /> طباعة
                </Button>
                {canApprove && (
                  <>
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      disabled={busy === r.id}
                      onClick={() => approve(r)}
                    >
                      {busy === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 ml-1" />}
                      اعتماد
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-rose-700 border-rose-300 hover:bg-rose-50"
                      disabled={busy === r.id}
                      onClick={() => reject(r)}
                    >
                      <XCircle className="w-4 h-4 ml-1" /> رفض
                    </Button>
                  </>
                )}
              </div>
            </div>
            {r.notes && (
              <pre className="whitespace-pre-wrap text-xs bg-muted/40 rounded p-2 font-sans leading-relaxed">
                {r.notes}
              </pre>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
