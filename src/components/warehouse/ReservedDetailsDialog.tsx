import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Lock, Search, Loader2, CheckCircle2, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  totalReservedKg: number;
}

interface Row {
  order_id: string;
  order_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  fulfillment_type: string | null;
  shipping_company: string | null;
  quantity: number;
  created_at: string;
  created_by_name: string | null;
  moderator: string | null;
  status: string;
  delivered_at: string | null;
  notes: string | null;
}

const fulfillmentLabel = (o: Row): string => {
  if (o.fulfillment_type === "pickup") return "استلام من المخزن";
  if (o.fulfillment_type === "delivery") {
    if (o.shipping_company === "مندوب خاص") return "مندوب خاص";
    if (o.shipping_company) return `شحن — ${o.shipping_company}`;
    return "توصيل";
  }
  return o.fulfillment_type || "—";
};

const statusLabel = (s: string) => ({
  pending: "قيد المراجعة",
  confirmed: "مؤكد",
  preparing: "قيد التجهيز",
  ready: "جاهز",
  shipped: "تم الشحن",
  delivered: "تم التسليم",
  cancelled: "ملغي",
} as Record<string, string>)[s] || s;

export default function ReservedDetailsDialog({ open, onOpenChange, warehouseId, warehouseName, productId, productName, totalReservedKg }: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [fType, setFType] = useState<string>("all");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: orders } = await supabase
          .from("orders")
          .select("id, order_number, status, stock_status, source_warehouse_id, customer_id, fulfillment_type, shipping_company, created_at, created_by, moderator, notes, delivered_at")
          .eq("source_warehouse_id", warehouseId)
          .not("status", "in", "(delivered,cancelled)")
          .or("stock_status.is.null,stock_status.neq.dispatched");

        const list = orders || [];
        if (list.length === 0) { if (!cancelled) setRows([]); return; }

        const orderIds = list.map((o: any) => o.id);
        const customerIds = Array.from(new Set(list.map((o: any) => o.customer_id).filter(Boolean)));
        const userIds = Array.from(new Set(list.map((o: any) => o.created_by).filter(Boolean)));

        const [itemsRes, custRes, profRes] = await Promise.all([
          (async () => {
            const all: any[] = [];
            for (let i = 0; i < orderIds.length; i += 500) {
              const slice = orderIds.slice(i, i + 500);
              const { data } = await supabase
                .from("order_items")
                .select("order_id, product_id, quantity")
                .in("order_id", slice)
                .eq("product_id", productId);
              all.push(...(data || []));
            }
            return all;
          })(),
          customerIds.length
            ? supabase.from("customers").select("id, name, phone").in("id", customerIds as string[])
            : Promise.resolve({ data: [] as any[] }),
          userIds.length
            ? supabase.from("profiles").select("id, full_name").in("id", userIds as string[])
            : Promise.resolve({ data: [] as any[] }),
        ]);

        const qtyByOrder: Record<string, number> = {};
        (itemsRes || []).forEach((it: any) => {
          qtyByOrder[it.order_id] = (qtyByOrder[it.order_id] || 0) + Number(it.quantity || 0);
        });
        const custMap = Object.fromEntries(((custRes as any).data || []).map((c: any) => [c.id, c]));
        const profMap = Object.fromEntries(((profRes as any).data || []).map((p: any) => [p.id, p]));

        const out: Row[] = list
          .filter((o: any) => qtyByOrder[o.id] > 0)
          .map((o: any) => {
            const c = custMap[o.customer_id] || {};
            const p = profMap[o.created_by] || {};
            return {
              order_id: o.id,
              order_number: o.order_number,
              customer_name: c.name ?? null,
              customer_phone: c.phone ?? null,
              fulfillment_type: o.fulfillment_type,
              shipping_company: o.shipping_company,
              quantity: qtyByOrder[o.id],
              created_at: o.created_at,
              created_by_name: p.full_name ?? null,
              moderator: o.moderator ?? null,
              status: o.status,
              delivered_at: o.delivered_at,
              notes: o.notes,
            } as Row;
          })
          .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

        if (!cancelled) setRows(out);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, warehouseId, productId]);

  const filtered = useMemo(() => {
    const q = search.trim();
    return rows.filter((r) => {
      if (fType !== "all") {
        if (fType === "pickup" && r.fulfillment_type !== "pickup") return false;
        if (fType === "private" && !(r.fulfillment_type === "delivery" && r.shipping_company === "مندوب خاص")) return false;
        if (fType === "shipping" && !(r.fulfillment_type === "delivery" && r.shipping_company && r.shipping_company !== "مندوب خاص")) return false;
      }
      if (!q) return true;
      return (
        r.order_number?.includes(q) ||
        r.customer_name?.includes(q) ||
        r.customer_phone?.includes(q) ||
        r.moderator?.includes(q) ||
        r.created_by_name?.includes(q)
      );
    });
  }, [rows, search, fType]);

  const totalShownKg = filtered.reduce((s, r) => s + r.quantity, 0);

  const ftBtn = (val: string, label: string) => (
    <button
      onClick={() => setFType(val)}
      className={`px-2.5 h-7 text-xs rounded-md border transition ${fType === val ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}
    >{label}</button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-orange-600" />
            تفاصيل المحجوز — {productName}
          </DialogTitle>
          <DialogDescription>
            {warehouseName} • إجمالي المحجوز {totalReservedKg} كجم
            {totalShownKg !== totalReservedKg && filtered.length !== rows.length && (
              <span className="text-muted-foreground"> • المعروض بعد الفلتر {Math.round(totalShownKg * 100) / 100} كجم</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 py-2 border-b">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="بحث: رقم الأوردر / اسم العميل / تليفون / مودريتور..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9 h-8"
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {ftBtn("all", "الكل")}
            {ftBtn("pickup", "استلام عميل")}
            {ftBtn("private", "مندوب خاص")}
            {ftBtn("shipping", "شركة شحن")}
          </div>
        </div>

        <div className="overflow-auto flex-1 -mx-6 px-6">
          {loading ? (
            <div className="py-12 flex justify-center items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> جاري التحميل...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              لا توجد طلبات حاجزة لهذا الصنف
            </div>
          ) : (
            <table className="w-full text-right text-xs mt-2">
              <thead className="bg-muted/60 text-[11px] sticky top-0">
                <tr>
                  <th className="p-2 font-semibold">الأوردر</th>
                  <th className="p-2 font-semibold">العميل</th>
                  <th className="p-2 font-semibold">التليفون</th>
                  <th className="p-2 font-semibold">نوع التسليم</th>
                  <th className="p-2 font-semibold">الكمية</th>
                  <th className="p-2 font-semibold">التاريخ</th>
                  <th className="p-2 font-semibold">المودريتور / المُسجِّل</th>
                  <th className="p-2 font-semibold">الحالة</th>
                  <th className="p-2 font-semibold">ملاحظات</th>
                  <th className="p-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.order_id} className="border-t hover:bg-muted/30">
                    <td className="p-2 font-semibold">{r.order_number}</td>
                    <td className="p-2">{r.customer_name || "—"}</td>
                    <td className="p-2 ltr text-left">{r.customer_phone || "—"}</td>
                    <td className="p-2">
                      <Badge variant="outline" className="font-normal">{fulfillmentLabel(r)}</Badge>
                    </td>
                    <td className="p-2">
                      <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30 hover:bg-orange-500/15">
                        {r.quantity} كجم
                      </Badge>
                    </td>
                    <td className="p-2 text-muted-foreground whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="p-2">{r.moderator || r.created_by_name || "—"}</td>
                    <td className="p-2">
                      <div className="flex items-center gap-1">
                        {r.delivered_at ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 text-orange-500" />
                        )}
                        <span>{statusLabel(r.status)}</span>
                      </div>
                    </td>
                    <td className="p-2 max-w-[180px] truncate text-muted-foreground" title={r.notes || ""}>{r.notes || "—"}</td>
                    <td className="p-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => { onOpenChange(false); navigate(`/orders/${r.order_id}`); }}
                        title="فتح الأوردر"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="border-t pt-2 text-[11px] text-muted-foreground">
          عرض فقط — لا يقوم بأي خصم أو حجز إضافي. مجموع الكميات = القيمة الموجودة في عمود "المحجوز" لهذا الصنف.
        </div>
      </DialogContent>
    </Dialog>
  );
}
