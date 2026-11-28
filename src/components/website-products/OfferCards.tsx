import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarClock, CheckCircle2, ExternalLink, Gift, Layers, Link2Off, RefreshCw, Truck, Upload } from "lucide-react";
import { formatEgp, formatSignedEgp } from "@/lib/websiteProducts";
import { type OfferOverview, type OfferStatus, OFFER_STATUS_LABELS, offerAddDisabledReason } from "@/lib/websiteOffers";
import { formatValidityDate } from "@/lib/offerValidity";
import { formatPackQty } from "@/lib/sitePack";
import { BRAND, CocTag, ProductImageFrame } from "./shared";

/** بطاقة قسم كبيرة أعلى الشاشة (مثل أقسام الموقع). */
export function SectionTile({
  icon,
  title,
  value,
  lines,
  active,
  onClick,
  color,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  lines: React.ReactNode[];
  active: boolean;
  onClick: () => void;
  color: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`group relative text-right rounded-3xl border-2 p-5 sm:p-[26px] transition-all overflow-hidden ${
        active ? "shadow-lg text-white" : "bg-card hover:shadow-md"
      }`}
      style={
        active
          ? { background: `linear-gradient(135deg, ${color} 0%, ${BRAND.deep} 100%)`, borderColor: color }
          : { borderColor: `${color}55` }
      }
    >
      <div className="flex items-center gap-4">
        <div
          className="w-[52px] h-[52px] sm:w-[68px] sm:h-[68px] rounded-2xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: active ? "rgba(255,255,255,0.18)" : `${color}1f`, color: active ? "#fff" : color }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-base sm:text-lg font-extrabold leading-tight ${active ? "text-white" : ""}`} style={active ? undefined : { color: BRAND.deep }}>
            {title}
          </div>
          <div className="text-3xl sm:text-[42px] leading-none font-extrabold mt-1.5" style={active ? undefined : { color }}>
            {value}
          </div>
        </div>
      </div>
      <div className={`mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs ${active ? "text-white/90" : "text-muted-foreground"}`}>
        {lines.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </button>
  );
}

const STATUS_STYLE: Record<OfferStatus, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  scheduled: "bg-sky-50 text-sky-700 border-sky-200",
  expired: "bg-red-50 text-red-700 border-red-200",
  inactive: "bg-muted text-muted-foreground border-border",
};

