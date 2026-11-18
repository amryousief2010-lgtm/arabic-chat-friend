import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { productDbErrorMessage, type ProductReadiness } from "@/lib/productGate";

interface Props {
  product: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onActivated: () => void;
}

const Row = ({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) => (
  <li className="flex items-start gap-2 text-sm">
    {ok ? (
      <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
    ) : (
      <XCircle className="w-4 h-4 mt-0.5 text-destructive shrink-0" />
    )}
    <div>
      <span className={ok ? "" : "text-destructive font-medium"}>{label}</span>
      {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
    </div>
  </li>
);

/** «تفعيل المنتج» — المدير العام أو مدير المبيعات فقط، وبعد اكتمال البيانات ودخول رصيد. */
const ProductActivationDialog = ({ product, onOpenChange, onActivated }: Props) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readiness, setReadiness] = useState<ProductReadiness | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!product) return;
    let cancelled = false;
    setReadiness(null);
    setLoadError(null);
    setLoading(true);
    (supabase as any)
      .rpc("product_readiness", { p_product_id: product.id })
      .then(({ data, error }: { data: ProductReadiness | null; error: unknown }) => {
        if (cancelled) return;
        if (error || !data) setLoadError(productDbErrorMessage(error, "تعذّر تحميل حالة المنتج"));
        else setReadiness(data);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [product]);

  const blockers = readiness?.blockers ?? [];
  const canActivate = !!readiness && readiness.can_activate_role && blockers.length === 0;

  const handleActivate = async () => {
    if (!product) return;
    setSaving(true);
    const { error } = await (supabase as any).rpc("activate_product", { p_product_id: product.id });
    setSaving(false);
    if (error) {
      toast.error("لم يتم تفعيل المنتج", { description: productDbErrorMessage(error) });
      return;
    }
    toast.success(`تم تفعيل «${product.name}»`);
    onActivated();
    onOpenChange(false);
  };

  return (
    <Dialog open={!!product} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>تفعيل المنتج: {product?.name}</DialogTitle>
          <DialogDescription>
            المنتج يتفعّل للبيع بعد اكتمال بياناته ودخول رصيد له في أحد المخازن.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> جاري الفحص...
          </div>
        )}
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}

        {readiness && (
          <ul className="space-y-2 py-2">
            <Row
              ok={readiness.has_barcode || readiness.barcode_pending}
              label={readiness.has_barcode ? "الكود مسجل" : readiness.barcode_pending ? "الكود تحت التسجيل" : "الكود غير مسجل"}
            />
            <Row ok={readiness.cost_ok} label={readiness.cost_ok ? "التكلفة مسجلة" : "التكلفة غير مسجلة"} />
            <Row
              ok={(readiness.pack_weight_kg ?? 0) > 0}
              label={(readiness.pack_weight_kg ?? 0) > 0 ? `وزن العبوة ${readiness.pack_weight_kg} كجم` : "وزن العبوة غير مسجل"}
            />
            {readiness.is_processed && (
              <Row
                ok={readiness.factory_items.length > 0}
                label={readiness.factory_items.length > 0 ? "مربوط بمصنع اللحوم" : "غير مربوط بصنف تام في مصنع اللحوم"}
                detail={readiness.factory_items.length > 0 ? readiness.factory_items.join("، ") : "لازم صنف تام في مصنع اللحوم بنفس الاسم"}
              />
            )}
            <Row
              ok={readiness.stock_total > 0}
              label={readiness.stock_total > 0 ? `الرصيد ${readiness.stock_total}` : "رصيد صفر في كل المخازن"}
            />
            {!readiness.can_activate_role && (
              <Row ok={false} label="تفعيل المنتج للمدير العام أو مدير المبيعات فقط" />
            )}
          </ul>
        )}

        {readiness && !canActivate && (
          <p className="text-xs rounded-md border border-destructive/30 bg-destructive/5 text-destructive p-2">
            لا يمكن التفعيل الآن: {[...blockers, ...(!readiness.can_activate_role ? ["الصلاحية"] : [])].join(" — ")}
          </p>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إغلاق
          </Button>
          <Button onClick={handleActivate} disabled={!canActivate || saving}>
            {saving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
            تفعيل المنتج
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProductActivationDialog;
