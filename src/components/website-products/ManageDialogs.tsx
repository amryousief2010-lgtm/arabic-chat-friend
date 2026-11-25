/**
 * نوافذ إدارة منتجات الموقع (م. آلاء / المدير العام / المدير التنفيذي):
 * الصور، الأسعار (COCEG والموقع)، الظهور على الموقع، التخفيض. كل كتابة تمر بمعاينة فروق ثم تأكيد،
 * وتُسجَّل في سجل المزامنة (RPC في القاعدة أو woo-catalog-sync للموقع).
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, BadgePercent, CalendarClock, Eye, EyeOff, Gift, ImagePlus, Lock, PencilLine, Truck, UploadCloud } from "lucide-react";
import {
  type BoxItemSummary,
  CHANGE_FIELD_LABELS,
  IMAGE_BUCKET,
  boxPriceFromItems,
  changeValueLabel,
  formatEgp,
  formatNum,
  imageFileProblem,
  imageStoragePath,
  syncErrorMessage,
} from "@/lib/websiteProducts";
import { formatValidityDate, parseValidityInput, shouldHideOnSite, toDatetimeLocal, type ValidityMode, validityModeOf, validityState, VALIDITY_STATE_LABELS } from "@/lib/offerValidity";
import { compressImage } from "@/lib/imageCompress";
import type { Change, PreviewState } from "./Dialogs";
import { BRAND, CocTag, ProductImageFrame } from "./shared";
import { type SiteEditBody, siteApply, siteApplyWithReason, sitePreview } from "./sync";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** سياق البند الذي يُدار من البطاقة. */
export interface ManageCtx {
  kind: "product" | "offer_box";
  id: string; // coceg id
  name: string;
  cocPrice: number | null;
  shipping: number | null;
  items: BoxItemSummary[];
  imageUrl: string | null; // صورة coceg
  wooId: number | null; // منتج الموقع المربوط
  siteName?: string;
  siteRegular: number | null;
  siteSale: number | null;
  siteImage: string | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  siteHiddenByValidity?: boolean;
}

/** يحوّل فروق الموقع إلى صفوف معاينة مقروءة («على الموقع»). */
export const siteRows = (changes: Change[]): Change[] =>
  changes.map((c) => ({
    field: `${CHANGE_FIELD_LABELS[c.field] ?? c.field} · على الموقع`,
    before: changeValueLabel(c.field, c.before),
    after: changeValueLabel(c.field, c.after) === "—" ? "(فارغ)" : changeValueLabel(c.field, c.after),
  }));

