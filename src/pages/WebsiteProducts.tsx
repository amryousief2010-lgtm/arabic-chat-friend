import { useCallback, useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeftRight, Download, Link2, Lightbulb, RefreshCw, Unlink, Upload } from "lucide-react";
import { WOO_MAP_SUGGESTIONS } from "@/data/wooMapSuggestions";
import {
  type BoxItemDraft, type CatalogRow, type CocBox, type CocProduct, type MapRow, type SiteProduct,
  CHANGE_FIELD_LABELS, WARNING_LABELS, barcodeFromSiteSku, barcodeWarning, boxImportCheck, buildCatalogRows,
  cocNotOnSite, importProductMissing, suggestionFor, syncErrorMessage,
} from "@/lib/websiteProducts";
import { formatCairo } from "@/lib/websiteOrders";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const BRAND = { primary: "#A4288A", deep: "#662D8C", accent: "#F37346" };
const FN = "woo-catalog-sync";

const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Number(v).toLocaleString("ar-EG")} ج.م`);

type Target = { kind: "product" | "offer_box"; id: string };
interface Change { field: string; before: string | null; after: string }
interface PreviewState {
  title: string;
  changes: Change[];
  warnings: string[];
  confirmLabel: string;
  blocked: string | null;
  onConfirm: () => Promise<void>;
}
interface LogRow { id: string; action: string; direction: string | null; woo_product_id: number | null; status: string; error: string | null; before: unknown; after: unknown; created_at: string; actor: string | null }

const ACTION_LABELS: Record<string, string> = {
  refresh: "تحديث من الموقع", map: "ربط", unmap: "فك ربط", import_to_coc: "استيراد إلى coceg",
  pull_price: "سحب سعر من الموقع", push_create: "إضافة إلى الموقع", push_update: "تحديث على الموقع",
};

/** يستدعي دالة المزامنة ويعيد رمز الخطأ من جسم الاستجابة إن وُجد. */
async function callSync<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke(FN, { body });
  if (!error) return { data: data as T, error: null };
  let code = error.message;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = await (error as any).context?.json?.();
    if (j?.error) code = j.error;
  } catch { /* ignore */ }
  return { data: null, error: code };
}

export default function WebsiteProducts() {
  const [site, setSite] = useState<SiteProduct[]>([]);
  const [maps, setMaps] = useState<MapRow[]>([]);
  const [products, setProducts] = useState<CocProduct[]>([]);
  const [boxes, setBoxes] = useState<CocBox[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [keysConfigured, setKeysConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "unmapped" | "diff">("all");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [importTarget, setImportTarget] = useState<{ site: SiteProduct; as: "product" | "offer_box" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, m, p, b, l] = await Promise.all([
      db.from("woo_site_products").select("woo_product_id, woo_variation_id, name, sku, price, regular_price, sale_price, permalink, removed_at").order("name"),
      db.from("woo_product_map").select("woo_product_id, woo_variation_id, kind, product_id, offer_box_id"),
      db.from("products").select("id, name, price, barcode, is_active").order("name"),
      db.from("offer_boxes").select("id, name, offer_price, shipping_cost, is_active").order("name"),
      db.from("woo_sync_log").select("*").order("created_at", { ascending: false }).limit(100),
    ]);
    if (s.error) toast.error("تعذّر تحميل منتجات الموقع");
    const num = (r: Record<string, unknown>) => ({ ...r, woo_product_id: Number(r.woo_product_id), woo_variation_id: Number(r.woo_variation_id) });
    setSite((s.data ?? []).map(num));
    setMaps((m.data ?? []).map(num));
    setProducts(p.data ?? []);
    setBoxes(b.data ?? []);
    setLogs(l.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    callSync<{ keys_configured: boolean }>({ action: "status" }).then(({ data }) => setKeysConfigured(data?.keys_configured ?? null));
  }, [load]);

  const rows = useMemo(() => buildCatalogRows(site, maps, products, boxes), [site, maps, products, boxes]);
  const shown = rows.filter((r) => (filter === "unmapped" ? !r.map : filter === "diff" ? !!r.priceDiff : true));
  const missing = useMemo(() => cocNotOnSite(products, boxes, maps), [products, boxes, maps]);
  const unmappedCount = rows.filter((r) => !r.map && !r.site.removed_at).length;
  const diffCount = rows.filter((r) => !!r.priceDiff).length;

  const refresh = async () => {
    setRefreshing(true);
    const { data, error } = await callSync<{ count: number }>({ action: "refresh" });
    setRefreshing(false);
    if (error) return toast.error(syncErrorMessage(error));
    toast.success(`تم تحديث ${data?.count ?? 0} منتجاً من الموقع`);
    void load();
  };

  const map = async (wooId: number, t: Target) => {
    const { error } = await db.rpc("woo_catalog_map", {
      _woo_product_id: wooId, _woo_variation_id: 0,
      _product_id: t.kind === "product" ? t.id : null, _offer_box_id: t.kind === "offer_box" ? t.id : null,
    });
    if (error) return toast.error(syncErrorMessage(error.message));
    toast.success("تم الربط");
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

  /** coceg → الموقع: معاينة من الدالة ثم تأكيد بنفس الرمز. */
  const openPush = async (mode: "create" | "update", target: Target, wooId: number | null, label: string) => {
    const body = { mode, target, woo_product_id: wooId };
    const { data, error } = await callSync<{ changes: Change[]; warnings: string[]; token: string; keys_configured: boolean }>({ action: "preview", ...body });
    if (error || !data) return toast.error(syncErrorMessage(error));
    setPreview({
      title: mode === "create" ? `إضافة «${label}» إلى الموقع` : `تحديث «${label}» على الموقع من coceg`,
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

  /** الموقع → coceg (منتجات فقط): المعاينة محلية والتأكيد بقيم متوقعة. */
  const openPull = (r: CatalogRow) => {
    if (!r.product) return;
    setPreview({
      title: `تحديث سعر «${r.product.name}» في coceg من الموقع`,
      changes: [{ field: "regular_price", before: r.cocPrice === null ? null : String(r.cocPrice), after: String(r.site.price) }],
      warnings: [],
      confirmLabel: "تأكيد تحديث سعر coceg",
      blocked: null,
      onConfirm: async () => {
        const { error } = await db.rpc("woo_catalog_pull_price", {
          _woo_product_id: r.site.woo_product_id, _woo_variation_id: 0,
          _expected_coc_price: r.cocPrice, _expected_site_price: r.site.price,
        });
        if (error) return void toast.error(syncErrorMessage(error.message));
        toast.success("تم تحديث السعر في coceg");
        setPreview(null);
        void load();
      },
    });
  };

  return (
    <DashboardLayout>
      <div dir="rtl" className="font-cairo space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <Header title="منتجات الموقع" subtitle="مطابقة منتجات وعروض capitalostrich.com مع coceg، والإضافة والأسعار في الاتجاهين بعد المعاينة" />
          <Button onClick={refresh} disabled={refreshing} style={{ backgroundColor: BRAND.primary }} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />تحديث من الموقع
          </Button>
        </div>

        {keysConfigured === false && (
          <Card className="border-amber-400"><CardContent className="p-3 text-sm flex items-center gap-2 text-amber-800">
            <AlertTriangle className="w-4 h-4" />
            الكتابة على الموقع متوقفة حتى إنشاء مفاتيح WooCommerce واعتماد المدير العام. القراءة والمطابقة والاستيراد إلى coceg متاحة.
          </CardContent></Card>
        )}

        <div className="flex flex-wrap gap-2 text-sm">
          <Badge style={{ backgroundColor: BRAND.deep }}>منتجات الموقع: {rows.filter((r) => !r.site.removed_at).length}</Badge>
          <Badge style={{ backgroundColor: BRAND.accent }}>غير مربوطة: {unmappedCount}</Badge>
          <Badge variant="outline">فروق أسعار: {diffCount}</Badge>
          <Badge variant="outline">في coceg وليست على الموقع: {missing.products.length + missing.boxes.length}</Badge>
        </div>

        <Tabs defaultValue="site">
          <TabsList>
            <TabsTrigger value="site">منتجات الموقع</TabsTrigger>
            <TabsTrigger value="coc">في coceg وليست على الموقع</TabsTrigger>
            <TabsTrigger value="log">سجل المزامنة</TabsTrigger>
          </TabsList>

          <TabsContent value="site" className="space-y-3">
            <div className="flex gap-2">
              {([["all", "الكل"], ["unmapped", "غير المربوطة"], ["diff", "فروق الأسعار"]] as const).map(([v, l]) => (
                <Button key={v} size="sm" variant={filter === v ? "default" : "outline"} style={filter === v ? { backgroundColor: BRAND.primary } : undefined} onClick={() => setFilter(v)}>{l}</Button>
              ))}
            </div>
            {!loading && site.length === 0 && (
              <Card><CardContent className="py-8 text-center text-muted-foreground">لا توجد نسخة من منتجات الموقع بعد. اضغط «تحديث من الموقع».</CardContent></Card>
            )}
            {shown.length > 0 && (
              <Card><CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="text-right">منتج الموقع</TableHead>
                    <TableHead className="text-right">سعر الموقع</TableHead>
                    <TableHead className="text-right">المطابقة في coceg</TableHead>
                    <TableHead className="text-right">سعر coceg</TableHead>
                    <TableHead className="text-right">الإجراءات</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {shown.map((r) => (
                      <SiteRow key={`${r.site.woo_product_id}-${r.site.woo_variation_id}`} row={r} products={products} boxes={boxes}
                        onMap={map} onUnmap={unmap} onPull={openPull}
                        onPush={(t, label) => openPush("update", t, r.site.woo_product_id, label)}
                        onImport={(as) => setImportTarget({ site: r.site, as })} />
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            )}
          </TabsContent>

          <TabsContent value="coc">
            <Card><CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-right">البند</TableHead>
                  <TableHead className="text-right">النوع</TableHead>
                  <TableHead className="text-right">السعر في coceg</TableHead>
                  <TableHead className="text-right">الباركود / الشحن</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {missing.boxes.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell><Badge style={{ backgroundColor: BRAND.deep }}>عرض</Badge></TableCell>
                      <TableCell>{money(b.offer_price)}</TableCell>
                      <TableCell>{b.shipping_cost ? `شحن ${money(b.shipping_cost)} (ضمن السعر)` : "بدون شحن مسجّل"}</TableCell>
                      <TableCell><Button size="sm" variant="outline" className="gap-1" onClick={() => openPush("create", { kind: "offer_box", id: b.id }, null, b.name)}><Upload className="w-4 h-4" />إضافة إلى الموقع</Button></TableCell>
                    </TableRow>
                  ))}
                  {missing.products.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell><Badge variant="outline">منتج</Badge></TableCell>
                      <TableCell>{money(p.price)}</TableCell>
                      <TableCell dir="ltr" className="text-right">{p.barcode || "بدون باركود"}</TableCell>
                      <TableCell><Button size="sm" variant="outline" className="gap-1" onClick={() => openPush("create", { kind: "product", id: p.id }, null, p.name)}><Upload className="w-4 h-4" />إضافة إلى الموقع</Button></TableCell>
                    </TableRow>
                  ))}
                  {missing.products.length + missing.boxes.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">كل المنتجات والعروض النشطة موجودة على الموقع</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="log">
            <Card><CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-right">الوقت</TableHead>
                  <TableHead className="text-right">العملية</TableHead>
                  <TableHead className="text-right">منتج الموقع</TableHead>
                  <TableHead className="text-right">قبل</TableHead>
                  <TableHead className="text-right">بعد</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {logs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap">{formatCairo(l.created_at)}</TableCell>
                      <TableCell>{ACTION_LABELS[l.action] ?? l.action}</TableCell>
                      <TableCell>{l.woo_product_id ?? "—"}</TableCell>
                      <TableCell className="max-w-64 truncate text-xs" dir="ltr">{l.before ? JSON.stringify(l.before) : "—"}</TableCell>
                      <TableCell className="max-w-64 truncate text-xs" dir="ltr">{l.after ? JSON.stringify(l.after) : "—"}</TableCell>
                      <TableCell>{l.status === "applied" ? <Badge variant="outline">تم</Badge> : <Badge variant="destructive">فشل{l.error ? `: ${l.error}` : ""}</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>

      <PreviewDialog state={preview} onClose={() => setPreview(null)} />
      {importTarget && (
        <ImportDialog target={importTarget} products={products} onClose={() => setImportTarget(null)} onDone={() => { setImportTarget(null); void load(); }} />
      )}
    </DashboardLayout>
  );
}

function SiteRow({ row, products, boxes, onMap, onUnmap, onPull, onPush, onImport }: {
  row: CatalogRow; products: CocProduct[]; boxes: CocBox[];
  onMap: (wooId: number, t: Target) => void; onUnmap: (wooId: number) => void; onPull: (r: CatalogRow) => void;
  onPush: (t: Target, label: string) => void; onImport: (as: "product" | "offer_box") => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const s = row.site;
  const suggestion = !row.map ? suggestionFor(s.woo_product_id, WOO_MAP_SUGGESTIONS, products) : null;
  const target: Target | null = row.product ? { kind: "product", id: row.product.id } : row.box ? { kind: "offer_box", id: row.box.id } : null;
  const label = row.product?.name ?? row.box?.name ?? "";

  return (
    <TableRow className={s.removed_at ? "opacity-60" : undefined}>
      <TableCell>
        <div className="font-medium">{s.permalink ? <a href={s.permalink} target="_blank" rel="noreferrer" className="hover:underline">{s.name}</a> : s.name}</div>
        <div className="text-xs text-muted-foreground" dir="ltr">#{s.woo_product_id}{s.sku ? ` · SKU ${s.sku}` : ""}</div>
        {s.removed_at && <Badge variant="destructive" className="mt-1">لم يعد ظاهراً على الموقع</Badge>}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {money(s.price)}
        {s.sale_price !== null && s.regular_price !== null && <div className="text-xs text-muted-foreground line-through">{money(s.regular_price)}</div>}
      </TableCell>
      <TableCell className="min-w-64">
        {row.map ? (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="gap-1" style={{ borderColor: BRAND.deep, color: BRAND.deep }}>
              <Link2 className="w-3 h-3" />{row.box ? "عرض: " : "منتج: "}{label || "—"}
            </Badge>
            <button type="button" className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1" onClick={() => onUnmap(s.woo_product_id)}>
              <Unlink className="w-3 h-3" />فك
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            {suggestion && (
              <div className="flex items-center gap-2 text-xs">
                <Lightbulb className="w-3 h-3" style={{ color: BRAND.accent }} />
                اقتراح: {suggestion.product.name} ({Math.round(suggestion.confidence * 100)}٪)
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => onMap(s.woo_product_id, { kind: "product", id: suggestion.product.id })}>اعتماد</Button>
              </div>
            )}
            <div className="flex items-center gap-1">
              <Select value={choice ?? undefined} onValueChange={setChoice}>
                <SelectTrigger className="h-8 w-52"><SelectValue placeholder="ربط بمنتج أو عرض" /></SelectTrigger>
                <SelectContent>
                  {boxes.map((b) => <SelectItem key={`b:${b.id}`} value={`b:${b.id}`}>عرض: {b.name}{b.is_active ? "" : " (غير نشط)"}</SelectItem>)}
                  {products.map((p) => <SelectItem key={`p:${p.id}`} value={`p:${p.id}`}>{p.name}{p.is_active ? "" : " (غير نشط)"}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" disabled={!choice} onClick={() => {
                if (!choice) return;
                const [k, id] = choice.split(":");
                onMap(s.woo_product_id, { kind: k === "b" ? "offer_box" : "product", id });
              }}>ربط</Button>
            </div>
          </div>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {money(row.cocPrice)}
        {!!row.priceDiff && <div><Badge variant="outline" className="border-amber-500 text-amber-700">فرق {money(row.priceDiff)}</Badge></div>}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {target && (row.priceDiff || row.box) && (
            <Button size="sm" variant="outline" className="gap-1" onClick={() => onPush(target, label)}>
              <Upload className="w-3 h-3" />{row.box ? "تحديث العرض على الموقع" : "سعر الموقع من coceg"}
            </Button>
          )}
          {row.product && !!row.priceDiff && (
            <Button size="sm" variant="outline" className="gap-1" onClick={() => onPull(row)}>
              <Download className="w-3 h-3" />سعر coceg من الموقع
            </Button>
          )}
          {!row.map && !s.removed_at && (
            <>
              <Button size="sm" variant="ghost" className="gap-1" onClick={() => onImport("product")}><ArrowLeftRight className="w-3 h-3" />استيراد كمنتج</Button>
              <Button size="sm" variant="ghost" className="gap-1" onClick={() => onImport("offer_box")}><ArrowLeftRight className="w-3 h-3" />استيراد كعرض</Button>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function PreviewDialog({ state, onClose }: { state: PreviewState | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="font-cairo max-w-2xl">
        <DialogHeader>
          <DialogTitle style={{ color: BRAND.deep }}>{state.title}</DialogTitle>
          <DialogDescription>معاينة الفروق قبل التنفيذ. لن يتغير شيء قبل التأكيد.</DialogDescription>
        </DialogHeader>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-right">الحقل</TableHead><TableHead className="text-right">قبل</TableHead><TableHead className="text-right">بعد</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {state.changes.map((c) => (
              <TableRow key={c.field}>
                <TableCell>{CHANGE_FIELD_LABELS[c.field] ?? c.field}</TableCell>
                <TableCell className="whitespace-pre-line text-muted-foreground">{c.before || "—"}</TableCell>
                <TableCell className="whitespace-pre-line font-medium" style={{ color: BRAND.primary }}>{c.after || "(فارغ)"}</TableCell>
              </TableRow>
            ))}
            {state.changes.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">لا توجد فروق</TableCell></TableRow>}
          </TableBody>
        </Table>
        {state.warnings.map((w) => (
          <div key={w} className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{WARNING_LABELS[w] ?? w}</div>
        ))}
        {state.blocked && <div className="text-sm text-destructive">{state.blocked}</div>}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button disabled={!!state.blocked || busy} style={{ backgroundColor: BRAND.primary }}
            onClick={async () => { setBusy(true); await state.onConfirm(); setBusy(false); }}>
            {state.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ target, products, onClose, onDone }: {
  target: { site: SiteProduct; as: "product" | "offer_box" }; products: CocProduct[]; onClose: () => void; onDone: () => void;
}) {
  const s = target.site;
  const [form, setForm] = useState({
    name: s.name, price: s.price ? String(s.price) : "", cost_price: "", pack_weight_kg: "",
    barcode: barcodeFromSiteSku(s.sku), barcode_pending: false, unit: "كيلو",
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
        _woo_product_id: s.woo_product_id, _woo_variation_id: 0, _name: form.name,
        _shipping_cost: shipping === "" ? null : Number(shipping), _items: items,
      })
      : await db.rpc("woo_catalog_import_product", {
        _woo_product_id: s.woo_product_id, _woo_variation_id: 0, _name: form.name, _price: Number(form.price),
        _cost_price: Number(form.cost_price), _pack_weight_kg: Number(form.pack_weight_kg),
        _barcode: form.barcode.trim() || null, _barcode_pending: form.barcode_pending, _unit: form.unit, _category: null,
      });
    setBusy(false);
    if (error) return toast.error(syncErrorMessage(error.message));
    toast.success(isBox ? "تم إنشاء العرض في coceg (غير نشط) وربطه" : "تم إنشاء المنتج في coceg (غير نشط) وربطه");
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
          <DialogTitle style={{ color: BRAND.deep }}>{isBox ? "استيراد عرض من الموقع إلى coceg" : "استيراد منتج من الموقع إلى coceg"}</DialogTitle>
          <DialogDescription>«{s.name}» — سعر الموقع {money(s.price)}. يُنشأ غير نشط، ويُفعَّل لاحقاً من الشاشة المختصة.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          {field(isBox ? "اسم العرض" : "اسم المنتج", "name")}
          {!isBox && field("سعر البيع", "price", "number")}
          {!isBox && field("التكلفة", "cost_price", "number")}
          {!isBox && field("وزن العبوة (كجم)", "pack_weight_kg", "number")}
          {!isBox && (
            <div className="grid gap-1 text-sm">
              <span>الباركود</span>
              <Input dir="ltr" value={form.barcode} disabled={form.barcode_pending} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="622400320xxxx" />
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={form.barcode_pending} onCheckedChange={(v) => setForm({ ...form, barcode_pending: !!v, barcode: v ? "" : form.barcode })} />
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
                <Select value={it.product_id || undefined} onValueChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, product_id: v } : x)))}>
                  <SelectTrigger className="h-8 w-52"><SelectValue placeholder="المنتج" /></SelectTrigger>
                  <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input className="h-8 w-20" type="number" value={it.quantity} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} aria-label="الكمية" />
                <Input className="h-8 w-24" type="number" disabled={it.is_gift} value={it.custom_price} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, custom_price: Number(e.target.value) } : x)))} aria-label="السعر" />
                <label className="flex items-center gap-1 text-xs">
                  <Checkbox checked={it.is_gift} onCheckedChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, is_gift: !!v, custom_price: v ? 0 : x.custom_price } : x)))} />هدية
                </label>
                <Button size="sm" variant="ghost" onClick={() => setItems(items.filter((_, j) => j !== i))}>حذف</Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setItems([...items, { product_id: "", quantity: 1, custom_price: 0, is_gift: false }])}>إضافة مكوّن</Button>
            <div className={`text-sm ${box.ok ? "text-green-700" : "text-amber-700"}`}>
              المكونات المدفوعة {money(box.paid)} + الشحن {money(Number(shipping) || 0)} = {money(box.total)} مقابل سعر الموقع {money(s.price)}
              {!box.ok && " — يجب أن يتساويا تماماً"}
            </div>
          </div>
        )}

        {missing.length > 0 && <div className="text-sm text-destructive">حقول مطلوبة حسب قاعدة المنتج: {missing.join("، ")}</div>}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button disabled={!canSave || busy} onClick={save} style={{ backgroundColor: BRAND.primary }}>إنشاء في coceg وربطه</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
