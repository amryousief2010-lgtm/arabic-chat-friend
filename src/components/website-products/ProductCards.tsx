import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  BadgePercent,
  CheckCircle2,
  Download,
  Eye,
  ImagePlus,
  PencilLine,
  ScanLine,
  ExternalLink,
  Gift,
  Layers,
  Link2,
  MoreVertical,
  Package,
  ScanBarcode,
  Sparkles,
  Truck,
  Unlink,
  Upload,
} from "lucide-react";
import { WOO_MAP_SUGGESTIONS } from "@/data/wooMapSuggestions";
import {
  type CatalogRow,
  type CocBox,
  type CocMissingItem,
  type CocProduct,
  formatEgp,
  formatNum,
  formatSignedEgp,
  skuState,
  suggestionFor,
  summarizeBoxItems,
} from "@/lib/websiteProducts";
import { BRAND, CocTag, MiniThumb, ProductImageFrame, SkuChip, TypeBadge } from "./shared";

export type Target = { kind: "product" | "offer_box"; id: string };
export type ManageAction = "price" | "image" | "sale" | "visibility" | "sku";

/** زر الصورة على البطاقة: بارز عند غياب أي صورة، ويظهر عند المرور فقط إذا كانت هناك صورة معروضة. */
function ImageButton({ hasImage, shown, onClick }: { hasImage: boolean; shown?: boolean; onClick: () => void }) {
  return hasImage || shown ? (
    <Button
      size="sm"
      variant="secondary"
      className="h-8 rounded-full gap-1.5 bg-white/90 text-[#662D8C] shadow-sm opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
      onClick={onClick}
    >
      <ImagePlus className="w-3.5 h-3.5" />
      {hasImage ? "استبدال الصورة" : "إضافة صورة"}
    </Button>
  ) : (
    <Button size="sm" className="h-8 rounded-full gap-1.5 text-white shadow-md" style={{ backgroundColor: BRAND.primary }} onClick={onClick}>
      <ImagePlus className="w-3.5 h-3.5" />
      إضافة صورة
    </Button>
  );
}

