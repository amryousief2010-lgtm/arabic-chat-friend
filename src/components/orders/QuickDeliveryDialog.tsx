import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Search, Zap } from "lucide-react";
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

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orders: QDOrder[];
  onDeliver: (orderId: string) => void | Promise<void>;
  statusLabels: Record<string, string>;
  canMarkDelivered: boolean;
}

const QuickDeliveryDialog = ({ open, onOpenChange, orders, onDeliver, statusLabels, canMarkDelivered }: Props) => {
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const digits = q.replace(/[^\d]/g, "");
    return orders
      .filter((o) => o.status !== "delivered" && o.status !== "cancelled")
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

  const handleDeliver = async (id: string) => {
    setBusyId(id);
    try {
      await onDeliver(id);
      setQuery("");
    } finally {
      setBusyId(null);
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
            ابحث برقم الأوردر / آخر 6 أرقام / اسم العميل / رقم الهاتف ثم اضغط "تم التسليم للعميل".
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

        <div className="max-h-[420px] overflow-y-auto space-y-2 mt-2">
          {query.trim() === "" ? (
            <p className="text-center text-muted-foreground py-8 text-sm">
              اكتب في خانة البحث لعرض النتائج
            </p>
          ) : results.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">
              لا توجد أوردرات مطابقة (يتم استبعاد المسلَّم والملغي)
            </p>
          ) : (
            results.map((o) => (
              <div
                key={o.id}
                className="border rounded-lg p-3 flex items-center justify-between gap-3 hover:bg-muted/40 transition"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                      {o.order_number}
                    </span>
                    <span className="font-semibold">{o.customer_name}</span>
                    <Badge variant="outline">{statusLabels[o.status] || o.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {o.customer_phone && <span>📞 {o.customer_phone}</span>}
                    <span>💰 {Number(o.total).toLocaleString()} ج</span>
                    <span>📅 {formatDate(o.created_at)}</span>
                    {o.source_warehouse_name && <span>🏪 {o.source_warehouse_name}</span>}
                    {o.shipping_company && <span>🚚 {o.shipping_company}</span>}
                    {o.moderator_name && <span>👤 {o.moderator_name}</span>}
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={busyId === o.id}
                  onClick={() => handleDeliver(o.id)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 shrink-0"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {busyId === o.id ? "..." : "تم التسليم للعميل"}
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default QuickDeliveryDialog;
