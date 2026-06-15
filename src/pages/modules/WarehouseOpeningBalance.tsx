import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PackagePlus, Save, ShieldCheck, Info, Search, FileSpreadsheet, Upload, CheckCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { useRef } from "react";

interface Warehouse { id: string; name: string; operational_start_date: string | null }
interface Item { id: string; name: string; unit: string; stock: number; unit_cost: number }
interface OB {
  id: string;
  item_id: string;
  qty: number;
  unit_cost: number;
  notes: string | null;
  status: string;
  approved_at: string | null;
}

type Draft = { qty: string; unit_cost: string; notes: string };

const TARGETS = ["المخزن الرئيسي", "العجوزة"];

export default function WarehouseOpeningBalance() {
  const { isGeneralManager, isExecutiveManager, user } = useAuth();
  const canApprove = isGeneralManager || isExecutiveManager;
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [activeWh, setActiveWh] = useState<string>("");
  const [items, setItems] = useState<Item[]>([]);
  const [obs, setObs] = useState<Record<string, OB>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const loadWarehouses = async () => {
    const { data } = await supabase
      .from("warehouses")
      .select("id, name, operational_start_date")
      .or("name.ilike.%رئيسي%,name.ilike.%عجوزة%");
    const list = (data || []) as Warehouse[];
    setWarehouses(list);
    if (list.length && !activeWh) setActiveWh(list[0].id);
  };

  const loadItems = async (whId: string) => {
    setLoading(true);
    const [{ data: itemRows }, { data: obRows }] = await Promise.all([
      supabase
        .from("inventory_items")
        .select("id, name, unit, stock, unit_cost")
        .eq("warehouse_id", whId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("warehouse_opening_balances")
        .select("id, item_id, qty, unit_cost, notes, status, approved_at")
        .eq("warehouse_id", whId),
    ]);
    const its = (itemRows || []) as Item[];
    setItems(its);
    const obMap: Record<string, OB> = {};
    (obRows || []).forEach((r: any) => { obMap[r.item_id] = r as OB; });
    setObs(obMap);
    const d: Record<string, Draft> = {};
    its.forEach((it) => {
      const ob = obMap[it.id];
      d[it.id] = {
        qty: ob ? String(ob.qty) : "",
        unit_cost: ob ? String(ob.unit_cost) : String(it.unit_cost || 0),
        notes: ob?.notes || "",
      };
    });
    setDrafts(d);
    setLoading(false);
  };

  useEffect(() => { loadWarehouses(); }, []);
  useEffect(() => { if (activeWh) loadItems(activeWh); }, [activeWh]);

  const saveDraft = async (itemId: string) => {
    const d = drafts[itemId];
    if (!d || d.qty === "") { toast.error("أدخل الكمية"); return; }
    const ob = obs[itemId];
    if (ob?.status === "approved") { toast.error("معتمد بالفعل — لا يمكن التعديل"); return; }
    setBusy(itemId);
    try {
      const payload: any = {
        warehouse_id: activeWh,
        item_id: itemId,
        qty: Number(d.qty),
        unit_cost: Number(d.unit_cost || 0),
        notes: d.notes || null,
        opened_by: user?.id,
        counted_by: user?.id,
        status: "draft",
      };
      if (ob) {
        const { error } = await supabase
          .from("warehouse_opening_balances")
          .update(payload)
          .eq("id", ob.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("warehouse_opening_balances")
          .insert(payload);
        if (error) throw error;
      }
      toast.success("تم الحفظ كمسودة");
      await loadItems(activeWh);
    } catch (e: any) {
      toast.error(e.message || "فشل الحفظ");
    } finally { setBusy(null); }
  };

  const approve = async (itemId: string) => {
    const ob = obs[itemId];
    if (!ob) { toast.error("احفظ أولاً"); return; }
    if (!canApprove) { toast.error("ليست لديك صلاحية الاعتماد"); return; }
    setBusy(itemId);
    try {
      const { error } = await supabase.rpc("approve_warehouse_opening_balance", { p_id: ob.id });
      if (error) throw error;
      toast.success("تم الاعتماد وتسجيل الرصيد الافتتاحي");
      await loadItems(activeWh);
    } catch (e: any) {
      toast.error(e.message || "فشل الاعتماد");
    } finally { setBusy(null); }
  };

  const fileRef = useRef<HTMLInputElement | null>(null);

  const downloadTemplate = () => {
    const wh = warehouses.find((w) => w.id === activeWh);
    if (!wh) return;
    const rows = items.map((it) => {
      const ob = obs[it.id];
      const d = drafts[it.id];
      return {
        "كود الصنف": it.id,
        "الصنف": it.name,
        "الوحدة": it.unit,
        "الكمية الفعلية بعد الجرد": d?.qty || "",
        "سعر التكلفة": d?.unit_cost || it.unit_cost || 0,
        "ملاحظات": d?.notes || "",
        "الحالة": ob?.status === "approved" ? "معتمد" : ob ? "مسودة" : "لم يدخل",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 38 }, { wch: 32 }, { wch: 10 }, { wch: 22 }, { wch: 14 }, { wch: 28 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "الرصيد الافتتاحي");
    XLSX.writeFile(wb, `رصيد-افتتاحي-${wh.name}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success("تم تحميل ملف الجرد. املأ الكميات وأعد رفعه.");
  };

  const importExcel = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(ws);
      let updated = 0, skipped = 0;
      const newDrafts = { ...drafts };
      for (const r of rows) {
        const itemId = String(r["كود الصنف"] || "").trim();
        if (!itemId || !items.find((i) => i.id === itemId)) { skipped++; continue; }
        const qty = r["الكمية الفعلية بعد الجرد"];
        if (qty === undefined || qty === null || qty === "") { skipped++; continue; }
        const ob = obs[itemId];
        if (ob?.status === "approved") { skipped++; continue; }
        newDrafts[itemId] = {
          qty: String(qty),
          unit_cost: String(r["سعر التكلفة"] ?? newDrafts[itemId]?.unit_cost ?? 0),
          notes: String(r["ملاحظات"] || newDrafts[itemId]?.notes || ""),
        };
        updated++;
      }
      setDrafts(newDrafts);
      toast.success(`تم تحميل ${updated} صف. تخطي ${skipped}. اضغط "حفظ الكل" ثم اعتمد.`);
    } catch (e: any) {
      toast.error("فشل قراءة الملف: " + (e?.message || e));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const saveAll = async () => {
    setBusy("__save_all__");
    let ok = 0, fail = 0;
    for (const it of items) {
      const d = drafts[it.id];
      const ob = obs[it.id];
      if (!d || d.qty === "" || ob?.status === "approved") continue;
      try {
        const payload: any = {
          warehouse_id: activeWh, item_id: it.id,
          qty: Number(d.qty), unit_cost: Number(d.unit_cost || 0),
          notes: d.notes || null, opened_by: user?.id,
          counted_by: user?.id, status: "draft",
        };
        if (ob) await supabase.from("warehouse_opening_balances").update(payload).eq("id", ob.id);
        else await supabase.from("warehouse_opening_balances").insert(payload);
        ok++;
      } catch { fail++; }
    }
    setBusy(null);
    toast[fail ? "warning" : "success"](`حُفظ ${ok} ${fail ? `— فشل ${fail}` : ""}`);
    await loadItems(activeWh);
  };

  const approveAll = async () => {
    if (!canApprove) { toast.error("ليست لديك صلاحية الاعتماد"); return; }
    if (!confirm("اعتماد كل المسودات الحالية؟ بعد الاعتماد لا يمكن التعديل.")) return;
    setBusy("__approve_all__");
    let ok = 0, fail = 0;
    for (const ob of Object.values(obs)) {
      if (ob.status === "approved") continue;
      try {
        const { error } = await supabase.rpc("approve_warehouse_opening_balance", { p_id: ob.id });
        if (error) throw error;
        ok++;
      } catch { fail++; }
    }
    setBusy(null);
    toast[fail ? "warning" : "success"](`اعتُمد ${ok}${fail ? ` — فشل ${fail}` : ""}`);
    await loadItems(activeWh);
  };

  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return items;
    return items.filter((i) => i.name.includes(q));
  }, [items, search]);

  const totals = useMemo(() => {
    let count = 0, value = 0, approved = 0;
    items.forEach((it) => {
      const d = drafts[it.id];
      const ob = obs[it.id];
      if (d && d.qty !== "") {
        count++;
        value += Number(d.qty || 0) * Number(d.unit_cost || 0);
      }
      if (ob?.status === "approved") approved++;
    });
    return { count, value, approved };
  }, [items, drafts, obs]);

  const activeWhObj = warehouses.find((w) => w.id === activeWh);

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4" dir="rtl">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <PackagePlus className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">الرصيد الافتتاحي للمخازن</h1>
            <p className="text-sm text-muted-foreground">
              أدخل الكميات الفعلية بعد الجرد. عند اعتماد المدير العام/التنفيذي يتم تسجيل حركة opening_balance مرجعها فريد ولا يمكن تكرارها.
            </p>
          </div>
        </div>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            تاريخ بداية التشغيل يبقى <b>فارغًا</b> حتى يتم اعتماد الرصيد الافتتاحي لكل الأصناف. بعد الاعتماد يمكن تحديد التاريخ من شاشة "تواريخ بداية التشغيل الفعلي".
          </AlertDescription>
        </Alert>

        <Tabs value={activeWh} onValueChange={setActiveWh}>
          <TabsList>
            {warehouses.map((w) => (
              <TabsTrigger key={w.id} value={w.id}>{w.name}</TabsTrigger>
            ))}
          </TabsList>

          {warehouses.map((w) => (
            <TabsContent key={w.id} value={w.id} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <Card><CardContent className="pt-6">
                  <div className="text-xs text-muted-foreground">المخزن</div>
                  <div className="font-bold">{w.name}</div>
                </CardContent></Card>
                <Card><CardContent className="pt-6">
                  <div className="text-xs text-muted-foreground">عدد الأصناف</div>
                  <div className="font-bold">{items.length}</div>
                </CardContent></Card>
                <Card><CardContent className="pt-6">
                  <div className="text-xs text-muted-foreground">المعتمد</div>
                  <div className="font-bold text-emerald-600">{totals.approved} / {items.length}</div>
                </CardContent></Card>
                <Card><CardContent className="pt-6">
                  <div className="text-xs text-muted-foreground">إجمالي قيمة المسودة</div>
                  <div className="font-bold">{totals.value.toLocaleString("ar-EG", { maximumFractionDigits: 2 })}</div>
                </CardContent></Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>أصناف {w.name}</span>
                    {activeWhObj?.operational_start_date ? (
                      <Badge className="bg-emerald-500/15 text-emerald-700">تشغيل: {activeWhObj.operational_start_date}</Badge>
                    ) : (
                      <Badge variant="outline">تاريخ التشغيل: غير محدد</Badge>
                    )}
                  </CardTitle>
                  <CardDescription>اكتب الكمية الفعلية وسعر التكلفة، احفظ، ثم اعتمد ليُسجل الرصيد الافتتاحي رسميًا.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 justify-between border rounded-md p-2 bg-muted/30">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={downloadTemplate} disabled={!items.length}>
                        <FileSpreadsheet className="w-3 h-3 ml-1" /> تحميل ملف الجرد (Excel)
                      </Button>
                      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                        onChange={(e) => e.target.files?.[0] && importExcel(e.target.files[0])} />
                      <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                        <Upload className="w-3 h-3 ml-1" /> رفع نتائج الجرد
                      </Button>
                      <Button size="sm" variant="outline" onClick={saveAll} disabled={busy === "__save_all__"}>
                        <Save className="w-3 h-3 ml-1" /> حفظ الكل كمسودة
                      </Button>
                      <Button size="sm" onClick={approveAll}
                        disabled={!canApprove || busy === "__approve_all__" || Object.values(obs).every((o) => o.status === "approved")}>
                        <CheckCheck className="w-3 h-3 ml-1" /> اعتماد الكل
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      الترتيب: تحميل الملف → جرد فعلي → رفع → حفظ → اعتماد → تحديد تاريخ التشغيل.
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Search className="w-4 h-4 text-muted-foreground" />
                    <Input placeholder="بحث باسم الصنف..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" />
                  </div>
                  {loading ? (
                    <div className="text-center py-8 text-muted-foreground">جاري التحميل...</div>
                  ) : items.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">لا توجد أصناف لهذا المخزن. أنشئ الأصناف أولًا من شاشة المخزن.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>الصنف</TableHead>
                            <TableHead>الوحدة</TableHead>
                            <TableHead>الكمية الفعلية</TableHead>
                            <TableHead>سعر التكلفة</TableHead>
                            <TableHead>الإجمالي</TableHead>
                            <TableHead>ملاحظات</TableHead>
                            <TableHead>الحالة</TableHead>
                            <TableHead className="text-left">إجراءات</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filtered.map((it) => {
                            const d = drafts[it.id] || { qty: "", unit_cost: "0", notes: "" };
                            const ob = obs[it.id];
                            const approved = ob?.status === "approved";
                            const total = (Number(d.qty || 0) * Number(d.unit_cost || 0));
                            return (
                              <TableRow key={it.id}>
                                <TableCell className="font-medium">{it.name}</TableCell>
                                <TableCell>{it.unit}</TableCell>
                                <TableCell>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    className="w-28"
                                    value={d.qty}
                                    disabled={approved}
                                    onChange={(e) => setDrafts((s) => ({ ...s, [it.id]: { ...d, qty: e.target.value } }))}
                                  />
                                </TableCell>
                                <TableCell>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    className="w-28"
                                    value={d.unit_cost}
                                    disabled={approved}
                                    onChange={(e) => setDrafts((s) => ({ ...s, [it.id]: { ...d, unit_cost: e.target.value } }))}
                                  />
                                </TableCell>
                                <TableCell className="font-mono">{total.toLocaleString("ar-EG", { maximumFractionDigits: 2 })}</TableCell>
                                <TableCell>
                                  <Input
                                    className="w-40"
                                    value={d.notes}
                                    disabled={approved}
                                    onChange={(e) => setDrafts((s) => ({ ...s, [it.id]: { ...d, notes: e.target.value } }))}
                                  />
                                </TableCell>
                                <TableCell>
                                  {approved ? (
                                    <Badge className="bg-emerald-500/15 text-emerald-700">معتمد</Badge>
                                  ) : ob ? (
                                    <Badge variant="outline">مسودة</Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-muted-foreground">لم يدخل</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-left">
                                  <div className="flex gap-1 justify-end">
                                    <Button size="sm" variant="outline" disabled={approved || busy === it.id} onClick={() => saveDraft(it.id)}>
                                      <Save className="w-3 h-3 ml-1" /> حفظ
                                    </Button>
                                    <Button size="sm" disabled={!ob || approved || !canApprove || busy === it.id} onClick={() => approve(it.id)}>
                                      <ShieldCheck className="w-3 h-3 ml-1" /> اعتماد
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
