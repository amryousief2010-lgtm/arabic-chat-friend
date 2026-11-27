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
  CloudUpload,
  LayoutGrid,
  List,
  PackagePlus,
  RefreshCw,
  ScanBarcode,
  ScanLine,
  Gift,
  Search,
  Store,
  Truck,
  Unlink,
  Upload,
} from "lucide-react";
import {
  type BoxItemSummary,
  type BulkCandidate,
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
  bulkPushCandidates,
  hasPriceMismatch,
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
import { ImageDialog, type ManageCtx, PriceEditDialog, RestoreDialog, SaleDialog, ValidityDialog, VisibilityDialog, previewSiteEdit } from "@/components/website-products/ManageDialogs";
import {
  canKeepSale,
  customerPriceContextFromPreview,
  keepSaleDisabledReason,
  saleWouldBeCleared,
} from "@/lib/wooPreview";

import { type Change, ImportDialog, PreviewDialog, type PreviewState } from "@/components/website-products/Dialogs";
import { callSync } from "@/components/website-products/sync";
import { PackDialog, type PackDialogState } from "@/components/website-products/PackDialog";
import { BulkPushDialog } from "@/components/website-products/BulkPushDialog";
import { OfferOverviewCard, LinkBadge, OfferStatusChip, SectionTile } from "@/components/website-products/OfferCards";
import { type CatalogSection, type OfferFilter, buildOfferOverview, filterAndSortOffers, offerAddDisabledReason, rowsForSection, sectionCounts } from "@/lib/websiteOffers";
import { cocPriceFromSite, formatPackQty, packPriceExplanation, unitSymbol } from "@/lib/sitePack";

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
  coc_validity: "مدة صلاحية العرض في COCEG",
  site_validity: "إخفاء/إظهار العرض حسب المدة",
  site_restore: "استرجاع من نسخة قبل الكتابة",
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

  const [section, setSection] = useState<CatalogSection>("products");
  const [tab, setTab] = useState<"overview" | "site" | "coc" | "log">("site");
  const [offerFilter, setOfferFilter] = useState<OfferFilter>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<SiteStatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name_asc");

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [manage, setManage] = useState<{ action: "price" | "image" | "sale" | "visibility" | "validity"; ctx: ManageCtx; vis?: "publish_visible" | "publish_hidden" | "draft" } | null>(null);
  const [restore, setRestore] = useState<{ backupId: string; title: string } | null>(null);
  const [backups, setBackups] = useState<Record<string, { id: string }>>({});
  const [pack, setPack] = useState<PackDialogState | null>(null);
  const [importTarget, setImportTarget] = useState<{ site: SiteProduct; as: "product" | "offer_box" } | null>(null);
  const [bulk, setBulk] = useState<BulkCandidate[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, m, p, b, bi, l] = await Promise.all([
      db.from("woo_site_products").select("woo_product_id, woo_variation_id, name, sku, price, regular_price, sale_price, permalink, image_url, removed_at").order("name"),
      db.from("woo_product_map").select("woo_product_id, woo_variation_id, kind, product_id, offer_box_id, site_pack_qty, site_pack_label, site_pack_confirmed_at"),
      db.from("products").select("id, name, price, barcode, image_url, is_active, unit").order("name"),
      db.from("offer_boxes").select("id, name, offer_price, shipping_cost, is_active, image_url, starts_at, expires_at, site_hidden_by_validity").order("name"),
      db.from("offer_box_items").select("id, offer_box_id, quantity, is_gift, custom_price, created_at, products(name, unit)").order("created_at"),
      db.from("woo_sync_log").select("*").order("created_at", { ascending: false }).limit(100),
    ]);
    if (s.error) toast.error("تعذّر تحميل منتجات الموقع");
    const num = (r: Record<string, unknown>) => ({ ...r, woo_product_id: Number(r.woo_product_id), woo_variation_id: Number(r.woo_variation_id) });
    const numMap = (r: Record<string, unknown>) => ({ ...num(r), ...("site_pack_qty" in r ? { site_pack_qty: r.site_pack_qty === null ? 1 : Number(r.site_pack_qty) } : {}) });

    const boxItemsMap = new Map<string, BoxItemSummary[]>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const item of (bi.data ?? []) as any[]) {
      const boxId = String(item.offer_box_id ?? "");
      if (!boxId) continue;
      const arr = boxItemsMap.get(boxId) ?? [];
      arr.push({
        id: item.id,
        name: item.products?.name ?? "منتج",
        unit: item.products?.unit ?? null,
        quantity: Number(item.quantity ?? 1),
        is_gift: !!item.is_gift,
        custom_price: item.custom_price === null || item.custom_price === undefined ? null : Number(item.custom_price),
      });
      boxItemsMap.set(boxId, arr);
    }

    setSite((s.data ?? []).map(num));
    setMaps((m.data ?? []).map(numMap));
    setProducts(p.data ?? []);
    setBoxes(((b.data ?? []) as CocBox[]).map((bx) => ({ ...bx, items: boxItemsMap.get(bx.id) ?? [] })));
    const logRows = l.data ?? [];
    setLogs(logRows);
    const logIds = logRows.map((x: { id: string }) => x.id);
    if (logIds.length) {
      const bk = await db.from("woo_product_backups").select("id, log_id").in("log_id", logIds);
      const map: Record<string, { id: string }> = {};
      for (const row of bk.data ?? []) {
        if (row.log_id) map[String(row.log_id)] = { id: String(row.id) };
      }
      setBackups(map);
    } else {
      setBackups({});
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    callSync<{ keys_configured: boolean }>({ action: "status" }).then(({ data }) => setKeysConfigured(data?.keys_configured ?? null));
  }, [load]);

  // القسم العلوي يحدد النوع: «منتجات الموقع» = منتجات منفردة، «العروض والصناديق» = عروض وبوكسات.
  const typeFilter: TypeFilter = section === "offers" ? "offer_box" : "product";
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

  const offers = useMemo(() => buildOfferOverview(boxes, maps, rows), [boxes, maps, rows]);
  const shownOffers = useMemo(
    () => filterAndSortOffers(offers, { query, filter: offerFilter, sort: sortKey }),
    [offers, query, offerFilter, sortKey],
  );
  const counts = useMemo(() => sectionCounts(rows, offers, missing.products), [rows, offers, missing.products]);

  const switchSection = (s: CatalogSection) => {
    setSection(s);
    setStatusFilter("all");
    setOfferFilter("all");
    setTab((t) => (t === "log" ? "log" : s === "offers" ? "overview" : "site"));
  };
  // «عرض الفروق»: يبقى في القسم الحالي إن كان فيه فروق، وإلا ينتقل للقسم الذي فيه الفروق.
  const showDiffs = () => {
    if (counts[section].diffs === 0) setSection(section === "offers" ? "products" : "offers");
    setTab("site");
    setStatusFilter("diff");
  };

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
    startsAt: r.box?.starts_at ?? null,
    expiresAt: r.box?.expires_at ?? null,
    siteHiddenByValidity: !!r.box?.site_hidden_by_validity,
    packQty: r.product ? r.pack?.qty ?? 1 : 1,
    packLabel: r.pack?.label ?? null,
    unit: r.product?.unit ?? null,
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
    startsAt: it.starts_at ?? null,
    expiresAt: it.expires_at ?? null,
    siteHiddenByValidity: false,
  });

  const onManageRow = (a: ManageAction, r: CatalogRow) => {
    if (!r.product && !r.box) return;
    if (a === "pack") {
      if (r.product) setPack({ mode: "edit", site: r.site, product: r.product, map: r.map });
      return;
    }
    if (a === "sku") {
      if (skuWouldDuplicate(r, site)) return void toast.error(syncErrorMessage("duplicate_sku"));
      return void previewSiteEdit(r.site.woo_product_id, { kind: "sku" }, `مطابقة كود «${r.site.name}» مع COCEG`, "تأكيد مطابقة الكود", setPreview, load);
    }
    setManage({ action: a, ctx: ctxFromRow(r), vis: r.site.removed_at ? "draft" : "publish_visible" });
  };

  const sectionRows = rowsForSection(rows, section);
  const activeSiteCount = sectionRows.filter((r) => !r.site.removed_at).length;
  const unmappedCount = sectionRows.filter((r) => !r.map && !r.site.removed_at).length;
  const sectionDiffCount = sectionRows.filter(hasPriceMismatch).length;
  // «نشر كل الفروق» يبقى شاملاً للمنتجات والعروض معاً.
  const diffCount = rows.filter(hasPriceMismatch).length;
  // لقطة ثابتة من الفروق لحظة الضغط حتى لا تتغير القائمة أثناء المعاينة.
  const openBulk = () => setBulk(bulkPushCandidates(rows));
  const missingCount = section === "offers" ? missing.boxes.length : missing.products.length;

  const refresh = async () => {
    setRefreshing(true);
    const { data, error } = await callSync<{ count: number }>({ action: "refresh" });
    setRefreshing(false);
    if (error) return toast.error(syncErrorMessage(error));
    toast.success(`تم تحديث ${formatNum(data?.count ?? 0)} منتجاً من الموقع`);
    void load();
  };

  const map = async (wooId: number, t: Target) => {
    if (t.kind === "product") {
      // المنتجات تمر بنافذة الربط لتأكيد وزن عبوة الموقع (مثال: عبوة 500 جم = 0.5 كجم).
      const siteRow = site.find((x) => x.woo_product_id === wooId && Number(x.woo_variation_id || 0) === 0);
      const product = products.find((p) => p.id === t.id);
      if (siteRow && product) return void setPack({ mode: "link", site: siteRow, product, map: null });
    }
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
    if (mode === "update" && target.kind === "product") {
      const row = rows.find((x) => x.site.woo_product_id === wooId && x.product?.id === target.id);
      if (row?.pack?.needsConfirm && row.product) {
        toast.info("يُرجى تأكيد وزن عبوة الموقع أولاً حتى يُحسب سعر الموقع صحيحاً");
        return void setPack({ mode: "edit", site: row.site, product: row.product, map: row.map });
      }
    }
    const body = { mode, target, woo_product_id: wooId };
    type PushPreview = {
      changes: Change[];
      warnings: string[];
      token: string;
      keys_configured: boolean;
      before?: { regular_price?: string | null; sale_price?: string | null } | null;
      after?: { regular_price?: string | null; sale_price?: string | null } | null;
      pack?: { qty: number; label: string | null; unit: string | null; coc_price: number | null; site_pack_price: number | null } | null;
    };
    const { data, error } = await callSync<PushPreview>({ action: "preview", ...body });
    if (error || !data) return toast.error(syncErrorMessage(error));
    const selling = Number(data.after?.regular_price || data.after?.sale_price || 0) || undefined;
    const defaultCtx = customerPriceContextFromPreview(data, selling);
    const allowKeep = mode === "update" && !!defaultCtx && saleWouldBeCleared(defaultCtx);
    let keepData: PushPreview | null = null;
    if (allowKeep && defaultCtx && canKeepSale(defaultCtx)) {
      const k = await callSync<PushPreview>({ action: "preview", ...body, keep_sale: true });
      if (!k.error && k.data) keepData = k.data;
    }
    const show = (keep: boolean) => {
      const d = keep && keepData ? keepData : data;
      setPreview({
        title: mode === "create" ? `إضافة «${label}» إلى الموقع` : `تحديث «${label}» على الموقع`,
        changes: d.changes,
        warnings: d.warnings,
        confirmLabel: mode === "create" ? "تأكيد الإضافة إلى الموقع" : "تأكيد التحديث على الموقع",
        blocked: d.keys_configured ? (d.changes.length ? null : "لا توجد فروق") : syncErrorMessage("woo_keys_missing"),
        priceContext: customerPriceContextFromPreview(d, selling) ?? defaultCtx,
        packNote: d.pack && d.pack.qty !== 1 ? packPriceExplanation(d.pack.coc_price, d.pack.qty, d.pack.unit, d.pack.label) : null,
        keepSale: allowKeep
          ? {
              available: true,
              enabled: keep,
              onToggle: (enabled) => {
                if (enabled && !keepData) return;
                show(enabled);
              },
              disabledReason: defaultCtx && canKeepSale(defaultCtx) && keepData ? null : (defaultCtx ? keepSaleDisabledReason(defaultCtx) : null),
            }
          : undefined,
        onConfirm: async () => {
          const r = await callSync<{ warning?: string }>({ action: "apply", ...body, token: d.token, ...(keep ? { keep_sale: true } : {}) });
          if (r.error) return void toast.error(syncErrorMessage(r.error));
          toast.success(r.data?.warning === "created_not_mapped" ? "أُضيف إلى الموقع، ويُرجى ربطه يدوياً" : "تم التنفيذ على الموقع");
          setPreview(null);
          void load();
        },
      });
    };
    show(false);
  };

  const openPull = (r: CatalogRow) => {
    if (!r.product) return;
    const packQty = r.pack?.qty ?? 1;
    const newCoc = cocPriceFromSite(r.site.price, packQty);
    setPreview({
      title: `تحديث سعر «${r.product.name}» في النظام من الموقع`,
      changes: [{ field: "regular_price", before: r.cocPrice === null ? null : String(r.cocPrice), after: String(newCoc ?? r.site.price) }],
      packNote:
        packQty !== 1
          ? `سعر عبوة الموقع ${formatEgp(r.site.price)} ÷ ${formatPackQty(packQty, r.product.unit)} = ${formatEgp(newCoc)} لكل ${unitSymbol(r.product.unit)} في COCEG`
          : null,
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
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              onClick={() => openBulk()}
              disabled={diffCount === 0 || keysConfigured === false || loading}
              title={keysConfigured === false ? syncErrorMessage("woo_keys_missing") : diffCount === 0 ? "لا توجد فروق أسعار حالياً" : undefined}
              style={{ backgroundColor: BRAND.accent }}
              className="gap-2 rounded-xl px-5 shadow-sm text-white hover:opacity-95"
            >
              <CloudUpload className="w-4 h-4" />
              نشر كل الفروق
              {diffCount > 0 && <Badge className="border-0 bg-white/25 text-white text-[11px] px-1.5 py-0">{formatNum(diffCount)}</Badge>}
            </Button>
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
            onClick={() => { setSection("products"); setTab("site"); setStatusFilter("sku_mismatch"); }}
            className="w-full text-right rounded-2xl border border-red-200 bg-red-50/70 p-3.5 text-sm flex items-center gap-2.5 text-red-800 hover:bg-red-50"
          >
            <ScanLine className="w-5 h-5 shrink-0" />
            <span className="flex-1">
              {formatNum(skuMismatchCount)} منتج كوده على الموقع غير مطابق لباركود <CocTag />. اضغطي للعرض ثم «مطابقة الكود» (<CocTag /> هو المصدر).
            </span>
          </button>
        )}

        {diffCount > 0 && (
          <div className="w-full rounded-2xl border p-3.5 text-sm flex flex-wrap items-center gap-2.5" style={{ borderColor: BRAND.accent, background: "rgba(243, 115, 70, 0.08)", color: "#8a3a17" }}>
            <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: BRAND.accent }} />
            <span className="flex-1 min-w-[220px]">
              {formatNum(diffCount)} من المنتجات والعروض ({formatNum(counts.products.diffs)} منتج · {formatNum(counts.offers.diffs)} عرض) سعرها على الموقع لا يطابق السعر المتوقع من <CocTag /> (سعر الوحدة × وزن العبوة، وسعر العرض كما هو).
            </span>
            <Button size="sm" variant="outline" className="rounded-xl h-8" style={{ borderColor: BRAND.accent, color: "#8a3a17" }}
              onClick={showDiffs}>
              عرض الفروق
            </Button>
            <Button size="sm" className="rounded-xl h-8 gap-1.5 text-white hover:opacity-95" style={{ backgroundColor: BRAND.accent }}
              disabled={keysConfigured === false || loading} onClick={() => openBulk()}>
              <CloudUpload className="w-3.5 h-3.5" />
              نشر كل الفروق
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-[26px]">
          <SectionTile
            icon={<Store className="w-7 h-7 sm:w-8 sm:h-8" />}
            color={BRAND.primary}
            title="منتجات الموقع"
            value={formatNum(counts.products.onSite)}
            lines={[
              `مربوط: ${formatNum(counts.products.linked)}`,
              <span key="m">في <CocTag /> وليست على الموقع: {formatNum(counts.products.notOnSite)}</span>,
              counts.products.diffs ? `فروق أسعار: ${formatNum(counts.products.diffs)}` : "الأسعار مطابقة",
            ]}
            active={section === "products"}
            onClick={() => switchSection("products")}
          />
          <SectionTile
            icon={<Gift className="w-7 h-7 sm:w-8 sm:h-8" />}
            color={BRAND.accent}
            title="العروض والصناديق"
            value={formatNum(counts.offers.total)}
            lines={[
              `مربوط بالموقع: ${formatNum(counts.offers.linked)}`,
              `غير موجود على الموقع: ${formatNum(counts.offers.unlinked)}`,
              counts.offers.diffs ? `فروق أسعار: ${formatNum(counts.offers.diffs)}` : "الأسعار مطابقة",
            ]}
            active={section === "offers"}
            onClick={() => switchSection("offers")}
          />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<Store className="w-5 h-5" style={{ color: BRAND.deep }} />}
            tint="rgba(102, 45, 140, 0.10)"
            label={section === "offers" ? "عروض على الموقع" : "منتجات على الموقع"}
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
            value={formatNum(sectionDiffCount)}
            sub={sectionDiffCount ? "سعر الموقع لا يطابق COCEG" : "الأسعار مطابقة"}
            active={tab === "site" && statusFilter === "diff"}
            onClick={() => { setTab("site"); setStatusFilter("diff"); }}
          />
          <StatCard
            icon={<PackagePlus className="w-5 h-5" style={{ color: BRAND.deep }} />}
            tint="rgba(102, 45, 140, 0.10)"
            label={<span>في <CocTag /> وليست على الموقع</span>}
            value={formatNum(missingCount)}
            sub={section === "offers" ? "عروض وبوكسات نشطة" : "منتجات نشطة"}
            active={tab === "coc"}
            onClick={() => setTab("coc")}
          />
        </div>

        <Tabs dir="rtl" value={tab} onValueChange={(v) => setTab(v as "overview" | "site" | "coc" | "log")} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList className="h-auto flex-wrap p-1 rounded-xl bg-muted/80">
              {section === "offers" && (
                <TabsTrigger value="overview" className="rounded-lg px-4 py-2 gap-1.5">
                  <Gift className="w-4 h-4" />
                  <span>كل العروض</span>
                  <Badge variant="secondary" className="text-[11px] px-1.5 py-0">{formatNum(counts.offers.total)}</Badge>
                </TabsTrigger>
              )}
              <TabsTrigger value="site" className="rounded-lg px-4 py-2 gap-1.5">
                <Store className="w-4 h-4" />
                <span>{section === "offers" ? "عروض الموقع" : "منتجات الموقع"}</span>
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
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={section === "offers" ? "ابحث باسم العرض أو مكوناته أو رقم المنتج..." : "ابحث بالاسم أو الباركود أو رقم المنتج..."} className="pr-9 rounded-xl" />
                </div>
                {tab === "overview" && (
                  <Select value={offerFilter} onValueChange={(v) => setOfferFilter(v as OfferFilter)}>
                    <SelectTrigger className="w-44 rounded-xl"><SelectValue placeholder="الحالة" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">كل العروض</SelectItem>
                      <SelectItem value="linked">مربوط بالموقع</SelectItem>
                      <SelectItem value="unlinked">غير موجود على الموقع</SelectItem>
                      <SelectItem value="diff">فروق أسعار</SelectItem>
                      <SelectItem value="active">ساري</SelectItem>
                      <SelectItem value="expired">منتهي الصلاحية</SelectItem>
                      <SelectItem value="inactive">موقوف</SelectItem>
                    </SelectContent>
                  </Select>
                )}
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
                    {(tab === "site" || tab === "overview") && <SelectItem value="diff_desc">أكبر فرق سعر</SelectItem>}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          )}

          <TabsContent value="overview" className="space-y-4">
            {shownOffers.length === 0 ? (
              <Card className="rounded-2xl"><CardContent className="py-12 text-center text-muted-foreground space-y-2">
                <Gift className="w-10 h-10 mx-auto opacity-40" />
                <p>{offers.length === 0 ? "لا توجد عروض أو بوكسات مسجّلة في COCEG" : "لا توجد نتائج مطابقة للبحث أو التصفية الحالية"}</p>
              </CardContent></Card>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {shownOffers.map((o) => (
                  <OfferOverviewCard key={o.box.id} offer={o}
                    onUpdate={() => openPush("update", { kind: "offer_box", id: o.box.id }, o.wooProductId, o.box.name)}
                    onAdd={() => openPush("create", { kind: "offer_box", id: o.box.id }, null, o.box.name)} />
                ))}
              </div>
            ) : (
              <Card className="rounded-2xl overflow-hidden"><CardContent className="p-0 overflow-x-auto">
                <Table dir="rtl">
                  <TableHeader><TableRow>
                    <TableHead className="text-right">العرض</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-right">سعر <CocTag /></TableHead>
                    <TableHead className="text-right">سعر الموقع</TableHead>
                    <TableHead className="text-right">الشحن</TableHead>
                    <TableHead className="text-right">الموقع</TableHead>
                    <TableHead className="text-right">الإجراء</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {shownOffers.map((o) => {
                      const addReason = offerAddDisabledReason(o);
                      return (
                        <TableRow key={o.box.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <MiniThumb imageUrl={o.primary?.displayImage ?? o.box.image_url} isBox name={o.box.name} />
                              <div>
                                <div className="font-semibold">{o.box.name}</div>
                                <div className="text-xs text-muted-foreground line-clamp-1">{summarizeBoxItems(o.box.items ?? [], 3)}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell><OfferStatusChip status={o.status} /></TableCell>
                          <TableCell className="font-bold whitespace-nowrap" style={{ color: BRAND.deep }}>{formatEgp(o.box.offer_price)}</TableCell>
                          <TableCell className="font-bold whitespace-nowrap" style={{ color: o.priceMismatch ? BRAND.accent : BRAND.deep }}>{o.linked ? formatEgp(o.sitePrice) : "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{Number(o.box.shipping_cost) > 0 ? formatEgp(o.box.shipping_cost) : "—"}</TableCell>
                          <TableCell>
                            <div className="flex flex-col items-start gap-1">
                              <LinkBadge linked={o.linked} />
                              {o.wooProductId && <bdi dir="ltr" className="text-[11px] text-muted-foreground">#{o.wooProductId}</bdi>}
                            </div>
                          </TableCell>
                          <TableCell>
                            {o.linked ? (
                              <div className="flex gap-1.5">
                                <Button size="sm" style={{ backgroundColor: o.priceMismatch ? BRAND.accent : BRAND.primary }} className="gap-1.5 rounded-xl text-white" disabled={!o.wooProductId}
                                  onClick={() => openPush("update", { kind: "offer_box", id: o.box.id }, o.wooProductId, o.box.name)}>
                                  <RefreshCw className="w-3.5 h-3.5" />تحديث العرض على الموقع
                                </Button>
                                {o.permalink && (
                                  <Button asChild size="sm" variant="outline" className="rounded-xl"><a href={o.permalink} target="_blank" rel="noreferrer">فتح في المتجر</a></Button>
                                )}
                              </div>
                            ) : (
                              <span title={addReason ?? undefined}>
                                <Button size="sm" style={{ backgroundColor: BRAND.primary }} className="gap-1.5 rounded-xl" disabled={!!addReason}
                                  onClick={() => openPush("create", { kind: "offer_box", id: o.box.id }, null, o.box.name)}>
                                  <Upload className="w-3.5 h-3.5" />إضافة إلى الموقع
                                </Button>
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent></Card>
            )}
          </TabsContent>

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
                  <TableHead className="text-right">استرجاع</TableHead>
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
                      <TableCell>
                        {l.status === "applied" && l.woo_product_id && backups[l.id] ? (
                          <Button size="sm" variant="outline" className="rounded-xl h-8" onClick={() => setRestore({ backupId: backups[l.id].id, title: ACTION_LABELS[l.action] ?? l.action })}>
                            استرجاع
                          </Button>
                        ) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {logs.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">لا توجد عمليات مسجّلة بعد</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>

      <PreviewDialog state={preview} onClose={() => setPreview(null)} />
      <PackDialog state={pack} onClose={() => setPack(null)} onDone={() => { setPack(null); void load(); }} />
      {manage?.action === "price" && <PriceEditDialog ctx={manage.ctx} onClose={() => setManage(null)} onPreview={setPreview} onDone={load} />}
      {manage?.action === "sale" && <SaleDialog ctx={manage.ctx} onClose={() => setManage(null)} onPreview={setPreview} onDone={load} />}
      {manage?.action === "visibility" && (
        <VisibilityDialog ctx={manage.ctx} current={manage.vis ?? "publish_visible"} onClose={() => setManage(null)} onPreview={setPreview} onDone={load} />
      )}
      {manage?.action === "image" && <ImageDialog ctx={manage.ctx} onClose={() => setManage(null)} onDone={load} />}
      {manage?.action === "validity" && <ValidityDialog ctx={manage.ctx} onClose={() => setManage(null)} onPreview={setPreview} onDone={load} />}
      {restore && <RestoreDialog backupId={restore.backupId} title={restore.title} onClose={() => setRestore(null)} onPreview={setPreview} onDone={load} />}
      {bulk && (
        <BulkPushDialog candidates={bulk} onClose={() => setBulk(null)} onDone={() => { setBulk(null); void load(); }} />
      )}
      {importTarget && (
        <ImportDialog target={importTarget} products={products} onClose={() => setImportTarget(null)} onDone={() => { setImportTarget(null); void load(); }} />
      )}
    </DashboardLayout>
  );
}
