import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Gift, Package } from "lucide-react";

export const BRAND = { primary: "#A4288A", deep: "#662D8C", accent: "#F37346" };

export const CocTag = () => (
  <bdi dir="ltr" className="font-semibold tracking-wide">
    COCEG
  </bdi>
);

export function StatCard({
  icon,
  tint,
  label,
  value,
  sub,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  tint: string;
  label: React.ReactNode;
  value: string;
  sub: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-right rounded-2xl border bg-card p-4 transition-all hover:shadow-md ${
        active ? "ring-2 ring-[#A4288A] border-[#A4288A]/40 shadow-sm" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: tint }}>
          {icon}
        </div>
      </div>
      <div className="text-2xl font-extrabold mt-2" style={{ color: BRAND.deep }}>
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
    </button>
  );
}

export function TypeBadge({ isBox }: { isBox: boolean }) {
  return (
    <Badge className="gap-1 text-white border-0 shadow-sm" style={{ backgroundColor: isBox ? BRAND.deep : BRAND.primary }}>
      {isBox ? <Gift className="w-3 h-3" /> : <Package className="w-3 h-3" />}
      {isBox ? "عرض" : "منتج"}
    </Badge>
  );
}

export function ProductImageFrame({
  imageUrl,
  alt,
  isBox,
  topRight,
  topLeft,
  dimmed,
}: {
  imageUrl: string | null | undefined;
  alt: string;
  isBox: boolean;
  topRight?: React.ReactNode;
  topLeft?: React.ReactNode;
  dimmed?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const showImage = !!imageUrl && !broken;

  return (
    <div className={`relative aspect-square w-full overflow-hidden border-b bg-[#faf7fb] ${dimmed ? "opacity-65" : ""}`}>
      {showImage ? (
        <img
          src={imageUrl!}
          alt={alt}
          loading="lazy"
          onError={() => setBroken(true)}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div
          className="w-full h-full flex flex-col items-center justify-center gap-2.5 p-6 text-center"
          style={{
            background: "linear-gradient(135deg, rgba(164,40,138,0.10) 0%, rgba(102,45,140,0.16) 55%, rgba(243,115,70,0.11) 100%)",
          }}
        >
          <div className="w-16 h-16 rounded-2xl bg-white/85 shadow-sm flex items-center justify-center">
            {isBox ? <Gift className="w-8 h-8" style={{ color: BRAND.deep }} /> : <Package className="w-8 h-8" style={{ color: BRAND.primary }} />}
          </div>
          <span className="text-xs font-medium text-muted-foreground">لا توجد صورة</span>
        </div>
      )}
      {topRight && <div className="absolute top-3 right-3 z-10">{topRight}</div>}
      {topLeft && <div className="absolute top-3 left-3 z-10">{topLeft}</div>}
    </div>
  );
}

export function MiniThumb({ imageUrl, isBox, name }: { imageUrl: string | null | undefined; isBox: boolean; name: string }) {
  const [broken, setBroken] = useState(false);
  if (imageUrl && !broken) {
    return <img src={imageUrl} alt={name} loading="lazy" onError={() => setBroken(true)} className="w-12 h-12 rounded-xl object-cover shrink-0 border" />;
  }
  return (
    <div
      className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border"
      style={{ background: "linear-gradient(135deg, rgba(164,40,138,0.12), rgba(102,45,140,0.18))" }}
    >
      {isBox ? <Gift className="w-5 h-5" style={{ color: BRAND.deep }} /> : <Package className="w-5 h-5" style={{ color: BRAND.primary }} />}
    </div>
  );
}
