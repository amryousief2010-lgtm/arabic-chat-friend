import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Printer, FileText, Search, Pencil, UtensilsCrossed, LayoutGrid, Rows, History } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/dateFormat";
import companyLogo from "@/assets/company-logo.jpg";

interface MenuItem {
  id: string;
  category: string;
  name_ar: string;
  name_en: string;
  price: number;
  unit: string;
  weight?: string;
  notes?: string;
}

const CATEGORIES = [
  "قطع طازجة",
  "منتجات بالعظم",
  "منتجات متبلة",
  "منتجات مصنعة",
  "أعضاء وأجزاء",
] as const;

const DEFAULT_MENU: MenuItem[] = [
  // قطع طازجة
  { id: "shank", category: "قطع طازجة", name_ar: "موزة", name_en: "SHANK", price: 500, unit: "L.E/Kg" },
  { id: "steak", category: "قطع طازجة", name_ar: "ستيك", name_en: "STEAK", price: 500, unit: "L.E/Kg" },
  { id: "farasha", category: "قطع طازجة", name_ar: "قطعية فراشة", name_en: "FARASHA", price: 510, unit: "L.E/Kg" },
  { id: "drumstick-bl", category: "قطع طازجة", name_ar: "قطعية دبّوس — بدون عظم —", name_en: "DRUMSTICK - BONELESS -", price: 500, unit: "L.E/Kg" },
  { id: "eye-round", category: "قطع طازجة", name_ar: "عرق تريبيانكو", name_en: "EYE-ROUND", price: 530, unit: "L.E/Kg" },
  { id: "escalope", category: "قطع طازجة", name_ar: "إسكالوب", name_en: "ESCALOPE", price: 530, unit: "L.E/Kg" },
  { id: "roll", category: "قطع طازجة", name_ar: "رول", name_en: "ROLL", price: 500, unit: "L.E/Kg" },
  { id: "cubes", category: "قطع طازجة", name_ar: "قطع لحم", name_en: "MEAT CUBES", price: 490, unit: "L.E/Kg" },
  // بالعظم
  { id: "whole-bone", category: "منتجات بالعظم", name_ar: "نعامة كاملة (بالعظم)", name_en: "WHOLE OSTRICH - WITH BONE -", price: 390, unit: "L.E/Kg", weight: "40:50 كجم" },
  { id: "thigh-bone", category: "منتجات بالعظم", name_ar: "فخذة (ورك) (بالعظم)", name_en: "THIGH - WITH BONE -", price: 390, unit: "L.E/Kg", weight: "14:20 كجم" },
  { id: "drumstick-bone", category: "منتجات بالعظم", name_ar: "دبّوس (بالعظم)", name_en: "DRUMSTICK", price: 420, unit: "L.E/Kg", weight: "6:9 كجم" },
  // متبلة
  { id: "kebab", category: "منتجات متبلة", name_ar: "قطع كباب", name_en: "KEBAB CUBES", price: 470, unit: "L.E/Kg" },
  { id: "shish-kebab", category: "منتجات متبلة", name_ar: "شيش كباب", name_en: "SHISH KEBAB", price: 450, unit: "L.E/Kg" },
  { id: "shawerma", category: "منتجات متبلة", name_ar: "شاورما", name_en: "SHAWERMA", price: 450, unit: "L.E/Kg" },
  { id: "hawawshi", category: "منتجات متبلة", name_ar: "عجينة حواوشي", name_en: "HAWAWSHI PASTE", price: 250, unit: "L.E/Kg" },
  // مصنعة
  { id: "burger", category: "منتجات مصنعة", name_ar: "برجر", name_en: "BURGER", price: 390, unit: "L.E/Kg" },
  { id: "kofta", category: "منتجات مصنعة", name_ar: "كفتة", name_en: "KOFTA", price: 390, unit: "L.E/Kg" },
  { id: "rice-kofta", category: "منتجات مصنعة", name_ar: "كفتة أرز", name_en: "RICE KOFTA", price: 250, unit: "L.E/Kg" },
  { id: "rice-mombar", category: "منتجات مصنعة", name_ar: "ممبار أرز", name_en: "RICE MOMBAR", price: 250, unit: "L.E/Kg" },
  { id: "sausages", category: "منتجات مصنعة", name_ar: "سجق شرقي", name_en: "ORIENTAL SAUSAGES", price: 390, unit: "L.E/Kg" },
  { id: "luncheon", category: "منتجات مصنعة", name_ar: "لانشون — سادة / فلفل أسود —", name_en: "LUNCHEON PLAIN - BLACK PEPPER", price: 80, unit: "L.E / 250gm" },
  // أعضاء
  { id: "liver", category: "أعضاء وأجزاء", name_ar: "كبدة", name_en: "LIVER", price: 500, unit: "L.E/Kg" },
  { id: "heart", category: "أعضاء وأجزاء", name_ar: "قلب", name_en: "HEART", price: 300, unit: "L.E/Kg" },
  { id: "gizzard", category: "أعضاء وأجزاء", name_ar: "قناصة", name_en: "GIZZARD", price: 260, unit: "L.E/Kg" },
  { id: "neck", category: "أعضاء وأجزاء", name_ar: "رقبة (عكاوي)", name_en: "NECK", price: 300, unit: "L.E/Kg" },
  { id: "fat", category: "أعضاء وأجزاء", name_ar: "دهن خام", name_en: "FAT", price: 150, unit: "L.E/Kg" },
  { id: "knuckle", category: "أعضاء وأجزاء", name_ar: "كوارع", name_en: "KNUCLE", price: 260, unit: "L.E/Kg" },
  { id: "marrow", category: "أعضاء وأجزاء", name_ar: "نخاع", name_en: "MARROW", price: 200, unit: "L.E/Kg" },
  { id: "minced", category: "أعضاء وأجزاء", name_ar: "لحم مفروم", name_en: "MINCED MEAT", price: 320, unit: "L.E/Kg" },
];

