/**
 * نافذة الربط ووزن عبوة الموقع (site_pack_qty).
 * مثال: «لانشون نعام – 500 جرام» على الموقع، و«لانشون» في COCEG بالكيلو → 0.5 كجم.
 * القيمة تُقترح من اسم منتج الموقع ولا تُحفظ إلا بعد تأكيد صريح.
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Link2, Scale, Sparkles } from "lucide-react";
import { type CocProduct, type MapRow, type SiteProduct, formatEgp, formatSignedEgp, syncErrorMessage } from "@/lib/websiteProducts";
import {
  formatPackQty,
  isKgUnit,
  packFactorOf,
  packPriceExplanation,
  packQtyLine,
  sitePackPrice,
  suggestPackQty,
  unitSymbol,
  unitWord,
  validPackQty,
  weightLabel,
} from "@/lib/sitePack";
import { BRAND, CocTag } from "./shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface PackDialogState {
  mode: "link" | "edit";
  site: SiteProduct;
  product: CocProduct;
  map?: MapRow | null;
}

const PRESETS: { qty: number; label: string; text: string }[] = [
  { qty: 0.25, label: "250 جم", text: "ربع كيلو" },
  { qty: 0.5, label: "500 جم", text: "نصف كيلو" },
  { qty: 1, label: "1 كجم", text: "كيلو" },
  { qty: 2, label: "2 كجم", text: "2 كيلو" },
];

export function PackDialog({ state, onClose, onDone }: { state: PackDialogState | null; onClose: () => void; onDone: () => void }) {
  const [qtyText, setQtyText] = useState("1");
  const [label, setLabel] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const suggestion = useMemo(() => (state ? suggestPackQty(state.site.name, state.product) : null), [state]);
  const current = state?.map ? packFactorOf(state.map) : 1;

  useEffect(() => {
    if (!state) return;
    const isEdit = state.mode === "edit" && !!state.map;
    const start = isEdit && state.map?.site_pack_confirmed_at ? current : suggestion?.qty ?? current;
    setQtyText(String(start));
    setLabel(
      (isEdit && state.map?.site_pack_label) ||
        (suggestion && suggestion.qty === start ? suggestion.label : "") ||
        (isKgUnit(state.product.unit ?? "كجم") ? weightLabel(start) : ""),
    );
    setConfirmed(false);
  }, [state, suggestion, current]);

  if (!state) return null;
  const { site, product } = state;
  const unit = product.unit ?? "كجم";
  const qty = validPackQty(qtyText);
  const cocPrice = product.price === null ? null : Number(product.price);
  const packPrice = qty !== null ? sitePackPrice(cocPrice, qty) : null;
  const sitePrice = site.price === null ? null : Number(site.price);
  const diff = packPrice !== null && sitePrice !== null ? Math.round((sitePrice - packPrice) * 100) / 100 : null;
  const explanation = qty !== null ? packPriceExplanation(cocPrice, qty, unit, label) : null;
  const differsFromSuggestion = !!suggestion && qty !== null && suggestion.qty !== qty;

  const save = async () => {
    if (qty === null || !confirmed) return;
    setBusy(true);
    const { error } =
      state.mode === "link"
        ? await db.rpc("woo_catalog_map_with_pack", {
            _woo_product_id: site.woo_product_id,
            _woo_variation_id: Number(site.woo_variation_id || 0),
            _product_id: product.id,
            _offer_box_id: null,
            _site_pack_qty: qty,
            _site_pack_label: label.trim() || null,
          })
        : await db.rpc("woo_catalog_set_pack", {
            _woo_product_id: site.woo_product_id,
            _woo_variation_id: Number(site.woo_variation_id || 0),
            _site_pack_qty: qty,
            _site_pack_label: label.trim() || null,
            _expected_pack_qty: current,
          });
    setBusy(false);
    if (error) return void toast.error(syncErrorMessage(error.message));
    toast.success(state.mode === "link" ? "تم الربط وحفظ وزن العبوة" : "تم حفظ وزن عبوة الموقع");
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="font-cairo max-w-lg max-h-[80dvh] sm:max-h-[90dvh] overflow-y-auto gap-4 p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 leading-relaxed pl-8" style={{ color: BRAND.deep }}>
            {state.mode === "link" ? <Link2 className="w-5 h-5 shrink-0" /> : <Scale className="w-5 h-5 shrink-0" />}
            {state.mode === "link" ? "ربط منتج الموقع ووزن العبوة" : "وزن عبوة الموقع"}
          </DialogTitle>
          <DialogDescription>
            حدّد كمية <CocTag /> التي تساويها عبوة واحدة على الموقع. يُحسب منها سعر الموقع وكمية الطلبات، ولن يُحفظ شيء قبل التأكيد.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl border bg-muted/30 p-3 space-y-1">
            <div className="text-xs text-muted-foreground">منتج الموقع</div>
            <div className="font-bold leading-snug">{site.name}</div>
            <div className="text-xs text-muted-foreground">
              السعر الحالي: <span className="font-semibold text-foreground">{formatEgp(site.price)}</span>
            </div>
          </div>
          <div className="rounded-xl border bg-muted/30 p-3 space-y-1">
            <div className="text-xs text-muted-foreground">
              منتج <CocTag />
            </div>
            <div className="font-bold leading-snug">{product.name}</div>
            <div className="text-xs text-muted-foreground">
              سعر {unitWord(unit)}: <span className="font-semibold text-foreground">{formatEgp(product.price)}</span>
            </div>
          </div>
        </div>

        {suggestion && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 flex items-start gap-2">
            <Sparkles className="w-4 h-4 shrink-0 mt-0.5" style={{ color: BRAND.accent }} />
            <div className="flex-1 space-y-1">
              <div>
                اقتراح من اسم منتج الموقع: عبوة {suggestion.label} = {formatPackQty(suggestion.qty, unit)}. يُرجى التأكد منه قبل الاعتماد.
              </div>
              {differsFromSuggestion && (
                <button
                  type="button"
                  className="text-xs font-bold underline"
                  style={{ color: BRAND.primary }}
                  onClick={() => {
                    setQtyText(String(suggestion.qty));
                    setLabel(suggestion.label);
                    setConfirmed(false);
                  }}
                >
                  استخدام الاقتراح
                </button>
              )}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="site-pack-qty" className="text-sm font-bold" style={{ color: BRAND.deep }}>
            وزن عبوة الموقع بوحدة <CocTag /> ({unitSymbol(unit)})
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {isKgUnit(unit) &&
              PRESETS.map((p) => (
                <button
                  key={p.qty}
                  type="button"
                  onClick={() => {
                    setQtyText(String(p.qty));
                    setLabel(p.label);
                    setConfirmed(false);
                  }}
                  className="rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
                  style={
                    qty === p.qty
                      ? { backgroundColor: BRAND.primary, borderColor: BRAND.primary, color: "white" }
                      : { borderColor: "color-mix(in srgb, #662D8C 35%, white)", color: BRAND.deep }
                  }
                >
                  {p.text} · <bdi dir="ltr">{p.qty}</bdi>
                </button>
              ))}
          </div>
          <Input
            id="site-pack-qty"
            dir="ltr"
            inputMode="decimal"
            className="text-left"
            value={qtyText}
            onChange={(e) => {
              setQtyText(e.target.value.replace(/[^\d.]/g, ""));
              setConfirmed(false);
            }}
            aria-invalid={qty === null}
          />
          {qty === null && <p className="text-xs text-destructive">أدخل رقماً أكبر من صفر ولا يتجاوز 100.</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="site-pack-label" className="text-sm">
            وصف العبوة على الموقع (اختياري)
          </Label>
          <Input id="site-pack-label" value={label} maxLength={40} placeholder="مثال: 500 جم" onChange={(e) => setLabel(e.target.value)} />
        </div>

        {qty !== null && (
          <div className="rounded-xl border px-3 py-2.5 space-y-1.5 text-sm" style={{ borderColor: BRAND.deep, background: "color-mix(in srgb, #662D8C 7%, white)" }}>
            {explanation && (
              <div className="font-bold leading-relaxed" style={{ color: BRAND.deep }}>
                {explanation}
              </div>
            )}
            {diff !== null && (
              <div className="text-xs" style={{ color: diff === 0 ? "#047857" : BRAND.accent }}>
                {diff === 0
                  ? `مطابق لسعر الموقع الحالي (${formatEgp(sitePrice)}).`
                  : `سعر الموقع الحالي ${formatEgp(sitePrice)}، والفرق ${formatSignedEgp(diff)}.`}
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              طلب على الموقع: {packQtyLine(2, qty, unit)} في <CocTag />.
            </div>
          </div>
        )}

        <label className="flex items-start gap-2 text-sm cursor-pointer rounded-xl border p-3" style={{ borderColor: confirmed ? BRAND.primary : undefined }}>
          <Checkbox checked={confirmed} disabled={qty === null} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" />
          <span>
            أؤكد أن عبوة الموقع الواحدة تساوي {qty !== null ? formatPackQty(qty, unit) : "—"} من «{product.name}» في <CocTag />.
          </span>
        </label>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={busy || qty === null || !confirmed} style={{ backgroundColor: BRAND.primary }} onClick={save}>
            {state.mode === "link" ? "تأكيد الربط" : "حفظ وزن العبوة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