export function SiteProductCard({
  row,
  products,
  boxes,
  onMap,
  onUnmap,
  onPull,
  onPush,
  onImport,
  onManage,
  skuDuplicate,
}: {
  row: CatalogRow;
  products: CocProduct[];
  boxes: CocBox[];
  onMap: (wooId: number, t: Target) => void;
  onUnmap: (wooId: number) => void;
  onPull: (r: CatalogRow) => void;
  onPush: (t: Target, label: string) => void;
  onImport: (as: "product" | "offer_box") => void;
  onManage?: (a: ManageAction, r: CatalogRow) => void;
  skuDuplicate?: boolean;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const s = row.site;
  const isBox = row.kind === "offer_box";
  const sku = skuState(row);
  const cocImage = row.product?.image_url?.trim() || row.box?.image_url?.trim() || null;
  const suggestion = !row.map ? suggestionFor(s.woo_product_id, WOO_MAP_SUGGESTIONS, products) : null;
  const target: Target | null = row.product ? { kind: "product", id: row.product.id } : row.box ? { kind: "offer_box", id: row.box.id } : null;
  const label = row.product?.name ?? row.box?.name ?? "";
  const barcode = row.product?.barcode ?? s.sku ?? null;

  const statusBadge = s.removed_at ? (
    <Badge variant="destructive" className="shadow-sm">
      غير ظاهر بالموقع
    </Badge>
  ) : !row.map ? (
    <Badge className="border-0 text-white shadow-sm" style={{ backgroundColor: BRAND.accent }}>
      غير مربوط
    </Badge>
  ) : row.priceDiff ? (
    <Badge className="border-0 text-white shadow-sm" style={{ backgroundColor: BRAND.accent }}>
      فرق {formatSignedEgp(row.priceDiff)}
    </Badge>
  ) : (
    <Badge className="border-0 bg-emerald-600 text-white gap-1 shadow-sm">
      <CheckCircle2 className="w-3 h-3" />
      مربوط
    </Badge>
  );

  return (
    <Card className="group rounded-2xl overflow-hidden border bg-card shadow-sm hover:shadow-md transition-all flex flex-col">
      <ProductImageFrame
        imageUrl={row.displayImage}
        alt={s.name}
        isBox={isBox}
        dimmed={!!s.removed_at}
        topRight={<TypeBadge isBox={isBox} />}
        topLeft={
          <>
            {statusBadge}
            {s.sale_price !== null && !s.removed_at && (
              <Badge className="border-0 text-white gap-1 shadow-sm" style={{ backgroundColor: BRAND.accent }}>
                <BadgePercent className="w-3 h-3" />
                تخفيض
              </Badge>
            )}
          </>
        }
        bottom={target && onManage ? <ImageButton hasImage={!!cocImage} shown={!!row.displayImage} onClick={() => onManage("image", row)} /> : undefined}
      />

      <CardContent className="p-4 flex-1 flex flex-col gap-3">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-bold text-[15px] leading-snug text-foreground line-clamp-2">
              {s.permalink ? (
                <a href={s.permalink} target="_blank" rel="noreferrer" className="hover:text-[#662D8C] transition-colors">
                  {s.name}
                </a>
              ) : (
                s.name
              )}
            </h3>
            {s.permalink && (
              <a href={s.permalink} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-[#662D8C] shrink-0 mt-0.5" title="فتح في المتجر">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            رقم الموقع: <bdi dir="ltr">#{s.woo_product_id}</bdi>
          </div>
        </div>

        <div className="rounded-xl bg-muted/45 p-2.5 space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground">سعر الموقع</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-extrabold" style={{ color: BRAND.deep }}>
                {formatEgp(s.price)}
              </span>
              {s.sale_price !== null && s.regular_price !== null && (
                <span className="text-xs text-muted-foreground line-through">{formatEgp(s.regular_price)}</span>
              )}
            </div>
          </div>

          {row.map && (
            <div className="flex items-baseline justify-between gap-2 border-t border-border/60 pt-1.5">
              <span className="text-xs text-muted-foreground">
                سعر <CocTag />
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-foreground">{formatEgp(row.cocPrice)}</span>
                {!!row.priceDiff && (
                  <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md text-white" style={{ backgroundColor: BRAND.accent }}>
                    {formatSignedEgp(row.priceDiff)}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-1.5 text-xs text-muted-foreground">
          {row.map ? (
            <div className="flex items-center gap-1.5 font-medium" style={{ color: BRAND.deep }}>
              <Link2 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">مربوط بـ: {label || "—"}</span>
            </div>
          ) : (
            <div className="space-y-2 pt-0.5">
              {suggestion && (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-amber-900">
                  <span className="inline-flex items-center gap-1 truncate">
                    <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: BRAND.accent }} />
                    <span className="truncate">
                      اقتراح: {suggestion.product.name} ({formatNum(Math.round(suggestion.confidence * 100))}%)
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs font-bold shrink-0"
                    style={{ color: BRAND.primary }}
                    onClick={() => onMap(s.woo_product_id, { kind: "product", id: suggestion.product.id })}
                  >
                    اعتماد
                  </Button>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <Select value={choice ?? undefined} onValueChange={setChoice}>
                  <SelectTrigger className="h-8 text-xs rounded-xl flex-1">
                    <SelectValue placeholder="اختر منتجاً أو عرضاً للربط" />
                  </SelectTrigger>
                  <SelectContent>
                    {boxes.map((b) => (
                      <SelectItem key={`b:${b.id}`} value={`b:${b.id}`}>
                        عرض: {b.name}
                        {b.is_active ? "" : " (غير نشط)"}
                      </SelectItem>
                    ))}
                    {products.map((p) => (
                      <SelectItem key={`p:${p.id}`} value={`p:${p.id}`}>
                        {p.name}
                        {p.is_active ? "" : " (غير نشط)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-xl shrink-0"
                  disabled={!choice}
                  onClick={() => {
                    if (!choice) return;
                    const [k, id] = choice.split(":");
                    onMap(s.woo_product_id, { kind: k === "b" ? "offer_box" : "product", id });
                  }}
                >
                  ربط
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <Truck className="w-3.5 h-3.5 shrink-0" />
            <span>
              {row.box
                ? row.box.shipping_cost
                  ? `شحن ${formatEgp(row.box.shipping_cost)} ضمن السعر · مجاني على الموقع`
                  : "بدون شحن مسجّل · مجاني على الموقع"
                : "شحن المتجر القياسي"}
            </span>
          </div>

          {row.product ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <ScanBarcode className="w-3.5 h-3.5 shrink-0" />
                <span>
                  <CocTag />: {row.product.barcode ? <bdi dir="ltr">{row.product.barcode}</bdi> : "—"}
                </span>
                <span className="text-muted-foreground/60">·</span>
                <span>
                  الموقع: {s.sku ? <bdi dir="ltr">{s.sku}</bdi> : "فارغ"}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <SkuChip state={sku} duplicate={skuDuplicate} />
                {sku === "mismatch" && onManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px] font-bold gap-1"
                    style={{ color: BRAND.primary }}
                    disabled={skuDuplicate}
                    onClick={() => onManage("sku", row)}
                  >
                    <ScanLine className="w-3.5 h-3.5" />
                    مطابقة الكود
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <ScanBarcode className="w-3.5 h-3.5 shrink-0" />
              <span>{barcode ? <bdi dir="ltr">{barcode}</bdi> : row.box ? "العروض بلا باركود" : "بدون باركود"}</span>
            </div>
          )}

          {row.box && (
            <div className="flex items-start gap-1.5">
              <Layers className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="line-clamp-2">{summarizeBoxItems(row.box.items ?? [])}</span>
            </div>
          )}
        </div>

        <div className="pt-2 mt-auto flex items-center gap-2">
          {target ? (
            <Button
              size="sm"
              className="flex-1 gap-1.5 rounded-xl"
              variant={row.priceDiff || row.box ? "default" : "outline"}
              style={row.priceDiff || row.box ? { backgroundColor: BRAND.primary } : undefined}
              onClick={() => onPush(target, label)}
            >
              <Upload className="w-3.5 h-3.5" />
              {row.box ? "تحديث العرض على الموقع" : row.priceDiff ? "تحديث سعر الموقع" : "مزامنة إلى الموقع"}
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="flex-1 gap-1.5 rounded-xl" disabled={!!s.removed_at} onClick={() => onImport("product")}>
              <Download className="w-3.5 h-3.5" />
              <span>
                استيراد إلى <CocTag />
              </span>
            </Button>
          )}

          <DropdownMenu dir="rtl">
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="outline" className="h-9 w-9 rounded-xl shrink-0" aria-label="إجراءات إضافية">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              {target && onManage && (
                <>
                  <DropdownMenuItem className="gap-2" onSelect={() => onManage("price", row)}>
                    <PencilLine className="w-4 h-4" />
                    <span>تعديل السعر</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="gap-2" onSelect={() => onManage("sale", row)}>
                    <BadgePercent className="w-4 h-4" />
                    <span>{s.sale_price !== null ? "تعديل التخفيض على الموقع" : "تخفيض على الموقع"}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="gap-2" onSelect={() => onManage("visibility", row)}>
                    <Eye className="w-4 h-4" />
                    <span>الظهور على الموقع</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="gap-2" onSelect={() => onManage("image", row)}>
                    <ImagePlus className="w-4 h-4" />
                    <span>{cocImage ? "استبدال الصورة" : "إضافة صورة"}</span>
                  </DropdownMenuItem>
                  {row.product && (
                    <DropdownMenuItem className="gap-2" disabled={sku !== "mismatch" || skuDuplicate} onSelect={() => onManage("sku", row)}>
                      <ScanLine className="w-4 h-4" />
                      <span>مطابقة الكود</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                </>
              )}
              {target && row.product && (
                <DropdownMenuItem className="gap-2" onSelect={() => onPull(row)}>
                  <Download className="w-4 h-4" />
                  <span>
                    سحب السعر إلى <CocTag />
                  </span>
                </DropdownMenuItem>
              )}
              {target && (
                <DropdownMenuItem className="gap-2" onSelect={() => onPush(target, label)}>
                  <Upload className="w-4 h-4" />
                  <span>
                    تحديث الموقع من <CocTag />
                  </span>
                </DropdownMenuItem>
              )}
              {row.map && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onSelect={() => onUnmap(s.woo_product_id)}>
                    <Unlink className="w-4 h-4" />
                    <span>فك الربط</span>
                  </DropdownMenuItem>
                </>
              )}
              {!row.map && !s.removed_at && (
                <>
                  <DropdownMenuItem className="gap-2" onSelect={() => onImport("product")}>
                    <Package className="w-4 h-4" />
                    <span>
                      استيراد كمنتج إلى <CocTag />
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="gap-2" onSelect={() => onImport("offer_box")}>
                    <Gift className="w-4 h-4" />
                    <span>
                      استيراد كعرض إلى <CocTag />
                    </span>
                  </DropdownMenuItem>
                </>
              )}
              {s.permalink && (
                <DropdownMenuItem asChild>
                  <a href={s.permalink} target="_blank" rel="noreferrer" className="gap-2 flex items-center">
                    <ExternalLink className="w-4 h-4" />
                    <span>فتح في المتجر</span>
                  </a>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}

export function CocMissingCard({
  item,
  onPush,
  onManage,
}: {
  item: CocMissingItem;
  onPush: () => void;
  onManage?: (a: "price" | "image", item: CocMissingItem) => void;
}) {
  const isBox = item.kind === "offer_box";
  const ready = (item.price ?? 0) > 0 && (!isBox || item.items.length > 0);

  return (
    <Card className="group rounded-2xl overflow-hidden border bg-card shadow-sm hover:shadow-md transition-all flex flex-col">
      <ProductImageFrame
        imageUrl={item.image_url}
        alt={item.name}
        isBox={isBox}
        bottom={onManage ? <ImageButton hasImage={!!item.image_url} onClick={() => onManage("image", item)} /> : undefined}
        topRight={<TypeBadge isBox={isBox} />}
        topLeft={
          ready ? (
            <Badge className="border-0 bg-emerald-600 text-white gap-1 shadow-sm">
              <CheckCircle2 className="w-3 h-3" />
              جاهز للنشر
            </Badge>
          ) : (
            <Badge className="border-0 text-white shadow-sm" style={{ backgroundColor: BRAND.accent }}>
              بيانات ناقصة
            </Badge>
          )
        }
      />

      <CardContent className="p-4 flex-1 flex flex-col gap-3">
        <div>
          <h3 className="font-bold text-[15px] leading-snug text-foreground line-clamp-2">{item.name}</h3>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            غير موجود على الموقع · من <CocTag />
          </div>
        </div>

        <div className="rounded-xl bg-muted/45 p-2.5 flex items-baseline justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            السعر في <CocTag />
          </span>
          <span className="text-xl font-extrabold" style={{ color: BRAND.deep }}>
            {formatEgp(item.price)}
          </span>
        </div>

        <div className="space-y-1.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Truck className="w-3.5 h-3.5 shrink-0" />
            <span>
              {isBox
                ? item.shipping_cost
                  ? `شحن ${formatEgp(item.shipping_cost)} ضمن السعر · مجاني على الموقع`
                  : "بدون شحن مسجّل · مجاني على الموقع"
                : "يُطبَّق شحن المتجر عند النشر"}
            </span>
          </div>

          {!isBox && (
            <div className="flex items-center gap-1.5">
              <ScanBarcode className="w-3.5 h-3.5 shrink-0" />
              <span>{item.barcode ? <bdi dir="ltr">{item.barcode}</bdi> : "—"}</span>
              {!/^622400320\d{4}$/.test(item.barcode ?? "") && <SkuChip state="pending" />}
            </div>
          )}

          {isBox && (
            <div className="flex items-start gap-1.5">
              <Layers className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="line-clamp-2">{summarizeBoxItems(item.items)}</span>
            </div>
          )}
        </div>

        <div className="pt-2 mt-auto flex items-center gap-2">
          <Button
            size="sm"
            className="flex-1 gap-2 rounded-xl font-semibold shadow-sm hover:opacity-95"
            style={{ backgroundColor: BRAND.primary }}
            onClick={onPush}
          >
            <Upload className="w-4 h-4" />
            إضافة إلى الموقع
          </Button>
          {onManage && (
            <DropdownMenu dir="rtl">
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="outline" className="h-9 w-9 rounded-xl shrink-0" aria-label="إجراءات إضافية">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuItem className="gap-2" onSelect={() => onManage("price", item)}>
                  <PencilLine className="w-4 h-4" />
                  <span>تعديل السعر</span>
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" onSelect={() => onManage("image", item)}>
                  <ImagePlus className="w-4 h-4" />
                  <span>{item.image_url ? "استبدال الصورة" : "إضافة صورة"}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function SiteTableRow({
  row,
  products,
  boxes,
  onMap,
  onUnmap,
  onPull,
  onPush,
  onImport,
  onManage,
  skuDuplicate,
}: {
  row: CatalogRow;
  products: CocProduct[];
  boxes: CocBox[];
  onMap: (wooId: number, t: Target) => void;
  onUnmap: (wooId: number) => void;
  onPull: (r: CatalogRow) => void;
  onPush: (t: Target, label: string) => void;
  onImport: (as: "product" | "offer_box") => void;
  onManage?: (a: ManageAction, r: CatalogRow) => void;
  skuDuplicate?: boolean;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const s = row.site;
  const suggestion = !row.map ? suggestionFor(s.woo_product_id, WOO_MAP_SUGGESTIONS, products) : null;
  const target: Target | null = row.product ? { kind: "product", id: row.product.id } : row.box ? { kind: "offer_box", id: row.box.id } : null;
  const label = row.product?.name ?? row.box?.name ?? "";

  return (
    <TableRow className={s.removed_at ? "opacity-60" : undefined}>
      <TableCell>
        <div className="flex items-center gap-3">
          <MiniThumb imageUrl={row.displayImage} isBox={row.kind === "offer_box"} name={s.name} />
          <div>
            <div className="font-semibold">
              {s.permalink ? (
                <a href={s.permalink} target="_blank" rel="noreferrer" className="hover:underline">
                  {s.name}
                </a>
              ) : (
                s.name
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              <bdi dir="ltr">#{s.woo_product_id}</bdi>
              {s.sku && (
                <>
                  {" · "}
                  <bdi dir="ltr">{s.sku}</bdi>
                </>
              )}
            </div>
            {row.product && (
              <div className="mt-1">
                <SkuChip state={skuState(row)} duplicate={skuDuplicate} />
              </div>
            )}
            {s.removed_at && (
              <Badge variant="destructive" className="mt-1">
                غير ظاهر بالموقع
              </Badge>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap font-bold" style={{ color: BRAND.deep }}>
        {formatEgp(s.price)}
        {s.sale_price !== null && s.regular_price !== null && (
          <div className="text-xs text-muted-foreground line-through font-normal">{formatEgp(s.regular_price)}</div>
        )}
      </TableCell>
      <TableCell className="min-w-64">
        {row.map ? (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="gap-1" style={{ borderColor: BRAND.deep, color: BRAND.deep }}>
              <Link2 className="w-3 h-3" />
              {row.box ? "عرض: " : "منتج: "}
              {label || "—"}
            </Badge>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
              onClick={() => onUnmap(s.woo_product_id)}
            >
              <Unlink className="w-3 h-3" />
              فك
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            {suggestion && (
              <div className="flex items-center gap-2 text-xs">
                <Sparkles className="w-3 h-3" style={{ color: BRAND.accent }} />
                اقتراح: {suggestion.product.name} ({formatNum(Math.round(suggestion.confidence * 100))}%)
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => onMap(s.woo_product_id, { kind: "product", id: suggestion.product.id })}>
                  اعتماد
                </Button>
              </div>
            )}
            <div className="flex items-center gap-1">
              <Select value={choice ?? undefined} onValueChange={setChoice}>
                <SelectTrigger className="h-8 w-52 rounded-xl">
                  <SelectValue placeholder="ربط بمنتج أو عرض" />
                </SelectTrigger>
                <SelectContent>
                  {boxes.map((b) => (
                    <SelectItem key={`b:${b.id}`} value={`b:${b.id}`}>
                      عرض: {b.name}
                      {b.is_active ? "" : " (غير نشط)"}
                    </SelectItem>
                  ))}
                  {products.map((p) => (
                    <SelectItem key={`p:${p.id}`} value={`p:${p.id}`}>
                      {p.name}
                      {p.is_active ? "" : " (غير نشط)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl"
                disabled={!choice}
                onClick={() => {
                  if (!choice) return;
                  const [k, id] = choice.split(":");
                  onMap(s.woo_product_id, { kind: k === "b" ? "offer_box" : "product", id });
                }}
              >
                ربط
              </Button>
            </div>
          </div>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {formatEgp(row.cocPrice)}
        {!!row.priceDiff && (
          <div>
            <Badge variant="outline" className="border-amber-500 text-amber-700">
              فرق {formatSignedEgp(row.priceDiff)}
            </Badge>
          </div>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1.5">
          {target && onManage && (
            <>
              <Button size="sm" variant="outline" className="gap-1 rounded-xl" onClick={() => onManage("price", row)}>
                <PencilLine className="w-3.5 h-3.5" />
                السعر
              </Button>
              <Button size="sm" variant="outline" className="gap-1 rounded-xl" onClick={() => onManage("image", row)}>
                <ImagePlus className="w-3.5 h-3.5" />
                الصورة
              </Button>
              {skuState(row) === "mismatch" && !skuDuplicate && (
                <Button size="sm" variant="outline" className="gap-1 rounded-xl" onClick={() => onManage("sku", row)}>
                  <ScanLine className="w-3.5 h-3.5" />
                  مطابقة الكود
                </Button>
              )}
            </>
          )}
          {target && (row.priceDiff || row.box) && (
            <Button size="sm" variant="outline" className="gap-1 rounded-xl" onClick={() => onPush(target, label)}>
              <Upload className="w-3.5 h-3.5" />
              {row.box ? "تحديث العرض" : "تحديث الموقع"}
            </Button>
          )}
          {row.product && !!row.priceDiff && (
            <Button size="sm" variant="outline" className="gap-1 rounded-xl" onClick={() => onPull(row)}>
              <Download className="w-3.5 h-3.5" />
              <span>
                إلى <CocTag />
              </span>
            </Button>
          )}
          {!row.map && !s.removed_at && (
            <>
              <Button size="sm" variant="ghost" className="gap-1 rounded-xl" onClick={() => onImport("product")}>
                <Package className="w-3.5 h-3.5" />
                استيراد منتج
              </Button>
              <Button size="sm" variant="ghost" className="gap-1 rounded-xl" onClick={() => onImport("offer_box")}>
                <Gift className="w-3.5 h-3.5" />
                استيراد عرض
              </Button>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