const HOTLINE = "01044437790";

interface PriceChange {
  id: string;
  item_id: string;
  item_name_ar: string;
  item_name_en: string | null;
  category: string | null;
  old_price: number | null;
  new_price: number;
  unit: string | null;
  reason: string | null;
  notes: string | null;
  changed_by_name: string | null;
  created_at: string;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// Category-level colour theme inspired by the printed menu
const catTheme: Record<string, { bg: string; price: string; chip: string }> = {
  "قطع طازجة":     { bg: "bg-stone-50",                 price: "text-rose-700",   chip: "bg-rose-100 text-rose-800" },
  "منتجات بالعظم": { bg: "bg-amber-50",                 price: "text-amber-800",  chip: "bg-amber-100 text-amber-900" },
  "منتجات متبلة":  { bg: "bg-orange-50",                price: "text-orange-700", chip: "bg-orange-100 text-orange-900" },
  "منتجات مصنعة":  { bg: "bg-red-50",                   price: "text-red-700",    chip: "bg-red-100 text-red-800" },
  "أعضاء وأجزاء":  { bg: "bg-neutral-900 text-stone-100", price: "text-rose-400",   chip: "bg-neutral-800 text-rose-300" },
};

export default function RestaurantMenuTab() {
  const { isGeneralManager, isExecutiveManager, profile, user } = useAuth();
  const canEdit = isGeneralManager || isExecutiveManager;

  const [changes, setChanges] = useState<PriceChange[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [view, setView] = useState<"design" | "table">("design");
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Load price-change history
  const loadHistory = async () => {
    const { data, error } = await supabase
      .from("menu_price_changes")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) { console.warn(error); return; }
    setChanges((data || []) as PriceChange[]);
  };

  useEffect(() => { loadHistory(); }, []);

  // Current effective menu = default merged with latest price per item from DB
  const menu = useMemo<MenuItem[]>(() => {
    const latest = new Map<string, PriceChange>();
    for (const c of changes) {
      if (!latest.has(c.item_id)) latest.set(c.item_id, c); // first = newest because ordered desc
    }
    return DEFAULT_MENU.map((m) => {
      const c = latest.get(m.id);
      return c ? { ...m, price: Number(c.new_price) } : m;
    });
  }, [changes]);

  const lastUpdatedAt = changes[0]?.created_at;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menu.filter((m) => {
      if (category !== "all" && m.category !== category) return false;
      if (!q) return true;
      return (
        m.name_ar.toLowerCase().includes(q) ||
        m.name_en.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q)
      );
    });
  }, [menu, search, category]);

  const grouped = useMemo(() => {
    const g = new Map<string, MenuItem[]>();
    for (const m of filtered) {
      if (!g.has(m.category)) g.set(m.category, []);
      g.get(m.category)!.push(m);
    }
    return g;
  }, [filtered]);

  const openEdit = (item: MenuItem) => {
    if (!canEdit) return;
    setEditing(item);
    setEditPrice(String(item.price));
    setEditReason("");
    setEditNotes("");
  };

  const saveEdit = async () => {
    if (!editing) return;
    const p = Number(editPrice);
    if (!isFinite(p) || p < 0) { toast.error("سعر غير صحيح"); return; }
    if (p === editing.price) { toast.info("لا يوجد تغيير في السعر"); return; }
    if (!editReason.trim()) { toast.error("سبب التعديل مطلوب"); return; }

    setSaving(true);
    const { error } = await supabase.from("menu_price_changes").insert({
      item_id: editing.id,
      item_name_ar: editing.name_ar,
      item_name_en: editing.name_en,
      category: editing.category,
      old_price: editing.price,
      new_price: p,
      unit: editing.unit,
      reason: editReason.trim(),
      notes: editNotes.trim() || null,
      changed_by: user?.id ?? null,
      changed_by_name: profile?.full_name || user?.email || null,
    });
    setSaving(false);

    if (error) {
      toast.error("تعذّر حفظ السعر: " + error.message);
      return;
    }
    toast.success("تم تحديث السعر");
    setEditing(null);
    await loadHistory();
  };

  const printMenu = () => {
    const sections = CATEGORIES.map((cat) => {
      const rows = menu.filter((m) => m.category === cat);
      if (!rows.length) return "";
      return `
        <section class="cat">
          <h2>${esc(cat)}</h2>
          <div class="grid">
            ${rows.map((r) => `
              <div class="item">
                <div class="price">
                  <span class="num">${r.price}</span>
                  <span class="u">${esc(r.unit)}</span>
                </div>
                <div class="names">
                  <div class="en">${esc(r.name_en)}</div>
                  <div class="ar">${esc(r.name_ar)}</div>
                  ${r.weight ? `<div class="wt">${esc(r.weight)}</div>` : ""}
                </div>
              </div>`).join("")}
          </div>
        </section>`;
    }).join("");

    const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
      <title>منيو شركة نعام العاصمة</title>
      <style>
        @page { size: A4; margin: 12mm; }
        * { box-sizing: border-box; }
        body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; color: #1a1a1a; margin:0; background:#fafaf7; }
        .header { display:flex; align-items:center; justify-content:space-between; padding: 14px 18px; border-bottom: 3px double #7c1d2e; background:#fff; }
        .header img { height: 64px; }
        .brand { text-align:center; flex:1; }
        .brand h1 { margin:0; font-size: 22px; color:#7c1d2e; letter-spacing: 1px; }
        .brand p { margin: 2px 0 0; font-size: 12px; color:#666; }
        .hotline { font-size: 12px; color:#7c1d2e; font-weight: bold; min-width: 80px; text-align:left; }
        .updated { text-align:center; padding: 6px; font-size: 11px; color:#777; background:#fff; }
        .cat { padding: 10px 16px; }
        .cat h2 {
          margin: 14px 0 8px;
          font-size: 16px;
          color: #fff;
          background: linear-gradient(90deg, #7c1d2e, #b91c1c);
          padding: 6px 12px;
          border-radius: 4px;
          letter-spacing: 1px;
        }
        .grid {
          display:grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px 18px;
        }
        .item {
          display:flex;
          align-items:center;
          gap: 10px;
          padding: 6px 8px;
          border-bottom: 1px dotted #d4a373;
        }
        .price { min-width: 70px; text-align:center; line-height: 1; }
        .price .num { display:block; font-size: 24px; font-weight: 900; color:#b91c1c; }
        .price .u { font-size: 9px; color:#7c1d2e; }
        .names { flex:1; }
        .names .en { font-size: 13px; font-weight: 700; color: #1a1a1a; letter-spacing: 0.5px; }
        .names .ar { font-size: 14px; font-weight: 600; color: #4a1d1d; margin-top: 2px; }
        .names .wt { font-size: 10px; color:#7a5a2a; margin-top: 2px; }
        .footer { text-align:center; padding: 8px; font-size: 11px; color:#666; border-top: 1px solid #ddd; }
        @media print { .no-print { display:none; } body { background:#fff; } }
        .bar { text-align:center; padding:10px; }
        .bar button { padding:8px 18px; font-size:14px; cursor:pointer; }
      </style></head><body>
      <div class="bar no-print"><button onclick="window.print()">طباعة / حفظ PDF</button></div>
      <div class="header">
        <img src="${companyLogo}" />
        <div class="brand">
          <h1>منيو شركة نعام العاصمة</h1>
          <p>Capital Ostrich Company — Menu</p>
        </div>
        <div class="hotline">Hotline<br/>${HOTLINE}</div>
      </div>
      <div class="updated">
        ${lastUpdatedAt ? `آخر تحديث للأسعار: ${new Date(lastUpdatedAt).toLocaleString("ar-EG")}` : `تاريخ الطباعة: ${new Date().toLocaleString("ar-EG")}`}
      </div>
      ${sections}
      <div class="footer">جميع الأسعار شاملة • للتواصل: ${HOTLINE} • www.coceg.net</div>
      <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400));</script>
      </body></html>`;
    const w = window.open("", "_blank", "width=1000,height=800");
    if (!w) return;
    w.document.open(); w.document.write(html); w.document.close();
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="w-5 h-5 text-primary" />
              <div>
                <CardTitle className="text-lg">منيو شركة نعام العاصمة</CardTitle>
                <CardDescription>
                  قائمة المنتجات والأسعار للعرض والطباعة وإدارة الأسعار فقط
                  {lastUpdatedAt && (
                    <> • آخر تحديث: <span className="text-foreground">{formatDateTime(lastUpdatedAt)}</span></>
                  )}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-md border p-0.5">
                <Button size="sm" variant={view === "design" ? "default" : "ghost"} onClick={() => setView("design")}>
                  <LayoutGrid className="w-4 h-4 ml-1" />منيو تصميمي
                </Button>
                <Button size="sm" variant={view === "table" ? "default" : "ghost"} onClick={() => setView("table")}>
                  <Rows className="w-4 h-4 ml-1" />جدول
                </Button>
              </div>
              <Button variant="outline" size="sm" onClick={printMenu}><Printer className="w-4 h-4 ml-1" />طباعة المنيو</Button>
              <Button variant="outline" size="sm" onClick={printMenu}><FileText className="w-4 h-4 ml-1 text-red-600" />تصدير PDF</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث: ستيك، برجر، Shawerma..." className="pr-9" />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل التصنيفات</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            {!canEdit && <Badge variant="outline">عرض فقط</Badge>}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="menu" className="w-full">
        <TabsList>
          <TabsTrigger value="menu"><UtensilsCrossed className="w-4 h-4 ml-1" />المنيو</TabsTrigger>
          <TabsTrigger value="history"><History className="w-4 h-4 ml-1" />سجل تغييرات الأسعار <Badge variant="secondary" className="mr-2">{changes.length}</Badge></TabsTrigger>
        </TabsList>

        {/* MENU */}
        <TabsContent value="menu" className="space-y-4 mt-4">
          {grouped.size === 0 ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد منتجات مطابقة</CardContent></Card>
          ) : view === "design" ? (
            Array.from(grouped.entries()).map(([cat, rows]) => {
              const theme = catTheme[cat] || catTheme["قطع طازجة"];
              return (
                <Card key={cat} className={`overflow-hidden border-2 ${theme.bg}`}>
                  <CardHeader className="pb-3 border-b border-dashed border-current/20">
                    <CardTitle className="text-base flex items-center gap-2 tracking-wide">
                      <span className={`px-3 py-1 rounded ${theme.chip}`}>{cat}</span>
                      <span className="text-xs opacity-70">{rows.length} صنف</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {rows.map((m) => {
                        const wasChanged = changes.some((c) => c.item_id === m.id);
                        return (
                          <div
                            key={m.id}
                            className="group flex items-center gap-3 p-3 rounded-lg bg-background/70 border border-current/10 hover:shadow-md transition-shadow"
                          >
                            <div className="text-center min-w-[78px] leading-none">
                              <div className={`text-3xl font-black ${theme.price}`}>{m.price}</div>
                              <div className={`text-[10px] font-semibold ${theme.price} opacity-80`}>{m.unit}</div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-bold tracking-wide truncate" dir="ltr">{m.name_en}</div>
                              <div className="text-sm font-semibold mt-0.5 truncate">{m.name_ar}</div>
                              {m.weight && <div className="text-[10px] opacity-70 mt-0.5">{m.weight}</div>}
                              {wasChanged && <Badge variant="outline" className="mt-1 text-[10px] h-5">تم تعديل السعر</Badge>}
                            </div>
                            {canEdit && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => openEdit(m)}
                                title="تعديل السعر"
                                className="opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          ) : (
            // Table view
            Array.from(grouped.entries()).map(([cat, rows]) => (
              <Card key={cat}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    {cat} <Badge variant="secondary">{rows.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الاسم بالعربي</TableHead>
                        <TableHead>الاسم بالإنجليزي</TableHead>
                        <TableHead>السعر</TableHead>
                        <TableHead>الوحدة</TableHead>
                        <TableHead>الوزن</TableHead>
                        {canEdit && <TableHead className="w-20">إجراء</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="font-medium">{m.name_ar}</TableCell>
                          <TableCell className="text-muted-foreground" dir="ltr">{m.name_en}</TableCell>
                          <TableCell>
                            <span className="font-bold text-primary text-lg">{m.price}</span>
                            <span className="text-xs text-muted-foreground mr-1">ج.م</span>
                          </TableCell>
                          <TableCell className="text-xs">{m.unit}</TableCell>
                          <TableCell className="text-xs">{m.weight || "—"}</TableCell>
                          {canEdit && (
                            <TableCell>
                              <Button size="sm" variant="ghost" onClick={() => openEdit(m)}>
                                <Pencil className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* HISTORY */}
        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <History className="w-4 h-4" /> سجل تغييرات الأسعار
              </CardTitle>
              <CardDescription>كل التعديلات السابقة على أسعار المنيو — لا تؤثر على الطلبات أو الفواتير القديمة</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {changes.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">لم يتم تعديل أي سعر بعد</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المنتج</TableHead>
                      <TableHead>التصنيف</TableHead>
                      <TableHead>السعر القديم</TableHead>
                      <TableHead>السعر الجديد</TableHead>
                      <TableHead>الوحدة</TableHead>
                      <TableHead>سبب التعديل</TableHead>
                      <TableHead>ملاحظات</TableHead>
                      <TableHead>المستخدم</TableHead>
                      <TableHead>التاريخ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {changes.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">
                          {c.item_name_ar}
                          <span className="text-xs text-muted-foreground block" dir="ltr">{c.item_name_en}</span>
                        </TableCell>
                        <TableCell className="text-xs">{c.category}</TableCell>
                        <TableCell className="text-muted-foreground line-through">{c.old_price ?? "—"}</TableCell>
                        <TableCell className="font-bold text-primary">{c.new_price}</TableCell>
                        <TableCell className="text-xs">{c.unit}</TableCell>
                        <TableCell className="text-xs">{c.reason || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.notes || "—"}</TableCell>
                        <TableCell className="text-xs">{c.changed_by_name || "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{formatDateTime(c.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل سعر: {editing?.name_ar}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><Label className="text-xs">التصنيف</Label><div className="font-medium">{editing.category}</div></div>
                <div><Label className="text-xs">الوحدة</Label><div className="font-medium">{editing.unit}</div></div>
                <div><Label className="text-xs">السعر الحالي</Label><div className="font-bold text-lg text-primary">{editing.price} ج.م</div></div>
                <div>
                  <Label className="text-xs">السعر الجديد *</Label>
                  <Input type="number" step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} className="font-bold text-lg" />
                </div>
              </div>
              <div>
                <Label>سبب التعديل *</Label>
                <Input value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="مثال: ارتفاع التكلفة، تحديث موسمي..." />
              </div>
              <div>
                <Label>ملاحظات (اختياري)</Label>
                <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} />
              </div>
              <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                ⚠️ تعديل السعر يظهر في المنيو ويُحفظ في السجل، ولا يؤثر على أسعار الطلبات أو الفواتير القديمة.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>إلغاء</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ السعر الجديد"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
