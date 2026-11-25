import { useCallback, useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowUpDown,
  CheckCircle2,
  LayoutGrid,
  List,
  PackagePlus,
  RefreshCw,
  ScanBarcode,
  ScanLine,
  Search,
  Store,
  Truck,
  Unlink,
  Upload,
} from "lucide-react";
import {
  type BoxItemSummary,
  type CatalogRow,
  type CocBox,
  type CocProduct,
  type MapRow,
  type SiteProduct,
  type SiteStatusFilter,
  type SortKey,
  type TypeFilter,
  buildCatalogRows,
  buildMissingItems,
  duplicateSiteSkus,
  skuState,
  skuWouldDuplicate,
  type CocMissingItem,
  cocNotOnSite,
  filterAndSortMissing,
  filterAndSortSiteRows,
  formatCairoLatn,
  formatEgp,
  formatNum,
  summarizeBoxItems,
  syncErrorMessage,
} from "@/lib/websiteProducts";
import { BRAND, CocTag, MiniThumb, StatCard, TypeBadge } from "@/components/website-products/shared";
import { CocMissingCard, type ManageAction, SiteProductCard, SiteTableRow, type Target } from "@/components/website-products/ProductCards";
import { ImageDialog, type ManageCtx, PriceEditDialog, SaleDialog, VisibilityDialog, previewSiteEdit } from "@/components/website-products/ManageDialogs";
import { type Change, ImportDialog, PreviewDialog, type PreviewState } from "@/components/website-products/Dialogs";
import { callSync } from "@/components/website-products/sync";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface LogRow {
  id: string;
  action: string;
  direction: string | null;
  woo_product_id: number | null;
  status: string;
  error: string | null;
  before: unknown;
  after: unknown;
  created_at: string;
  actor: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  refresh: "تحديث من الموقع",
  map: "ربط",
  unmap: "فك ربط",
  import_to_coc: "استيراد إلى النظام",
  pull_price: "سحب سعر من الموقع",
  push_create: "إضافة إلى الموقع",
  push_update: "تحديث على الموقع",
  coc_price: "تعديل سعر منتج في COCEG",
  coc_box_price: "تعديل سعر عرض في COCEG",
  coc_image: "صورة في COCEG",
  site_price: "سعر على الموقع",
  site_sale: "تخفيض على الموقع",
  site_visibility: "الظهور على الموقع",
  site_sku: "مطابقة الكود على الموقع",
  site_image: "صورة على الموقع",
};