/** معاينة كتابة على الموقع ثم تنفيذها بعد التأكيد. */
export async function previewSiteEdit(
  wooId: number,
  edit: SiteEditBody,
  title: string,
  confirmLabel: string,
  onPreview: (p: PreviewState | null) => void,
  onDone: () => void,
  reason?: string,
) {
  const { data, error } = await sitePreview(wooId, edit);
  if (error || !data) return void toast.error(syncErrorMessage(error));
  onPreview({
    title,
    changes: siteRows(data.changes),
    warnings: data.warnings,
    confirmLabel,
    blocked: data.keys_configured ? (data.changes.length ? null : "لا توجد فروق") : syncErrorMessage("woo_keys_missing"),
    onConfirm: async () => {
      const r = reason
        ? await siteApplyWithReason(wooId, edit, data.token, reason)
        : await siteApply(wooId, edit, data.token);
      if (r.error) return void toast.error(syncErrorMessage(r.error));
      toast.success("تم التنفيذ على الموقع وتسجيله في السجل");
      onPreview(null);
      onDone();
    },
  });
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center gap-2 font-bold text-sm" style={{ color: BRAND.deep }}>
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

// ── 1) تعديل السعر ─────────────────────────────────────────────────────────

export function PriceEditDialog({
  ctx,
  onClose,
  onPreview,
  onDone,
}: {
  ctx: ManageCtx | null;
  onClose: () => void;
  onPreview: (p: PreviewState | null) => void;
  onDone: () => void;
}) {
  const [cocPrice, setCocPrice] = useState("");
  const [itemPrices, setItemPrices] = useState<Record<string, string>>({});
  const [editSite, setEditSite] = useState(false);
  const [sitePrice, setSitePrice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ctx) return;
    setCocPrice(ctx.cocPrice ? String(ctx.cocPrice) : "");
    setItemPrices(Object.fromEntries(ctx.items.filter((i) => i.id && !i.is_gift).map((i) => [i.id!, String(i.custom_price ?? 0)])));
    setEditSite(false);
    setSitePrice(ctx.siteRegular ? String(ctx.siteRegular) : "");
  }, [ctx]);

  const isBox = ctx?.kind === "offer_box";
  const boxNew = useMemo(
    () => (ctx && isBox ? boxPriceFromItems(ctx.items.map((i) => (i.id && itemPrices[i.id] !== undefined ? { ...i, custom_price: Number(itemPrices[i.id]) } : i)), ctx.shipping) : null),
    [ctx, isBox, itemPrices],
  );
  if (!ctx) return null;
  const newCoc = isBox ? boxNew : Number(cocPrice) || null;
  const cocChanged = newCoc !== null && newCoc !== ctx.cocPrice;
  const siteVal = Number(sitePrice);
  const siteChanged = editSite && ctx.wooId !== null && siteVal > 0 && siteVal !== ctx.siteRegular;

  const preview = async () => {
    const changes: Change[] = [];
    if (cocChanged) {
      if (isBox) {
        for (const i of ctx.items.filter((x) => x.id && !x.is_gift)) {
          const after = Number(itemPrices[i.id!]);
          if (after !== Number(i.custom_price ?? 0)) {
            changes.push({ field: `سعر «${i.name}» × ${formatNum(i.quantity)} في COCEG`, before: formatEgp(i.custom_price ?? 0), after: formatEgp(after) });
          }
        }
        changes.push({ field: "الشحن (ضمن السعر — بدون تغيير)", before: formatEgp(ctx.shipping ?? 0), after: formatEgp(ctx.shipping ?? 0) });
      }
      changes.push({ field: isBox ? "سعر العرض في COCEG" : "السعر في COCEG", before: formatEgp(ctx.cocPrice), after: formatEgp(newCoc) });
    }
    let token: string | null = null;
    const warnings: string[] = [];
    let blocked: string | null = null;
    const edit: SiteEditBody | null = siteChanged ? { kind: "price", regular_price: siteVal } : null;
    if (edit && ctx.wooId) {
      setBusy(true);
      const { data, error } = await sitePreview(ctx.wooId, edit);
      setBusy(false);
      if (error || !data) return void toast.error(syncErrorMessage(error));
      changes.push(...siteRows(data.changes));
      warnings.push(...data.warnings);
      token = data.token;
      if (!data.keys_configured) blocked = syncErrorMessage("woo_keys_missing");
    }
    if (!changes.length) return void toast.info("لا توجد فروق");
    if (isBox && cocChanged) warnings.push("box_identity_kept");
    onClose();
    onPreview({
      title: `تعديل سعر «${ctx.name}»`,
      changes,
      warnings,
      confirmLabel: "تأكيد التعديل",
      blocked,
      onConfirm: async () => {
        if (cocChanged) {
          const { error } = isBox
            ? await db.rpc("website_set_coc_box_prices", {
                _box_id: ctx.id,
                _items: Object.entries(itemPrices).map(([item_id, v]) => ({ item_id, custom_price: Number(v) })),
                _expected_offer_price: ctx.cocPrice,
              })
            : await db.rpc("website_set_coc_product_price", { _product_id: ctx.id, _price: newCoc, _expected: ctx.cocPrice });
          if (error) return void toast.error(syncErrorMessage(error.message));
        }
        if (edit && ctx.wooId && token) {
          const r = await siteApply(ctx.wooId, edit, token);
          if (r.error) {
            toast.error(`${cocChanged ? "تم تعديل سعر COCEG، لكن " : ""}${syncErrorMessage(r.error)}`);
            onPreview(null);
            return onDone();
          }
        }
        toast.success("تم تعديل السعر وتسجيله في السجل");
        onPreview(null);
        onDone();
      },
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="font-cairo max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: BRAND.deep }}>
            <PencilLine className="w-5 h-5" />
            تعديل السعر — {ctx.name}
          </DialogTitle>
          <DialogDescription>الطلبات تُسعَّر بسعر COCEG؛ أي تعديل يسري على الطلبات الجديدة فقط. ستظهر معاينة الفروق قبل التنفيذ.</DialogDescription>
        </DialogHeader>

        <Section icon={isBox ? <Gift className="w-4 h-4" /> : <PencilLine className="w-4 h-4" />} title={<span>السعر في <CocTag /></span>}>
          {isBox ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">سعر العرض = مجموع المكونات المدفوعة + الشحن. عدّل سعر المكونات، ويبقى الاسم والمكونات والكميات والشحن كما هي.</p>
              {ctx.items.map((i, idx) => (
                <div key={i.id ?? idx} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">
                    {i.name} × {formatNum(i.quantity)}
                  </span>
                  {i.is_gift || !i.id ? (
                    <span className="text-xs text-muted-foreground w-28 text-center">هدية</span>
                  ) : (
                    <Input
                      dir="ltr"
                      inputMode="decimal"
                      className="w-28 h-8 text-left"
                      value={itemPrices[i.id] ?? ""}
                      onChange={(e) => setItemPrices((p) => ({ ...p, [i.id!]: e.target.value.replace(/[^\d.]/g, "") }))}
                      aria-label={`سعر ${i.name}`}
                    />
                  )}
                </div>
              ))}
              <div className="flex items-center gap-2 text-sm text-muted-foreground border-t pt-2">
                <Truck className="w-4 h-4" />
                <span className="flex-1">الشحن ضمن السعر</span>
                <span className="inline-flex items-center gap-1 w-28 justify-center">
                  <Lock className="w-3 h-3" />
                  {formatEgp(ctx.shipping ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-white border px-3 py-2">
                <span className="text-sm">سعر العرض الجديد</span>
                <span className="font-extrabold text-lg" style={{ color: BRAND.deep }}>
                  {formatEgp(boxNew)}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Label className="w-24 text-sm">السعر الجديد</Label>
              <Input dir="ltr" inputMode="decimal" className="text-left" value={cocPrice} onChange={(e) => setCocPrice(e.target.value.replace(/[^\d.]/g, ""))} />
              <span className="text-xs text-muted-foreground whitespace-nowrap">الحالي {formatEgp(ctx.cocPrice)}</span>
            </div>
          )}
        </Section>

        {ctx.wooId !== null && (
          <Section icon={<UploadCloud className="w-4 h-4" />} title="سعر الموقع">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={editSite} onCheckedChange={(v) => setEditSite(!!v)} />
              تعديل السعر الأساسي على الموقع أيضاً
            </label>
            {editSite && (
              <div className="flex items-center gap-2">
                <Input dir="ltr" inputMode="decimal" className="text-left" value={sitePrice} onChange={(e) => setSitePrice(e.target.value.replace(/[^\d.]/g, ""))} />
                <Button type="button" size="sm" variant="outline" className="whitespace-nowrap rounded-xl" onClick={() => newCoc && setSitePrice(String(newCoc))}>
                  مثل سعر <CocTag />
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">الحالي على الموقع {formatEgp(ctx.siteRegular)}{ctx.siteSale ? ` · تخفيض ${formatEgp(ctx.siteSale)}` : ""}</p>
          </Section>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={busy || (!cocChanged && !siteChanged)} style={{ backgroundColor: BRAND.primary }} onClick={preview} className="gap-1.5">
            معاينة الفروق
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 2) التخفيض على الموقع ──────────────────────────────────────────────────

export function SaleDialog({
  ctx,
  onClose,
  onPreview,
  onDone,
}: {
  ctx: ManageCtx | null;
  onClose: () => void;
  onPreview: (p: PreviewState | null) => void;
  onDone: () => void;
}) {
  const [price, setPrice] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  useEffect(() => {
    setPrice(ctx?.siteSale ? String(ctx.siteSale) : "");
    setFrom("");
    setTo("");
  }, [ctx]);
  if (!ctx || ctx.wooId === null) return null;
  const sp = Number(price);
  const pct = ctx.siteRegular && sp > 0 && sp < ctx.siteRegular ? Math.round((1 - sp / ctx.siteRegular) * 100) : null;
  const go = (edit: SiteEditBody, title: string) => {
    onClose();
    void previewSiteEdit(ctx.wooId!, edit, title, "تأكيد على الموقع", onPreview, onDone);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="font-cairo max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: BRAND.deep }}>
            <BadgePercent className="w-5 h-5" />
            تخفيض على الموقع — {ctx.siteName ?? ctx.name}
          </DialogTitle>
          <DialogDescription>
            يظهر التخفيض على الموقع فقط، ويبقى سعر <CocTag /> كما هو ما لم تعدّليه من «تعديل السعر».
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm rounded-xl bg-muted/40 px-3 py-2">
            <span>السعر الأساسي على الموقع</span>
            <span className="font-bold" style={{ color: BRAND.deep }}>{formatEgp(ctx.siteRegular)}</span>
          </div>
          <div className="space-y-1.5">
            <Label>سعر التخفيض</Label>
            <div className="flex items-center gap-2">
              <Input dir="ltr" inputMode="decimal" className="text-left" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} />
              {pct !== null && (
                <span className="text-xs font-bold px-2 py-1 rounded-lg text-white whitespace-nowrap" style={{ backgroundColor: BRAND.accent }}>
                  خصم {formatNum(pct)}%
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>من تاريخ (اختياري)</Label>
              <Input type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>إلى تاريخ (اختياري)</Label>
              <Input type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {ctx.siteSale ? (
            <Button variant="outline" className="text-destructive" onClick={() => go({ kind: "sale", sale_price: null }, `إلغاء التخفيض عن «${ctx.siteName ?? ctx.name}»`)}>
              إلغاء التخفيض
            </Button>
          ) : (
            <span />
          )}
          <Button
            disabled={!(pct !== null) || (!!from && !!to && from > to)}
            style={{ backgroundColor: BRAND.primary }}
            className="gap-1.5"
            onClick={() => go({ kind: "sale", sale_price: sp, date_from: from || null, date_to: to || null }, `تخفيض «${ctx.siteName ?? ctx.name}» على الموقع`)}
          >
            معاينة الفروق
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 3) الظهور على الموقع ───────────────────────────────────────────────────

type Vis = "publish_visible" | "publish_hidden" | "draft";

export function VisibilityDialog({
  ctx,
  current,
  onClose,
  onPreview,
  onDone,
}: {
  ctx: ManageCtx | null;
  current: Vis;
  onClose: () => void;
  onPreview: (p: PreviewState | null) => void;
  onDone: () => void;
}) {
  const [v, setV] = useState<Vis>(current);
  useEffect(() => setV(current), [current, ctx]);
  if (!ctx || ctx.wooId === null) return null;
  const opts: { value: Vis; icon: React.ReactNode; title: string; sub: string }[] = [
    { value: "publish_visible", icon: <Eye className="w-4 h-4 text-emerald-600" />, title: "منشور وظاهر", sub: "يظهر في المتجر ونتائج البحث" },
    { value: "publish_hidden", icon: <EyeOff className="w-4 h-4" style={{ color: BRAND.accent }} />, title: "منشور ومخفي من المتجر", sub: "لا يظهر في المتجر والبحث، ويبقى رابطه المباشر يعمل" },
    { value: "draft", icon: <EyeOff className="w-4 h-4 text-muted-foreground" />, title: "مسودة (إيقاف النشر)", sub: "لا يظهر للعملاء نهائياً حتى إعادة نشره" },
  ];
  const edit: SiteEditBody =
    v === "draft" ? { kind: "visibility", status: "draft", catalog_visibility: "visible" }
    : { kind: "visibility", status: "publish", catalog_visibility: v === "publish_hidden" ? "hidden" : "visible" };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="font-cairo max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: BRAND.deep }}>
            <Eye className="w-5 h-5" />
            الظهور على الموقع — {ctx.siteName ?? ctx.name}
          </DialogTitle>
          <DialogDescription>اختاري حالة الظهور؛ ستظهر معاينة الحالة الحالية على الموقع قبل التنفيذ.</DialogDescription>
        </DialogHeader>
        <RadioGroup dir="rtl" value={v} onValueChange={(x) => setV(x as Vis)} className="space-y-2">
          {opts.map((o) => (
            <label key={o.value} className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer ${v === o.value ? "border-[#A4288A] bg-[#A4288A]/5" : ""}`}>
              <RadioGroupItem value={o.value} className="mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 font-semibold text-sm">
                  {o.icon}
                  {o.title}
                </div>
                <div className="text-xs text-muted-foreground">{o.sub}</div>
              </div>
            </label>
          ))}
        </RadioGroup>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            style={{ backgroundColor: BRAND.primary }}
            className="gap-1.5"
            onClick={() => {
              onClose();
              void previewSiteEdit(ctx.wooId!, edit, `الظهور على الموقع: «${ctx.siteName ?? ctx.name}»`, "تأكيد على الموقع", onPreview, onDone);
            }}
          >
            معاينة الفروق
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 4) صورة المنتج / العرض ─────────────────────────────────────────────────

export function ImageDialog({ ctx, onClose, onDone }: { ctx: ManageCtx | null; onClose: () => void; onDone: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [push, setPush] = useState(true);
  const [step, setStep] = useState<"pick" | "preview">("pick");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBlob(null);
    setLocalUrl(null);
    setProblem(null);
    setStep("pick");
    setPush(true);
  }, [ctx]);
  useEffect(() => () => void (localUrl && URL.revokeObjectURL(localUrl)), [localUrl]);
  if (!ctx) return null;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const p = imageFileProblem(file);
    if (p) return setProblem(p);
    setProblem(null);
    setBusy(true);
    try {
      const b = await compressImage(file);
      setBlob(b);
      setLocalUrl(URL.createObjectURL(b));
    } catch {
      setProblem("تعذّر تجهيز الصورة؛ جرّبي صورة أخرى");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!blob) return;
    setBusy(true);
    try {
      const path = imageStoragePath(ctx.kind, ctx.id);
      const up = await supabase.storage.from(IMAGE_BUCKET).upload(path, blob, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
      if (up.error) throw new Error(up.error.message);
      const url = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
      const { error } = await db.rpc("website_set_coc_image", { _kind: ctx.kind, _id: ctx.id, _url: url });
      if (error) throw new Error(error.message);
      if (push && ctx.wooId !== null) {
        const pv = await sitePreview(ctx.wooId, { kind: "image" });
        if (pv.error || !pv.data) throw new Error(`site:${pv.error}`);
        if (pv.data.changes.length) {
          const r = await siteApply(ctx.wooId, { kind: "image" }, pv.data.token);
          if (r.error) throw new Error(`site:${r.error}`);
        }
      }
      toast.success(push && ctx.wooId !== null ? "تم حفظ الصورة في COCEG ونشرها على الموقع" : "تم حفظ الصورة في COCEG");
      onClose();
      onDone();
    } catch (e) {
      const m = String((e as Error).message ?? "");
      toast.error(m.startsWith("site:") ? `حُفظت الصورة في COCEG، لكن ${syncErrorMessage(m.slice(5))}` : syncErrorMessage(m));
      if (m.startsWith("site:")) {
        onClose();
        onDone();
      }
    } finally {
      setBusy(false);
    }
  };

  const isBox = ctx.kind === "offer_box";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="font-cairo max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: BRAND.deep }}>
            <ImagePlus className="w-5 h-5" />
            {ctx.imageUrl ? "استبدال الصورة" : "إضافة صورة"} — {ctx.name}
          </DialogTitle>
          <DialogDescription>JPG أو PNG أو WebP. تُضغط الصورة تلقائياً (حتى 1200 بكسل وأقل من 2 ميجابايت) قبل الحفظ.</DialogDescription>
        </DialogHeader>

        {step === "pick" ? (
          <div className="space-y-3">
            <label className="block cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center hover:bg-muted/30 transition-colors" style={{ borderColor: "rgba(164,40,138,0.35)" }}>
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
              {localUrl ? (
                <img src={localUrl} alt={ctx.name} className="mx-auto max-h-64 rounded-xl object-contain" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <UploadCloud className="w-10 h-10" style={{ color: BRAND.primary }} />
                  <span className="font-semibold text-foreground">اختاري صورة من الجهاز</span>
                  <span className="text-xs">صورة مربعة بخلفية فاتحة تظهر بأفضل شكل في المتجر</span>
                </div>
              )}
            </label>
            {blob && <div className="text-xs text-muted-foreground text-center">الحجم بعد الضغط: <bdi dir="ltr">{formatNum(Math.round(blob.size / 1024))} KB</bdi></div>}
            {problem && <div className="text-sm text-destructive text-center">{problem}</div>}
            {ctx.wooId !== null && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={push} onCheckedChange={(v) => setPush(!!v)} />
                نشر الصورة على منتج الموقع المربوط أيضاً
              </label>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground text-center">قبل</div>
                <div className="rounded-2xl overflow-hidden border">
                  <ProductImageFrame imageUrl={ctx.imageUrl ?? (push ? ctx.siteImage : null)} alt={`${ctx.name} قبل`} isBox={isBox} />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-center" style={{ color: BRAND.primary }}>بعد</div>
                <div className="rounded-2xl overflow-hidden border-2" style={{ borderColor: BRAND.primary }}>
                  <ProductImageFrame imageUrl={localUrl} alt={`${ctx.name} بعد`} isBox={isBox} />
                </div>
              </div>
            </div>
            <ul className="text-sm space-y-1.5 rounded-xl bg-muted/40 p-3">
              <li>• صورة <CocTag />: {ctx.imageUrl ? "استبدال الصورة الحالية" : "إضافة صورة جديدة"}</li>
              {ctx.wooId !== null && <li>• صورة منتج الموقع: {push ? "تُستبدل بهذه الصورة" : "بدون تغيير"}</li>}
              <li className="text-xs text-muted-foreground">تُسجَّل العملية في سجل المزامنة باسمك.</li>
            </ul>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "preview" ? (
            <>
              <Button variant="outline" onClick={() => setStep("pick")} disabled={busy}>
                رجوع
              </Button>
              <Button style={{ backgroundColor: BRAND.primary }} disabled={busy} onClick={confirm}>
                {busy ? "جارٍ الحفظ…" : "تأكيد الحفظ"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                إلغاء
              </Button>
              <Button style={{ backgroundColor: BRAND.primary }} disabled={!blob || busy} onClick={() => setStep("preview")} className="gap-1.5">
                معاينة
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ── 5) صلاحية العرض ────────────────────────────────────────────────────────


export function ValidityDialog({
  ctx,
  onClose,
  onPreview,
  onDone,
}: {
  ctx: ManageCtx | null;
  onClose: () => void;
  onPreview: (p: PreviewState | null) => void;
  onDone: () => void;
}) {
  const initial = { starts_at: ctx?.startsAt ?? null, expires_at: ctx?.expiresAt ?? null };
  const [mode, setMode] = useState<ValidityMode>(validityModeOf(initial));
  const [starts, setStarts] = useState(toDatetimeLocal(ctx?.startsAt));
  const [expires, setExpires] = useState(toDatetimeLocal(ctx?.expiresAt));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const v = { starts_at: ctx?.startsAt ?? null, expires_at: ctx?.expiresAt ?? null };
    setMode(validityModeOf(v));
    setStarts(toDatetimeLocal(ctx?.startsAt));
    setExpires(toDatetimeLocal(ctx?.expiresAt));
  }, [ctx]);
  if (!ctx || ctx.kind !== "offer_box") return null;

  const save = async () => {
    const parsed = parseValidityInput(mode, starts, expires);
    if (!parsed.ok) return void toast.error(syncErrorMessage(parsed.error));
    setBusy(true);
    const { data, error } = await db.rpc("website_set_offer_validity", {
      _box_id: ctx.id,
      _mode: mode,
      _starts_at: parsed.starts_at,
      _expires_at: parsed.expires_at,
    });
    setBusy(false);
    if (error) return void toast.error(syncErrorMessage(error.message) || error.message);
    toast.success("تم حفظ مدة العرض في النظام");
    onClose();
    onDone();
    if (ctx.wooId != null && data) {
      const hide = shouldHideOnSite({ starts_at: parsed.starts_at, expires_at: parsed.expires_at });
      const alreadyOurs = !!ctx.siteHiddenByValidity;
      if (hide) {
        void previewSiteEdit(
          ctx.wooId,
          { kind: "visibility", status: "publish", catalog_visibility: "hidden" },
          `إخفاء العرض على الموقع لانتهاء/عدم بدء المدة: «${ctx.siteName ?? ctx.name}»`,
          "تأكيد الإخفاء على الموقع",
          onPreview,
          onDone,
          "validity",
        );
      } else if (alreadyOurs) {
        void previewSiteEdit(
          ctx.wooId,
          { kind: "visibility", status: "publish", catalog_visibility: "visible" },
          `إعادة إظهار العرض على الموقع بعد تمديد المدة: «${ctx.siteName ?? ctx.name}»`,
          "تأكيد الإظهار على الموقع",
          onPreview,
          onDone,
          "validity",
        );
      }
    }
  };

  const state = validityState({ starts_at: mode === "open" ? null : starts, expires_at: mode === "open" ? null : expires });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="font-cairo max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: BRAND.deep }}>
            <CalendarClock className="w-5 h-5" />
            صلاحية العرض — {ctx.name}
          </DialogTitle>
          <DialogDescription>
            اختاري «مفتوح بدون مدة» أو حدّدي بداية ونهاية. يمكن التعديل في أي وقت. السعر والشحن والمكوّنات لا تتغير. الحالة الحالية: {VALIDITY_STATE_LABELS[state]}
            {ctx.startsAt || ctx.expiresAt ? ` (من ${formatValidityDate(ctx.startsAt)} إلى ${formatValidityDate(ctx.expiresAt)})` : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={`rounded-xl border px-3 py-2 text-sm ${mode === "open" ? "border-[#662D8C] bg-[#662D8C]/10 font-medium" : "border-border"}`} onClick={() => setMode("open")}>
            مفتوح بدون مدة
          </button>
          <button type="button" className={`rounded-xl border px-3 py-2 text-sm ${mode === "window" ? "border-[#662D8C] bg-[#662D8C]/10 font-medium" : "border-border"}`} onClick={() => setMode("window")}>
            له مدة
          </button>
        </div>
        {mode === "window" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>تاريخ البداية</Label>
              <Input type="datetime-local" dir="ltr" value={starts} onChange={(e) => setStarts(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>تاريخ النهاية</Label>
              <Input type="datetime-local" dir="ltr" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          خارج المدة لا يُختار العرض لطلبات جديدة، ويُخفى من متجر الموقع (منشور ومخفي — عكسه آمن). عند التمديد يظهر مرة أخرى بعد التأكيد.
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button style={{ backgroundColor: BRAND.primary }} disabled={busy} onClick={() => void save()} className="gap-1.5">
            حفظ المدة
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RestoreDialog({
  backupId,
  title,
  onClose,
  onPreview,
  onDone,
}: {
  backupId: string | null;
  title: string;
  onClose: () => void;
  onPreview: (p: PreviewState | null) => void;
  onDone: () => void;
}) {
  useEffect(() => {
    if (!backupId) return;
    void (async () => {
      const { restorePreview, restoreApply } = await import("./sync");
      const { data, error } = await restorePreview(backupId);
      if (error || !data) {
        toast.error(syncErrorMessage(error));
        onClose();
        return;
      }
      onClose();
      onPreview({
        title: `استرجاع المنتج إلى ما قبل: ${title}`,
        changes: (data.changes ?? []).map((c) => ({
          field: CHANGE_FIELD_LABELS[c.field] ?? c.field,
          before: typeof c.before === "string" || c.before == null ? changeValueLabel(c.field, c.before as string | null) : JSON.stringify(c.before),
          after: typeof c.after === "string" || c.after == null ? changeValueLabel(c.field, c.after as string | null) : JSON.stringify(c.after),
        })),
        warnings: data.warnings ?? [],
        confirmLabel: "تأكيد الاسترجاع",
        blocked: data.keys_configured ? (data.changes.length ? null : "المنتج مطابق للنسخة المحفوظة") : syncErrorMessage("woo_keys_missing"),
        onConfirm: async () => {
          const r = await restoreApply(backupId, data.token);
          if (r.error) return void toast.error(syncErrorMessage(r.error));
          toast.success("تم استرجاع المنتج على الموقع من النسخة المحفوظة");
          onPreview(null);
          onDone();
        },
      });
    })();
  }, [backupId, title, onClose, onPreview, onDone]);
  return null;
}
