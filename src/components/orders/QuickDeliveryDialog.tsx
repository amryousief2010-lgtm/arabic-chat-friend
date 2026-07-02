import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, Truck, Undo2, Search, Zap } from "lucide-react";
import { formatDate } from "@/lib/dateFormat";

interface QDOrder {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone?: string | null;
  status: string;
  total: number;
  created_at: string;
  source_warehouse_name?: string | null;
  shipping_company?: string | null;
  moderator_name?: string | null;
}

type QuickStatus = "delivered" | "pending" | "shipped" | "cancelled";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orders: QDOrder[];
  onUpdateStatus: (orderId: string, status: QuickStatus) => void | Promise<void>;
  statusLabels: Record<string, string>;
  canMarkDelivered: boolean;
}

const STATUS_BUTTONS: {
  key: QuickStatus;
  label: string;
  icon: typeof CheckCircle2;
  className: string;
  requireConfirm?: boolean;
  confirmMessage?: string;
  needsDeliverPerm?: boolean;
}[] = [
  {
    key: "delivered",
    label: "تم التسليم للعميل",
    icon: CheckCircle2,
    className: "bg-emerald-600 hover:bg-emerald-700 text-white",
    needsDeliverPerm: true,
  },
  {
    key: "shipped",
    label: "تم التوصيل",
    icon: Truck,
    className: "bg-sky-600 hover:bg-sky-700 text-white",
  },
  {
    key: "pending",
    label: "قيد الانتظار",
    icon: Clock,
    className: "bg-amber-500 hover:bg-amber-600 text-white",
  },
  {
    key: "cancelled",
    label: "مرتجع / ملغي",
    icon: Undo2,
    className: "bg-rose-600 hover:bg-rose-700 text-white",
    requireConfirm: true,
    confirmMessage: 'هل أنت متأكد من تحديث حالة هذا الأوردر إلى "مرتجع / ملغي"؟',
  },
];

const QuickDeliveryDialog = ({
  open,
  onOpenChange,
  orders,
  onUpdateStatus,
  statusLabels,
  canMarkDelivered,
}: Props) => {
  const [query, setQuery] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const digits = q.replace(/[^\d]/g, "");
    return orders
      .filter((o) => {
        const num = (o.order_number || "").toLowerCase();
        const name = (o.customer_name || "").toLowerCase();
        const phone = (o.customer_phone || "").replace(/[^\d]/g, "");
        return (
          num.includes(q) ||
          name.includes(q) ||
          (digits.length >= 3 && (num.includes(digits) || phone.includes(digits)))
        );
      })
      .slice(0, 20);
  }, [query, orders]);

  const handleUpdate = async (order: QDOrder, target: (typeof STATUS_BUTTONS)[number]) => {
    if (order.status === target.key) return;
    if (target.requireConfirm && !window.confirm(target.confirmMessage || "تأكيد التحديث؟")) return;
    const busy = `${order.id}:${target.key}`;
    setBusyKey(busy);
    try {
      await onUpdateStatus(order.id, target.key);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-emerald-600" />
            تحديث سريع للتسليم
          </DialogTitle>
          <DialogDescription>
            ابحث برقم الأوردر / آخر 6 أرقام / اسم العميل / رقم الهاتف ثم اختر الحالة الجديدة.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 right-3 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="مثال: 222519 أو ORD-... أو اسم العميل أو رقم الهاتف"
            className="pr-9 h-11 text-base"
          />
        </div>

        {!canMarkDelivered && (
          <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-xs p-2 mt-2">
            تحديث حالة الأوردر من صلاحيات التسويق فقط. يمكنك ضبط التحصيل بعد التسليم من تفاصيل الأوردر.
          </div>
        )}

        <div className="max-h-[460px] overflow-y-auto space-y-2 mt-2">
          {query.trim() === "" ? (
            <p className="text-center text-muted-foreground py-8 text-sm">
              اكتب في خانة البحث لعرض النتائج
            </p>
          ) : results.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">
              لا توجد أوردرات مطابقة
            </p>
          ) : (
            results.map((o) => (
              <div
                key={o.id}
                className="border rounded-lg p-3 hover:bg-muted/40 transition space-y-2"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                    {o.order_number}
                  </span>
                  <span className="font-semibold">{o.customer_name}</span>
                  <Badge variant="outline">{statusLabels[o.status] || o.status}</Badge>
                </div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                  {o.customer_phone && <span>📞 {o.customer_phone}</span>}
                  <span>💰 {Number(o.total).toLocaleString()} ج</span>
                  <span>📅 {formatDate(o.created_at)}</span>
                  {o.source_warehouse_name && <span>🏪 {o.source_warehouse_name}</span>}
                  {o.shipping_company && <span>🚚 {o.shipping_company}</span>}
                  {o.moderator_name && <span>👤 {o.moderator_name}</span>}
                </div>
                {canMarkDelivered ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {STATUS_BUTTONS.map((b) => {
                      const Icon = b.icon;
                      const disabledPerm = b.needsDeliverPerm && !canMarkDelivered;
                      const isCurrent = o.status === b.key;
                      const busy = busyKey === `${o.id}:${b.key}`;
                      return (
                        <Button
                          key={b.key}
                          size="sm"
                          disabled={busy || disabledPerm || isCurrent}
                          onClick={() => handleUpdate(o, b)}
                          className={`${b.className} gap-1 disabled:opacity-50`}
                          title={isCurrent ? "الحالة الحالية" : undefined}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {busy ? "..." : b.label}
                        </Button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground pt-1">
                    تحديث الحالة غير متاح لدورك من هذه النافذة.
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default QuickDeliveryDialog;