export default function WebsiteProducts() {
  const [site, setSite] = useState<SiteProduct[]>([]);
  const [maps, setMaps] = useState<MapRow[]>([]);
  const [products, setProducts] = useState<CocProduct[]>([]);
  const [boxes, setBoxes] = useState<CocBox[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [keysConfigured, setKeysConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [tab, setTab] = useState<"site" | "coc" | "log">("site");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<SiteStatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name_asc");

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [manage, setManage] = useState<{ action: "price" | "image" | "sale" | "visibility"; ctx: ManageCtx; vis?: "publish_visible" | "publish_hidden" | "draft" } | null>(null);
  const [importTarget, setImportTarget] = useState<{ site: SiteProduct; as: "product" | "offer_box" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, m, p, b, bi, l] = await Promise.all([
      db.from("woo_site_products").select("woo_product_id, woo_variation_id, name, sku, price, regular_price, sale_price, permalink, image_url, removed_at").order("name"),
      db.from("woo_product_map").select("woo_product_id, woo_variation_id, kind, product_id, offer_box_id"),
      db.from("products").select("id, name, price, barcode, image_url, is_active").order("name"),
      db.from("offer_boxes").select("id, name, offer_price, shipping_cost, is_active, image_url").order("name"),
      db.from("offer_box_items").select("id, offer_box_id, quantity, is_gift, custom_price, created_at, products(name)").order("created_at"),
      db.from("woo_sync_log").select("*").order("created_at", { ascending: false }).limit(100),
    ]);
    if (s.error) toast.error("تعذّر تحميل منتجات الموقع");
    const num = (r: Record<string, unknown>) => ({ ...r, woo_product_id: Number(r.woo_product_id), woo_variation_id: Number(r.woo_variation_id) });

    const boxItemsMap = new Map<string, BoxItemSummary[]>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const item of (bi.data ?? []) as any[]) {
      const boxId = String(item.offer_box_id ?? "");
      if (!boxId) continue;
      const arr = boxItemsMap.get(boxId) ?? [];
      arr.push({
        id: item.id,
        name: item.products?.name ?? "منتج",
        quantity: Number(item.quantity ?? 1),
        is_gift: !!item.is_gift,
        custom_price: item.custom_price === null || item.custom_price === undefined ? null : Number(item.custom_price),
      });
      boxItemsMap.set(boxId, arr);
    }

    setSite((s.data ?? []).map(num));
    setMaps((m.data ?? []).map(num));
    setProducts(p.data ?? []);
    setBoxes(((b.data ?? []) as CocBox[]).map((bx) => ({ ...bx, items: boxItemsMap.get(bx.id) ?? [] })));
    setLogs(l.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    callSync<{ keys_configured: boolean }>({ action: "status" }).then(({ data }) => setKeysConfigured(data?.keys_configured ?? null));
  }, [load]);

  const rows = useMemo(() => buildCatalogRows(site, maps, products, boxes), [site, maps, products, boxes]);
  const shownSite = useMemo(
    () => filterAndSortSiteRows(rows, { query, type: typeFilter, status: statusFilter, sort: sortKey }),
    [rows, query, typeFilter, statusFilter, sortKey],
  );
  const missing = useMemo(() => cocNotOnSite(products, boxes, maps), [products, boxes, maps]);
  const missingAll = useMemo(() => buildMissingItems(missing.products, missing.boxes), [missing]);
  const shownMissing = useMemo(
    () => filterAndSortMissing(missingAll, { query, type: typeFilter, sort: sortKey }),
    [missingAll, query, typeFilter, sortKey],
  );

  const dupSkus = useMemo(() => duplicateSiteSkus(site), [site]);
  const skuMismatchCount = rows.filter((r) => !r.site.removed_at && skuState(r) === "mismatch").length;

  useEffect(() => {
    // شارة الإصدار تصبح نقطة صغيرة في هذه الشاشة حتى لا تغطي أسعار البطاقات.
    document.body.dataset.versionBadge = "compact";
    return () => {
      delete document.body.dataset.versionBadge;
    };
  }, []);

  const ctxFromRow = (r: CatalogRow): ManageCtx => ({
    kind: r.box ? "offer_box" : "product",
    id: (r.box?.id ?? r.product?.id)!,
    name: r.box?.name ?? r.product?.name ?? r.site.name,
    cocPrice: r.cocPrice,
    shipping: r.box?.shipping_cost ?? null,
    items: r.box?.items ?? [],
    imageUrl: r.product?.image_url?.trim() || r.box?.image_url?.trim() || null,
    wooId: r.site.woo_product_id,
    siteName: r.site.name,
    siteRegular: r.site.regular_price ?? r.site.price,
    siteSale: r.site.sale_price,
    siteImage: r.site.image_url ?? null,
  });
  const ctxFromMissing = (it: CocMissingItem): ManageCtx => ({
    kind: it.kind,
    id: it.id,
    name: it.name,
    cocPrice: it.price,
    shipping: it.shipping_cost,
    items: it.items,
    imageUrl: it.image_url,
    wooId: null,
    siteRegular: null,
    siteSale: null,
    siteImage: null,
  });

  const onManageRow = (a: ManageAction, r: CatalogRow) => {
    if (!r.product && !r.box) return;
    if (a === "sku") {
      if (skuWouldDuplicate(r, site)) return void toast.error(syncErrorMessage("duplicate_sku"));
      return void previewSiteEdit(r.site.woo_product_id, { kind: "sku" }, `مطابقة كود «${r.site.name}» مع COCEG`, "تأكيد مطابقة الكود", setPreview, load);
    }
    setManage({ action: a, ctx: ctxFromRow(r), vis: r.site.removed_at ? "draft" : "publish_visible" });
  };

  const activeSiteCount = rows.filter((r) => !r.site.removed_at).length;
  const unmappedCount = rows.filter((r) => !r.map && !r.site.removed_at).length;
  const diffCount = rows.filter((r) => !!r.priceDiff).length;
  const missingCount = missingAll.length;

  const refresh = async () => {
    setRefreshing(true);
    const { data, error } = await callSync<{ count: number }>({ action: "refresh" });
    setRefreshing(false);
    if (error) return toast.error(syncErrorMessage(error));
    toast.success(`تم تحديث ${formatNum(data?.count ?? 0)} منتجاً من الموقع`);
    void load();
  };

  const map = async (wooId: number, t: Target) => {
    const { error } = await db.rpc("woo_catalog_map", {
      _woo_product_id: wooId,
      _woo_variation_id: 0,
      _product_id: t.kind === "product" ? t.id : null,
      _offer_box_id: t.kind === "offer_box" ? t.id : null,
    });
    if (error) return toast.error(syncErrorMessage(error.message));
    toast.success("تم الربط بنجاح");
    void load();
  };

  const unmap = async (wooId: number) => {
    const reason = window.prompt("سبب فك الربط (3 أحرف على الأقل):") ?? "";
    if (!reason.trim()) return;
    const { error } = await db.rpc("woo_catalog_unmap", { _woo_product_id: wooId, _woo_variation_id: 0, _reason: reason });
    if (error) return toast.error(syncErrorMessage(error.message));
    toast.success("تم فك الربط");
    void load();
  };

  const openPush = async (mode: "create" | "update", target: Target, wooId: number | null, label: string) => {
    const body = { mode, target, woo_product_id: wooId };
    const { data, error } = await callSync<{ changes: Change[]; warnings: string[]; token: string; keys_configured: boolean }>({ action: "preview", ...body });
    if (error || !data) return toast.error(syncErrorMessage(error));
    setPreview({
      title: mode === "create" ? `إضافة «${label}» إلى الموقع` : `تحديث «${label}» على الموقع`,
      changes: data.changes,
      warnings: data.warnings,
      confirmLabel: mode === "create" ? "تأكيد الإضافة إلى الموقع" : "تأكيد التحديث على الموقع",
      blocked: data.keys_configured ? (data.changes.length ? null : "لا توجد فروق") : syncErrorMessage("woo_keys_missing"),
      onConfirm: async () => {
        const r = await callSync<{ warning?: string }>({ action: "apply", ...body, token: data.token });
        if (r.error) return void toast.error(syncErrorMessage(r.error));
        toast.success(r.data?.warning === "created_not_mapped" ? "أُضيف إلى الموقع، ويُرجى ربطه يدوياً" : "تم التنفيذ على الموقع");
        setPreview(null);
        void load();
      },
    });
  };

  const openPull = (r: CatalogRow) => {
    if (!r.product) return;
    setPreview({
      title: `تحديث سعر «${r.product.name}» في النظام من الموقع`,
      changes: [{ field: "regular_price", before: r.cocPrice === null ? null : String(r.cocPrice), after: String(r.site.price) }],
      warnings: [],
      confirmLabel: "تأكيد تحديث السعر في النظام",
      blocked: null,
      onConfirm: async () => {
        const { error } = await db.rpc("woo_catalog_pull_price", {
          _woo_product_id: r.site.woo_product_id,
          _woo_variation_id: 0,
          _expected_coc_price: r.cocPrice,
          _expected_site_price: r.site.price,
        });
        if (error) return void toast.error(syncErrorMessage(error.message));
        toast.success("تم تحديث السعر في النظام");
        setPreview(null);
        void load();
      },
    });
  };

  return (
    <DashboardLayout>
      <div dir="rtl" className="font-cairo space-y-6 text-right pb-16 md:pl-16">
        <div className="space-y-3">
          <div className="[&>header]:mb-0">
            <Header
              title="منتجات الموقع"
              subtitle="مطابقة منتجات وعروض المتجر الإلكتروني مع النظام، وإدارة الأسعار والإضافة في الاتجاهين بعد المعاينة"
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={refresh} disabled={refreshing} style={{ backgroundColor: BRAND.primary }} className="gap-2 rounded-xl px-5 shadow-sm hover:opacity-95">
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              تحديث من الموقع
            </Button>
          </div>
        </div>

        {keysConfigured === false && (
          <Card className="border-amber-300 bg-amber-50/70 rounded-2xl">
            <CardContent className="p-4 text-sm flex items-center gap-2.5 text-amber-900">
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
              <span>
                الكتابة على الموقع متوقفة حتى ضبط مفاتيح المتجر؛ القراءة والمطابقة والاستيراد إلى <CocTag /> متاحة بالكامل.
              </span>
            </CardContent>
          </Card>
        )}

        {skuMismatchCount > 0 && (
          <button
            type="button"
            onClick={() => { setTab("site"); setStatusFilter("sku_mismatch"); }}
            className="w-full text-right rounded-2xl border border-red-200 bg-red-50/70 p-3.5 text-sm flex items-center gap-2.5 text-red-800 hover:bg-red-50"
          >
            <ScanLine className="w-5 h-5 shrink-0" />
            <span className="flex-1">
              {formatNum(skuMismatchCount)} منتج كوده على الموقع غير مطابق لباركود <CocTag />. اضغطي للعرض ثم «مطابقة الكود» (<CocTag /> هو المصدر).
            </span>
          </button>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<Store className="w-5 h-5" style={{ color: BRAND.deep }} />}
            tint="rgba(102, 45, 140, 0.10)"
            label="منتجات الموقع"
            value={formatNum(activeSiteCount)}
            sub={`مربوط: ${formatNum(activeSiteCount - unmappedCount)}`}
            active={tab === "site" && statusFilter === "all"}
            onClick={() => { setTab("site"); setStatusFilter("all"); }}
          />
          <StatCard
            icon={<Unlink className="w-5 h-5" style={{ color: BRAND.accent }} />}
            tint="rgba(243, 115, 70, 0.12)"
            label="بانتظار المطابقة"
            value={formatNum(unmappedCount)}
            sub="اضغط للعرض"
            active={tab === "site" && statusFilter === "unmapped"}
            onClick={() => { setTab("site"); setStatusFilter("unmapped"); }}
          />
          <StatCard
            icon={<ArrowLeftRight className="w-5 h-5" style={{ color: BRAND.primary }} />}
            tint="rgba(164, 40, 138, 0.12)"
            label="فروق الأسعار"
            value={formatNum(diffCount)}
            sub="بحاجة لمراجعة الاتجاه"
            active={tab === "site" && statusFilter === "diff"}
            onClick={() => { setTab("site"); setStatusFilter("diff"); }}
          />
          <StatCard
            icon={<PackagePlus className="w-5 h-5" style={{ color: BRAND.deep }} />}
            tint="rgba(102, 45, 140, 0.10)"
            label={<span>في <CocTag /> وليست على الموقع</span>}
            value={formatNum(missingCount)}
            sub={`${formatNum(missing.boxes.length)} عرض · ${formatNum(missing.products.length)} منتج`}
            active={tab === "coc"}
            onClick={() => setTab("coc")}
          />
        </div>

        <Tabs dir="rtl" value={tab} onValueChange={(v) => setTab(v as "site" | "coc" | "log")} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList className="h-auto flex-wrap p-1 rounded-xl bg-muted/80">
              <TabsTrigger value="site" className="rounded-lg px-4 py-2 gap-1.5">
                <Store className="w-4 h-4" />
                <span>منتجات الموقع</span>
                <Badge variant="secondary" className="text-[11px] px-1.5 py-0">{formatNum(activeSiteCount)}</Badge>
              </TabsTrigger>
              <TabsTrigger value="coc" className="rounded-lg px-4 py-2 gap-1.5">
                <PackagePlus className="w-4 h-4" />
                <span>في <CocTag /> وليست على الموقع</span>
                <Badge variant="secondary" className="text-[11px] px-1.5 py-0">{formatNum(missingCount)}</Badge>
              </TabsTrigger>
              <TabsTrigger value="log" className="rounded-lg px-4 py-2 gap-1.5">
                <ArrowLeftRight className="w-4 h-4" />
                <span>سجل المزامنة</span>
              </TabsTrigger>
            </TabsList>

            {tab !== "log" && (
              <div className="flex items-center gap-1 rounded-xl border bg-card p-1">
                <Button type="button" size="sm" variant={viewMode === "grid" ? "default" : "ghost"}
                  style={viewMode === "grid" ? { backgroundColor: BRAND.deep } : undefined}
                  className="h-8 px-2.5 gap-1.5 rounded-lg" onClick={() => setViewMode("grid")} aria-label="عرض شبكي">
                  <LayoutGrid className="w-4 h-4" />
                  <span className="hidden sm:inline text-xs">شبكة</span>
                </Button>
                <Button type="button" size="sm" variant={viewMode === "list" ? "default" : "ghost"}
                  style={viewMode === "list" ? { backgroundColor: BRAND.deep } : undefined}
                  className="h-8 px-2.5 gap-1.5 rounded-lg" onClick={() => setViewMode("list")} aria-label="عرض قائمة">
                  <List className="w-4 h-4" />
                  <span className="hidden sm:inline text-xs">قائمة</span>
                </Button>
              </div>
            )}
          </div>

          {tab !== "log" && (
            <Card className="rounded-2xl border bg-card/80">
              <CardContent className="p-3.5 flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="w-4 h-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم أو الباركود أو رقم المنتج..." className="pr-9 rounded-xl" />
                </div>
                <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
                  <SelectTrigger className="w-40 rounded-xl"><SelectValue placeholder="النوع" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الأنواع</SelectItem>
                    <SelectItem value="offer_box">عروض وبوكسات</SelectItem>
                    <SelectItem value="product">منتجات منفردة</SelectItem>
                  </SelectContent>
                </Select>
                {tab === "site" && (
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as SiteStatusFilter)}>
                    <SelectTrigger className="w-44 rounded-xl"><SelectValue placeholder="الحالة" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">كل الحالات</SelectItem>
                      <SelectItem value="unmapped">غير مربوط</SelectItem>
                      <SelectItem value="mapped">مربوط</SelectItem>
                      <SelectItem value="diff">فروق أسعار</SelectItem>
                      <SelectItem value="removed">غير ظاهر بالموقع</SelectItem>
                      <SelectItem value="sku_mismatch">الكود غير مطابق</SelectItem>
                      <SelectItem value="no_image">بدون صورة</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                  <SelectTrigger className="w-48 rounded-xl">
                    <ArrowUpDown className="w-3.5 h-3.5 ml-1.5 text-muted-foreground" />
                    <SelectValue placeholder="الترتيب" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name_asc">الاسم (أ - ي)</SelectItem>
                    <SelectItem value="price_desc">السعر: من الأعلى</SelectItem>
                    <SelectItem value="price_asc">السعر: من الأقل</SelectItem>
                    {tab === "site" && <SelectItem value="diff_desc">أكبر فرق سعر</SelectItem>}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          )}

          <TabsContent value="site" className="space-y-4">
            {!loading && site.length === 0 ? (
              <Card className="rounded-2xl"><CardContent className="py-12 text-center text-muted-foreground space-y-2">
                <Store className="w-10 h-10 mx-auto opacity-40" />
                <p>لا توجد نسخة من منتجات الموقع بعد. اضغط «تحديث من الموقع» لجلبها.</p>
              </CardContent></Card>
            ) : shownSite.length === 0 ? (
              <Card className="rounded-2xl"><CardContent className="py-10 text-center text-muted-foreground">لا توجد نتائج مطابقة للبحث أو التصفية الحالية</CardContent></Card>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {shownSite.map((r) => (
                  <SiteProductCard key={`${r.site.woo_product_id}-${r.site.woo_variation_id}`} row={r} products={products} boxes={boxes}
                    onMap={map} onUnmap={unmap} onPull={openPull}
                    onPush={(t, label) => openPush("update", t, r.site.woo_product_id, label)}
                    onImport={(as) => setImportTarget({ site: r.site, as })}
                    onManage={onManageRow} skuDuplicate={(!!r.site.sku && dupSkus.has(String(r.site.sku).trim())) || skuWouldDuplicate(r, site)} />
                ))}
              </div>
            ) : (
              <Card className="rounded-2xl overflow-hidden"><CardContent className="p-0 overflow-x-auto">
                <Table dir="rtl">
                  <TableHeader><TableRow>
                    <TableHead className="text-right">المنتج / العرض</TableHead>
                    <TableHead className="text-right">سعر الموقع</TableHead>
                    <TableHead className="text-right">المطابقة في <CocTag /></TableHead>
                    <TableHead className="text-right">سعر <CocTag /></TableHead>
                    <TableHead className="text-right">الإجراءات</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {shownSite.map((r) => (
                      <SiteTableRow key={`${r.site.woo_product_id}-${r.site.woo_variation_id}`} row={r} products={products} boxes={boxes}
                        onMap={map} onUnmap={unmap} onPull={openPull}
                        onPush={(t, label) => openPush("update", t, r.site.woo_product_id, label)}
                        onImport={(as) => setImportTarget({ site: r.site, as })}
                        onManage={onManageRow} skuDuplicate={(!!r.site.sku && dupSkus.has(String(r.site.sku).trim())) || skuWouldDuplicate(r, site)} />
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            )}
          </TabsContent>

          <TabsContent value="coc" className="space-y-4">
            {shownMissing.length === 0 ? (
              <Card className="rounded-2xl"><CardContent className="py-12 text-center text-muted-foreground space-y-2">
                <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500/70" />
                <p>لا توجد بنود غير منشورة مطابقة للبحث الحالي</p>
              </CardContent></Card>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {shownMissing.map((item) => (
                  <CocMissingCard key={`${item.kind}-${item.id}`} item={item}
                    onPush={() => openPush("create", { kind: item.kind, id: item.id }, null, item.name)}
                    onManage={(a, it) => setManage({ action: a, ctx: ctxFromMissing(it) })} />
                ))}
              </div>
            ) : (
              <Card className="rounded-2xl overflow-hidden"><CardContent className="p-0 overflow-x-auto">
                <Table dir="rtl">
                  <TableHeader><TableRow>
                    <TableHead className="text-right">البند</TableHead>
                    <TableHead className="text-right">النوع</TableHead>
                    <TableHead className="text-right">السعر في <CocTag /></TableHead>
                    <TableHead className="text-right">الشحن / الباركود</TableHead>
                    <TableHead className="text-right">الإجراء</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {shownMissing.map((item) => (
                      <TableRow key={`${item.kind}-${item.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <MiniThumb imageUrl={item.image_url} isBox={item.kind === "offer_box"} name={item.name} />
                            <div>
                              <div className="font-semibold">{item.name}</div>
                              {item.kind === "offer_box" && item.items.length > 0 && (
                                <div className="text-xs text-muted-foreground line-clamp-1">{summarizeBoxItems(item.items, 2)}</div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell><TypeBadge isBox={item.kind === "offer_box"} /></TableCell>
                        <TableCell className="font-bold whitespace-nowrap" style={{ color: BRAND.deep }}>{formatEgp(item.price)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.kind === "offer_box" ? (
                            <span className="inline-flex items-center gap-1"><Truck className="w-3.5 h-3.5" />{item.shipping_cost ? `شحن ${formatEgp(item.shipping_cost)} ضمن السعر` : "شحن مجاني على الموقع"}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1"><ScanBarcode className="w-3.5 h-3.5" />{item.barcode ? <bdi dir="ltr">{item.barcode}</bdi> : "بدون باركود"}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" style={{ backgroundColor: BRAND.primary }} className="gap-1.5 rounded-xl"
                            onClick={() => openPush("create", { kind: item.kind, id: item.id }, null, item.name)}>
                            <Upload className="w-3.5 h-3.5" />إضافة إلى الموقع
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            )}
          </TabsContent>

          <TabsContent value="log">
            <Card className="rounded-2xl overflow-hidden"><CardContent className="p-0 overflow-x-auto">
              <Table dir="rtl">
                <TableHeader><TableRow>
                  <TableHead className="text-right">الوقت</TableHead>
                  <TableHead className="text-right">العملية</TableHead>
                  <TableHead className="text-right">رقم منتج الموقع</TableHead>
                  <TableHead className="text-right">قبل</TableHead>
                  <TableHead className="text-right">بعد</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {logs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatCairoLatn(l.created_at)}</TableCell>
                      <TableCell className="font-medium">{ACTION_LABELS[l.action] ?? l.action}</TableCell>
                      <TableCell>{l.woo_product_id ? <bdi dir="ltr">#{formatNum(l.woo_product_id)}</bdi> : "—"}</TableCell>
                      <TableCell className="max-w-64 truncate text-xs"><bdi dir="ltr">{l.before ? JSON.stringify(l.before) : "—"}</bdi></TableCell>
                      <TableCell className="max-w-64 truncate text-xs"><bdi dir="ltr">{l.after ? JSON.stringify(l.after) : "—"}</bdi></TableCell>
                      <TableCell>
                        {l.status === "applied" ? <Badge variant="outline" className="border-emerald-500 text-emerald-700">تم</Badge> : <Badge variant="destructive">فشل{l.error ? `: ${l.error}` : ""}</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {logs.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">لا توجد عمليات مسجّلة بعد</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>

      <PreviewDialog state={preview} onClose={() => setPreview(null)} />
      {manage?.action === "price" && <PriceEditDialog ctx={manage.ctx} onClose={() => setManage(null)} onPreview={setPreview} onDone={load} />}
      {manage?.action === "sale" && <SaleDialog ctx={manage.ctx} onClose={() => setManage(null)} onPreview={setPreview} onDone={load} />}
      {manage?.action === "visibility" && (
        <VisibilityDialog ctx={manage.ctx} current={manage.vis ?? "publish_visible"} onClose={() => setManage(null)} onPreview={setPreview} onDone={load} />
      )}
      {manage?.action === "image" && <ImageDialog ctx={manage.ctx} onClose={() => setManage(null)} onDone={load} />}
      {importTarget && (
        <ImportDialog target={importTarget} products={products} onClose={() => setImportTarget(null)} onDone={() => { setImportTarget(null); void load(); }} />
      )}
    </DashboardLayout>
  );
}
