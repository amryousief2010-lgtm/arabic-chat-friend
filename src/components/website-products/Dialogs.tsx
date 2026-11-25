import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, Scale } from "lucide-react";
import {
  type BoxItemDraft,
  type CocProduct,
  type SiteProduct,
  WARNING_LABELS,
  barcodeFromSiteSku,
  barcodeWarning,
  boxImportCheck,
  formatEgp,
  importProductMissing,
  syncErrorMessage,
} from "@/lib/websiteProducts";
import {
  type PreviewPriceContext,
  canKeepSale,
  customerPaySummary,
  keepSaleLabel,
  previewTableRows,
  saleRemovalWarning,
} from "@/lib/wooPreview";
import { BRAND, CocTag } from "./shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface Change {
  field: string;
  before: string | null;
  after: string;
}

export interface PreviewState {
  title: string;
  changes: Change[];
  warnings: string[];
  confirmLabel: string;
  blocked: string | null;
  onConfirm: () => Promise<void>;
  priceContext?: PreviewPriceContext;
  /** شرح حساب سعر عبوة الموقع من سعر COCEG (مثال: 350 × 0.5 كجم = 175 للعبوة). */
  packNote?: string | null;
  keepSale?: {
    available: boolean;
    enabled: boolean;
    onToggle: (enabled: boolean) => void;
    disabledReason?: string | null;
  };
}

