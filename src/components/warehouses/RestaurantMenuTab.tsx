import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Printer, FileText, Search, Pencil, UtensilsCrossed } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import companyLogo from "@/assets/company-logo.jpg";

interface MenuItem {
  id: string;
  category: string;
  name_ar: string;
  name_en: string;
  price: number;
  unit: string;
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
  { id: "shank", category: "قطع طازجة", name_ar: "موزة", name_en: "Shank", price: 500, unit: "كجم" },
  { id: "steak", category: "قطع طازجة", name_ar: "ستيك", name_en: "Steak", price: 500, unit: "كجم" },
  { id: "farasha", category: "قطع طازجة", name_ar: "قطعية فراشة", name_en: "Farasha", price: 510, unit: "كجم" },
  { id: "drumstick-bl", category: "قطع طازجة", name_ar: "قطعية دبوس بدون عظم", name_en: "Drumstick Boneless", price: 500, unit: "كجم" },
  { id: "eye-round", category: "قطع طازجة", name_ar: "عرق تربيانكو", name_en: "Eye-Round", price: 530, unit: "كجم" },
  { id: "escalope", category: "قطع طازجة", name_ar: "إسكالوب", name_en: "Escalope", price: 530, unit: "كجم" },
  { id: "roll", category: "قطع طازجة", name_ar: "رول", name_en: "Roll", price: 500, unit: "كجم" },
  { id: "cubes", category: "قطع طازجة", name_ar: "قطع لحم", name_en: "Meat Cubes", price: 490, unit: "كجم" },
  // بالعظم
  { id: "whole-bone", category: "منتجات بالعظم", name_ar: "نعامة كاملة بالعظم", name_en: "Whole Ostrich With Bone", price: 390, unit: "كجم" },
  { id: "thigh-bone", category: "منتجات بالعظم", name_ar: "فخدة / ورك بالعظم", name_en: "Thigh With Bone", price: 390, unit: "كجم" },
  { id: "drumstick-bone", category: "منتجات بالعظم", name_ar: "دبوس بالعظم", name_en: "Drumstick With Bone", price: 420, unit: "كجم" },
  // متبلة
  { id: "kebab", category: "منتجات متبلة", name_ar: "قطع كباب", name_en: "Kebab Cubes", price: 470, unit: "كجم" },
  { id: "shish-kebab", category: "منتجات متبلة", name_ar: "شيش كباب", name_en: "Shish Kebab", price: 450, unit: "كجم" },
  { id: "shawerma", category: "منتجات متبلة", name_ar: "شاورما", name_en: "Shawerma", price: 450, unit: "كجم" },
  { id: "hawawshi", category: "منتجات متبلة", name_ar: "عجينة حواوشي", name_en: "Hawawshi Paste", price: 250, unit: "كجم" },
  // مصنعة
  { id: "burger", category: "منتجات مصنعة", name_ar: "برجر", name_en: "Burger", price: 390, unit: "كجم" },
  { id: "kofta", category: "منتجات مصنعة", name_ar: "كفتة", name_en: "Kofta", price: 390, unit: "كجم" },
  { id: "rice-kofta", category: "منتجات مصنعة", name_ar: "كفتة أرز", name_en: "Rice Kofta", price: 250, unit: "كجم" },
  { id: "rice-mombar", category: "منتجات مصنعة", name_ar: "ممبار أرز", name_en: "Rice Mombar", price: 250, unit: "كجم" },
  { id: "sausages", category: "منتجات مصنعة", name_ar: "سجق شرقي", name_en: "Oriental Sausages", price: 390, unit: "كجم" },
  { id: "luncheon", category: "منتجات مصنعة", name_ar: "لانشون سادة / فلفل أسود", name_en: "Luncheon Plain/Black Pepper", price: 80, unit: "250 جم" },
  // أعضاء
  { id: "liver", category: "أعضاء وأجزاء", name_ar: "كبدة", name_en: "Liver", price: 500, unit: "كجم" },
  { id: "heart", category: "أعضاء وأجزاء", name_ar: "قلب", name_en: "Heart", price: 300, unit: "كجم" },
  { id: "gizzard", category: "أعضاء وأجزاء", name_ar: "قوانصة", name_en: "Gizzard", price: 260, unit: "كجم" },
  { id: "neck", category: "أعضاء وأجزاء", name_ar: "رقبة", name_en: "Neck", price: 300, unit: "كجم" },
  { id: "fat", category: "أعضاء وأجزاء", name_ar: "دهن خام", name_en: "Fat", price: 150, unit: "كجم" },
  { id: "knuckle", category: "أعضاء وأجزاء", name_ar: "كوارع", name_en: "Knuckle", price: 260, unit: "كجم" },
  { id: "marrow", category: "أعضاء وأجزاء", name_ar: "نخاع", name_en: "Marrow", price: 200, unit: "كجم" },
  { id: "minced", category: "أعضاء وأجزاء", name_ar: "لحم مفروم", name_en: "Minced Meat", price: 320, unit: "كجم" },
];