export function OfferStatusChip({ status }: { status: OfferStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[status]}`}>
      {OFFER_STATUS_LABELS[status].replace("COCEG", "").trim()}
      {status === "inactive" && <CocTag />}
    </span>
  );
}

export function LinkBadge({ linked }: { linked: boolean }) {
  return linked ? (
    <Badge className="border-0 bg-emerald-600 text-white gap-1 shadow-sm">
      <CheckCircle2 className="w-3 h-3" />
      مربوط بالموقع
    </Badge>
  ) : (
    <Badge className="border-0 text-white gap-1 shadow-sm" style={{ backgroundColor: BRAND.accent }}>
      <Link2Off className="w-3 h-3" />
      غير موجود على الموقع
    </Badge>
  );
}

/** بطاقة عرض/بوكس واحد: المكونات والأسعار والشحن والحالة والربط بالموقع. */
export function OfferOverviewCard({
  offer,
  writeBlocked,
  onUpdate,
  onAdd,
}: {
  offer: OfferOverview;
  /** سبب تعطيل الكتابة على الموقع (مفاتيح المتجر غير مضبوطة). */
  writeBlocked?: string | null;
  onUpdate: () => void;
  onAdd: () => void;
}) {
  const { box, status, linked } = offer;
  const items = box.items ?? [];
  const addReason = offerAddDisabledReason(offer);
  const updateReason = !offer.wooProductId ? "رقم منتج الموقع غير معروف؛ اضغط «تحديث من الموقع» أولاً" : null;
  const diff = offer.primary?.priceDiff ?? null;
  const image = offer.primary?.displayImage ?? box.image_url?.trim() ?? null;

  return (
    <Card className="group rounded-2xl overflow-hidden border bg-card shadow-sm hover:shadow-md transition-all flex flex-col">
      <ProductImageFrame
        imageUrl={image}
        alt={box.name}
        isBox
        dimmed={status === "inactive"}
        topRight={<LinkBadge linked={linked} />}
        topLeft={<OfferStatusChip status={status} />}
      />
      <CardContent className="p-4 flex-1 flex flex-col gap-3">
        <div>
          <h3 className="font-bold text-[15px] leading-snug text-foreground line-clamp-2">{box.name}</h3>
          <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1">
            {linked && offer.wooProductId ? (
              <>
                <span>منتج الموقع</span>
                <bdi dir="ltr">#{offer.wooProductId}</bdi>
                {offer.hiddenOnSite && <span className="text-red-700 font-semibold">· غير ظاهر على الموقع</span>}
                {offer.permalink && (
                  <a href={offer.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold hover:underline" style={{ color: BRAND.primary }}>
                    · فتح في المتجر
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </>
            ) : (
              <>
                <span>موجود في</span> <CocTag /> <span>فقط</span>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-muted/45 p-2.5">
            <div className="text-[11px] text-muted-foreground">
              سعر العرض في <CocTag />
            </div>
            <div className="text-lg font-extrabold" style={{ color: BRAND.deep }}>
              {formatEgp(box.offer_price)}
            </div>
          </div>
          <div className="rounded-xl p-2.5" style={{ background: offer.priceMismatch ? "rgba(243,115,70,0.10)" : "rgba(102,45,140,0.06)" }}>
            <div className="text-[11px] text-muted-foreground">السعر على الموقع</div>
            <div className="text-lg font-extrabold" style={{ color: offer.priceMismatch ? BRAND.accent : BRAND.deep }}>
              {linked ? formatEgp(offer.sitePrice) : "—"}
            </div>
            {offer.priceMismatch && diff !== null && (
              <div className="text-[11px] font-bold" style={{ color: BRAND.accent }}>
                فرق {formatSignedEgp(diff)}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-1.5 text-xs text-muted-foreground">
          <div className="flex items-start gap-1.5">
            <Layers className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {items.length ? (
              <ul className="space-y-0.5 flex-1">
                {items.map((it, i) => (
                  <li key={it.id ?? i} className="flex justify-between gap-2">
                    <span className="text-foreground/85">
                      {it.name}
                      {it.is_gift && (
                        <span className="mr-1 inline-flex items-center gap-0.5 font-bold" style={{ color: BRAND.accent }}>
                          <Gift className="w-3 h-3" />
                          هدية
                        </span>
                      )}
                    </span>
                    <bdi className="whitespace-nowrap font-semibold">{formatPackQty(it.quantity, it.unit)}</bdi>
                  </li>
                ))}
              </ul>
            ) : (
              <span>بدون مكونات مسجّلة</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Truck className="w-3.5 h-3.5 shrink-0" />
            <span>{Number(box.shipping_cost) > 0 ? `الشحن ${formatEgp(box.shipping_cost)} (للعرض فقط)` : "بدون شحن مسجّل"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5 shrink-0" />
            <span>
              {box.expires_at ? (
                <>
                  ينتهي في <bdi dir="ltr">{formatValidityDate(box.expires_at)}</bdi>
                </>
              ) : box.starts_at ? (
                <>
                  يبدأ في <bdi dir="ltr">{formatValidityDate(box.starts_at)}</bdi>
                </>
              ) : (
                "مفتوح بدون مدة"
              )}
            </span>
          </div>
        </div>

        <div className="pt-2 mt-auto flex items-center gap-2">
          {linked ? (
            <Button
              size="sm"
              className="flex-1 min-w-0 gap-2 rounded-xl font-semibold shadow-sm text-white hover:opacity-95"
              style={{ backgroundColor: offer.priceMismatch ? BRAND.accent : BRAND.primary }}
              disabled={!!writeBlocked || !!updateReason}
              title={writeBlocked ?? updateReason ?? undefined}
              onClick={onUpdate}
            >
              <RefreshCw className="w-4 h-4" />
              تحديث العرض على الموقع
            </Button>
          ) : (
            <span className="flex-1" title={writeBlocked ?? addReason ?? undefined}>
              <Button
                size="sm"
                className="w-full gap-2 rounded-xl font-semibold shadow-sm hover:opacity-95"
                style={{ backgroundColor: BRAND.primary }}
                disabled={!!writeBlocked || !!addReason}
                onClick={onAdd}
              >
                <Upload className="w-4 h-4" />
                إضافة إلى الموقع
              </Button>
            </span>
          )}
          {linked && offer.permalink && (
            <Button asChild size="icon" variant="outline" className="h-9 w-9 rounded-xl shrink-0">
              <a href={offer.permalink} target="_blank" rel="noreferrer" aria-label="فتح في المتجر" title="فتح في المتجر">
                <ExternalLink className="w-4 h-4" />
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