export function PreviewDialog({ state, onClose }: { state: PreviewState | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  const ctx = state.priceContext ?? null;
  const pay = ctx ? customerPaySummary(ctx) : null;
  const saleWarn = ctx && !state.keepSale?.enabled ? saleRemovalWarning(ctx) : null;
  const rows = previewTableRows(state.changes, ctx);
  const keepAvailable = !!state.keepSale?.available || (!!ctx && canKeepSale(ctx));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="font-cairo max-w-2xl max-h-[90dvh] overflow-hidden flex flex-col gap-3 p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle style={{ color: BRAND.deep }}>{state.title}</DialogTitle>
          <DialogDescription>معاينة الفروق قبل التنفيذ. لن يتغير شيء قبل التأكيد.</DialogDescription>
        </DialogHeader>
        <div className="preview-scroll min-h-0 flex-1 overflow-y-auto space-y-3 pe-0.5 pb-2">
        {state.packNote && (
          <div className="rounded-xl border px-4 py-3 text-sm font-bold leading-relaxed flex items-start gap-2" style={{ borderColor: BRAND.primary, color: BRAND.primary, background: "color-mix(in srgb, #A4288A 7%, white)" }}>
            <Scale className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{state.packNote}</span>
          </div>
        )}
        {pay && (
          <div className="rounded-xl border px-4 py-3 text-sm font-medium leading-relaxed" style={{ borderColor: BRAND.deep, color: BRAND.deep, background: "color-mix(in srgb, #662D8C 8%, white)" }}>
            {pay}
          </div>
        )}
        {(saleWarn || keepAvailable) && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 space-y-2 text-sm text-amber-900">
            {saleWarn && (
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{saleWarn}</span>
              </div>
            )}
            {state.keepSale && keepAvailable && (
              <label className="flex items-start gap-2 cursor-pointer">
                <Checkbox
                  checked={state.keepSale.enabled}
                  disabled={!!state.keepSale.disabledReason}
                  onCheckedChange={(v) => state.keepSale?.onToggle(v === true)}
                  className="mt-0.5"
                />
                <span>{keepSaleLabel(ctx ?? { beforeRegular: null, beforeSale: null, afterRegular: null, afterSale: null })}</span>
              </label>
            )}
            {state.keepSale?.disabledReason && (
              <p className="text-xs text-destructive">{state.keepSale.disabledReason}</p>
            )}
          </div>
        )}
        <Table dir="rtl">
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">الحقل</TableHead>
              <TableHead className="text-right">قبل</TableHead>
              <TableHead className="text-right">بعد</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.field}>
                <TableCell>
                  <div>{c.label}</div>
                  {c.hint && (
                    <p className="text-xs text-muted-foreground mt-1 font-normal">
                      {c.hint.includes("COCEG") ? (
                        <>سيُكتب باركود <bdi dir="ltr">COCEG</bdi> على المنتج في الموقع.</>
                      ) : c.hint}
                    </p>
                  )}
                </TableCell>
                <TableCell className="whitespace-pre-line text-muted-foreground">{c.before || "—"}</TableCell>
                <TableCell className="whitespace-pre-line font-medium" style={{ color: BRAND.primary }}>
                  {c.after || "(فارغ)"}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  لا توجد فروق
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {state.warnings.map((w) => (
          <div key={w} className="text-xs text-amber-700 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {WARNING_LABELS[w] ?? w}
          </div>
        ))}
        {state.blocked && <div className="text-sm text-destructive">{state.blocked}</div>}
        </div>
        <DialogFooter className="gap-2 shrink-0 border-t bg-background pt-3 mt-1">
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            disabled={!!state.blocked || busy}
            style={{ backgroundColor: BRAND.primary }}
            onClick={async () => {
              setBusy(true);
              await state.onConfirm();
              setBusy(false);
            }}
          >
            {state.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ImportDialog({
  target,
  products,
  onClose,
  onDone,
}: {
  target: { site: SiteProduct; as: "product" | "offer_box" };
  products: CocProduct[];
  onClose: () => void;
  onDone: () => void;
}) {
  const s = target.site;
  const [form, setForm] = useState({
    name: s.name,
    price: s.price ? String(s.price) : "",
    cost_price: "",
    pack_weight_kg: "",
    barcode: barcodeFromSiteSku(s.sku),
    barcode_pending: false,
    unit: "كيلو",
  });
  const [shipping, setShipping] = useState("");
  const [items, setItems] = useState<BoxItemDraft[]>([]);
  const [busy, setBusy] = useState(false);

  const isBox = target.as === "offer_box";
  const missing = isBox ? [] : importProductMissing(form);
  const bw = isBox ? null : barcodeWarning(form.barcode);
  const box = boxImportCheck(s.price, shipping === "" ? null : Number(shipping), items);
  const canSave = isBox ? box.ok && !!form.name.trim() : missing.length === 0;

  const save = async () => {
    setBusy(true);
    const { error } = isBox
      ? await db.rpc("woo_catalog_import_box", {
          _woo_product_id: s.woo_product_id,
          _woo_variation_id: 0,
          _name: form.name,
          _shipping_cost: shipping === "" ? null : Number(shipping),
          _items: items,
        })
      : await db.rpc("woo_catalog_import_product", {
          _woo_product_id: s.woo_product_id,
          _woo_variation_id: 0,
          _name: form.name,
          _price: Number(form.price),
          _cost_price: Number(form.cost_price),
          _pack_weight_kg: Number(form.pack_weight_kg),
          _barcode: form.barcode.trim() || null,
          _barcode_pending: form.barcode_pending,
          _unit: form.unit,
          _category: null,
        });
    setBusy(false);
    if (error) return toast.error(syncErrorMessage(error.message));
    toast.success(isBox ? "تم إنشاء العرض في النظام (غير نشط) وربطه" : "تم إنشاء المنتج في النظام (غير نشط) وربطه");
    onDone();
  };

  const field = (label: string, key: keyof typeof form, type = "text") => (
    <label className="grid gap-1 text-sm">
      <span>{label}</span>
      <Input type={type} value={String(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </label>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="font-cairo max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle style={{ color: BRAND.deep }}>
            {isBox ? (
              <span>
                استيراد عرض من الموقع إلى <CocTag />
              </span>
            ) : (
              <span>
                استيراد منتج من الموقع إلى <CocTag />
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            «{s.name}» — سعر الموقع {formatEgp(s.price)}. يُنشأ غير نشط، ويُفعَّل لاحقاً من الشاشة المختصة.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          {field(isBox ? "اسم العرض" : "اسم المنتج", "name")}
          {!isBox && field("سعر البيع", "price", "number")}
          {!isBox && field("التكلفة", "cost_price", "number")}
          {!isBox && field("وزن العبوة (كجم)", "pack_weight_kg", "number")}
          {!isBox && (
            <div className="grid gap-1 text-sm">
              <span>الباركود</span>
              <Input
                dir="ltr"
                value={form.barcode}
                disabled={form.barcode_pending}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                placeholder="622400320xxxx"
              />
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={form.barcode_pending}
                  onCheckedChange={(v) => setForm({ ...form, barcode_pending: !!v, barcode: v ? "" : form.barcode })}
                />
                الكود تحت التسجيل
              </label>
              {bw && <span className="text-xs text-amber-700">{bw}</span>}
            </div>
          )}
          {isBox && (
            <label className="grid gap-1 text-sm">
              <span>تكلفة الشحن للعرض (ضمن السعر)</span>
              <Input type="number" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="مثال: 120" />
            </label>
          )}
        </div>

        {isBox && (
          <div className="space-y-2">
            <div className="text-sm font-semibold">مكونات العرض</div>
            {items.map((it, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Select
                  value={it.product_id || undefined}
                  onValueChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, product_id: v } : x)))}
                >
                  <SelectTrigger className="h-8 w-52">
                    <SelectValue placeholder="المنتج" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="h-8 w-20"
                  type="number"
                  value={it.quantity}
                  onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))}
                  aria-label="الكمية"
                />
                <Input
                  className="h-8 w-24"
                  type="number"
                  disabled={it.is_gift}
                  value={it.custom_price}
                  onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, custom_price: Number(e.target.value) } : x)))}
                  aria-label="السعر"
                />
                <label className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={it.is_gift}
                    onCheckedChange={(v) =>
                      setItems(items.map((x, j) => (j === i ? { ...x, is_gift: !!v, custom_price: v ? 0 : x.custom_price } : x)))
                    }
                  />
                  هدية
                </label>
                <Button size="sm" variant="ghost" onClick={() => setItems(items.filter((_, j) => j !== i))}>
                  حذف
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setItems([...items, { product_id: "", quantity: 1, custom_price: 0, is_gift: false }])}
            >
              إضافة مكوّن
            </Button>
            <div className={`text-sm ${box.ok ? "text-green-700" : "text-amber-700"}`}>
              المكونات المدفوعة {formatEgp(box.paid)} + الشحن {formatEgp(Number(shipping) || 0)} = {formatEgp(box.total)} مقابل سعر الموقع{" "}
              {formatEgp(s.price)}
              {!box.ok && " — يجب أن يتساويا تماماً"}
            </div>
          </div>
        )}

        {missing.length > 0 && <div className="text-sm text-destructive">حقول مطلوبة حسب قاعدة المنتج: {missing.join("، ")}</div>}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={!canSave || busy} onClick={save} style={{ backgroundColor: BRAND.primary }}>
            إنشاء في <CocTag /> وربطه
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