const STORAGE_KEY = "warehouses_menu_overrides_v1";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export default function RestaurantMenuTab() {
  const { isGeneralManager, isExecutiveManager } = useAuth();
  const canEdit = isGeneralManager || isExecutiveManager;

  const [overrides, setOverrides] = useState<Record<string, { price: number; notes?: string }>>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
  });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editNotes, setEditNotes] = useState("");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  }, [overrides]);

  const menu = useMemo<MenuItem[]>(
    () => DEFAULT_MENU.map((m) => ({
      ...m,
      price: overrides[m.id]?.price ?? m.price,
      notes: overrides[m.id]?.notes ?? m.notes,
    })),
    [overrides]
  );

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
    setEditing(item);
    setEditPrice(String(item.price));
    setEditNotes(item.notes || "");
  };

  const saveEdit = () => {
    if (!editing) return;
    const p = Number(editPrice);
    if (!isFinite(p) || p < 0) { toast.error("سعر غير صحيح"); return; }
    setOverrides((o) => ({ ...o, [editing.id]: { price: p, notes: editNotes || undefined } }));
    toast.success("تم تحديث السعر");
    setEditing(null);
  };

  const resetPrice = () => {
    if (!editing) return;
    setOverrides((o) => { const n = { ...o }; delete n[editing.id]; return n; });
    toast.success("تمت إعادة السعر للأصلي");
    setEditing(null);
  };

  const printMenu = () => {
    const sections = CATEGORIES.map((cat) => {
      const rows = menu.filter((m) => m.category === cat);
      if (!rows.length) return "";
      return `
        <h2>${esc(cat)}</h2>
        <table>
          <thead><tr><th>الصنف</th><th>English</th><th>السعر</th><th>الوحدة</th><th>ملاحظات</th></tr></thead>
          <tbody>${rows.map((r) => `
            <tr>
              <td>${esc(r.name_ar)}</td>
              <td>${esc(r.name_en)}</td>
              <td>${r.price} ج</td>
              <td>${esc(r.unit)}</td>
              <td>${esc(r.notes || "")}</td>
            </tr>`).join("")}</tbody>
        </table>`;
    }).join("");
    const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
      <title>منيو نعام العاصمة</title>
      <style>
        @page { size: A4; margin: 14mm; }
        body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; color: #111; }
        .header { display:flex; align-items:center; justify-content:space-between; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 14px; }
        .header img { height: 70px; }
        h1 { margin:0; font-size: 22px; text-align:center; }
        h2 { margin-top: 18px; color:#7c3aed; border-bottom: 1px solid #e5e5e5; padding-bottom: 4px; }
        table { width:100%; border-collapse: collapse; font-size: 13px; margin-top: 6px; }
        th, td { border:1px solid #ccc; padding:6px 8px; text-align:right; }
        th { background:#f5f5f5; }
        @media print { .no-print { display:none; } }
        .bar { text-align:center; margin-bottom:10px; }
        .bar button { padding:8px 18px; font-size:14px; cursor:pointer; }
      </style></head><body>
      <div class="bar no-print"><button onclick="window.print()">طباعة / حفظ PDF</button></div>
      <div class="header">
        <img src="${companyLogo}" />
        <div><h1>منيو نعام العاصمة</h1><p style="text-align:center;color:#666;margin:4px 0">${new Date().toLocaleString("ar-EG")}</p></div>
        <div style="width:70px"></div>
      </div>
      ${sections}
      <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400));</script>
      </body></html>`;
    const w = window.open("", "_blank", "width=900,height=800");
    if (!w) return;
    w.document.open(); w.document.write(html); w.document.close();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="w-5 h-5 text-primary" />
              <div>
                <CardTitle className="text-lg">منيو نعام العاصمة</CardTitle>
                <CardDescription>قائمة المنتجات والأسعار للعرض وإدارة الأسعار فقط</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={printMenu}><Printer className="w-4 h-4 ml-1" />طباعة</Button>
              <Button variant="outline" size="sm" onClick={printMenu}><FileText className="w-4 h-4 ml-1 text-red-600" />تصدير PDF</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث باسم المنتج..."
                className="pr-9"
              />
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

      {grouped.size === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد منتجات مطابقة</CardContent></Card>
      ) : (
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
                    <TableHead>ملاحظات</TableHead>
                    {canEdit && <TableHead className="w-20">إجراء</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((m) => {
                    const overridden = overrides[m.id] !== undefined;
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium">{m.name_ar}</TableCell>
                        <TableCell className="text-muted-foreground">{m.name_en}</TableCell>
                        <TableCell>
                          <span className="font-bold text-primary">{m.price}</span>
                          <span className="text-xs text-muted-foreground mr-1">ج.م</span>
                          {overridden && <Badge variant="outline" className="mr-2 text-xs">معدَّل</Badge>}
                        </TableCell>
                        <TableCell>{m.unit}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{m.notes || "—"}</TableCell>
                        {canEdit && (
                          <TableCell>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(m)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل سعر: {editing?.name_ar}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {editing.category} • {editing.unit}
              </div>
              <div>
                <Label>السعر الجديد (ج.م)</Label>
                <Input type="number" step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
              </div>
              <div>
                <Label>ملاحظات</Label>
                <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="اختياري" />
              </div>
            </div>
          )}
          <DialogFooter>
            {editing && overrides[editing.id] && (
              <Button variant="outline" onClick={resetPrice}>إعادة السعر الأصلي</Button>
            )}
            <Button variant="outline" onClick={() => setEditing(null)}>إلغاء</Button>
            <Button onClick={saveEdit}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
