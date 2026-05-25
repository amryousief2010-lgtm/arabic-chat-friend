import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Boxes, ArrowDownUp, AlertTriangle, RefreshCw, Search, Download,
  ArrowRightLeft, FileEdit, Package2, DollarSign, Lock, Unlock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDate } from "@/lib/dateFormat";

type Balance = {
  id: string;
  item_code: string | null;
  name: string;
  category: string | null;
  unit: string;
  module: string | null;
  warehouse_id: string;
  warehouse_name: string;
  warehouse_type: string;
  current_stock: number;
  reserved_stock: number;
  blocked_stock: number;
  available_stock: number;
  unit_cost: number;
  total_value: number;
  low_stock_threshold: number;
  is_low_stock: boolean;
  blocked_from_costing: boolean;
  last_movement_date: string | null;
  is_active: boolean;
};

type Movement = {
  id: string;
  movement_no: string | null;
  movement_type: string;
  module: string | null;
  quantity: number;
  unit_cost: number | null;
  total_cost: number | null;
  reason: string | null;
  reference: string | null;
  performed_at: string;
  item_id: string;
  warehouse_id: string;
  destination_warehouse_id: string | null;
  approval_status: string;
};

type Warehouse = { id: string; name: string; type: string };

const MOVEMENT_TYPES = [
  "all", "purchase_receipt", "stock_in", "stock_out", "production_consumption",
  "packaging_consumption", "finished_goods_receipt", "adjustment", "transfer",
  "reconciliation", "return", "waste_loss", "in", "out",
];

const MOVEMENT_LABELS: Record<string, string> = {
  purchase_receipt: "استلام شراء", stock_in: "إدخال", stock_out: "إخراج",
  production_consumption: "استهلاك إنتاج", packaging_consumption: "استهلاك تغليف",
  finished_goods_receipt: "استلام تام", adjustment: "تسوية", transfer: "تحويل",
  reconciliation: "تسوية مدير", return: "مرتجع", waste_loss: "هالك",
  in: "دخول", out: "خروج",
};

const InventoryEngine = () => {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [whFilter, setWhFilter] = useState("all");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // Dialogs
  const [dlg, setDlg] = useState<null | "adjust" | "transfer" | "stockin" | "stockout">(null);
  const [activeItem, setActiveItem] = useState<Balance | null>(null);
  const [fQty, setFQty] = useState("");
  const [fCost, setFCost] = useState("");
  const [fDestWh, setFDestWh] = useState("");
  const [fReason, setFReason] = useState("");
  const [fOverride, setFOverride] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [b, m, w] = await Promise.all([
        supabase.from("v_inventory_balances").select("*").limit(2000),
        supabase.from("inventory_movements").select("*").order("performed_at", { ascending: false }).limit(500),
        supabase.from("warehouses").select("id,name,type").eq("is_active", true),
      ]);
      if (b.error) toast.error("فشل تحميل الأرصدة: " + b.error.message);
      else setBalances((b.data || []) as Balance[]);
      if (m.error) toast.error("فشل تحميل الحركات: " + m.error.message);
      else setMovements((m.data || []) as Movement[]);
      if (!w.error) setWarehouses((w.data || []) as Warehouse[]);
      setLoading(false);
    };
    load();
  }, [refreshKey]);

  const kpi = useMemo(() => {
    const total_value = balances.reduce((s, b) => s + Number(b.total_value || 0), 0);
    const low = balances.filter((b) => b.is_low_stock).length;
    const blocked = balances.filter((b) => b.blocked_from_costing).length;
    const negative = balances.filter((b) => b.current_stock < 0).length;
    const items = balances.length;
    return { total_value, low, blocked, negative, items };
  }, [balances]);

  const filteredBalances = useMemo(() => balances.filter((b) => {
    if (whFilter !== "all" && b.warehouse_id !== whFilter) return false;
    if (moduleFilter !== "all" && (b.module || "") !== moduleFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(b.name?.toLowerCase().includes(q) || b.item_code?.toLowerCase().includes(q) || b.category?.toLowerCase().includes(q))) return false;
    }
    return true;
  }), [balances, whFilter, moduleFilter, search]);

  const filteredMovements = useMemo(() => movements.filter((m) => {
    if (whFilter !== "all" && m.warehouse_id !== whFilter && m.destination_warehouse_id !== whFilter) return false;
    if (moduleFilter !== "all" && (m.module || "") !== moduleFilter) return false;
    if (typeFilter !== "all" && m.movement_type !== typeFilter) return false;
    if (dateFrom && m.performed_at < dateFrom) return false;
    if (dateTo && m.performed_at > dateTo + "T23:59:59") return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(m.movement_no?.toLowerCase().includes(q) || m.reason?.toLowerCase().includes(q) || m.reference?.toLowerCase().includes(q))) return false;
    }
    return true;
  }), [movements, whFilter, moduleFilter, typeFilter, dateFrom, dateTo, search]);

  const refresh = () => setRefreshKey((k) => k + 1);

  const openDlg = (type: "adjust" | "transfer" | "stockin" | "stockout", item: Balance) => {
    setActiveItem(item);
    setDlg(type);
    setFQty("");
    setFCost(String(item.unit_cost || ""));
    setFDestWh("");
    setFReason("");
    setFOverride(false);
  };

  const closeDlg = () => { setDlg(null); setActiveItem(null); };

  const submit = async () => {
    if (!activeItem) return;
    setSubmitting(true);
    try {
      let res: any;
      if (dlg === "stockin") {
        res = await supabase.rpc("inv_post_movement", {
          p_item_id: activeItem.id, p_warehouse_id: activeItem.warehouse_id,
          p_movement_type: "stock_in", p_quantity: Number(fQty), p_unit_cost: Number(fCost),
          p_module: activeItem.module, p_reason: fReason || null,
        });
      } else if (dlg === "stockout") {
        res = await supabase.rpc("inv_post_movement", {
          p_item_id: activeItem.id, p_warehouse_id: activeItem.warehouse_id,
          p_movement_type: "stock_out", p_quantity: Number(fQty),
          p_module: activeItem.module, p_reason: fReason, p_override_negative: fOverride,
        });
      } else if (dlg === "adjust") {
        res = await supabase.rpc("inv_post_movement", {
          p_item_id: activeItem.id, p_warehouse_id: activeItem.warehouse_id,
          p_movement_type: "adjustment", p_quantity: Number(fQty),
          p_module: activeItem.module, p_reason: fReason,
        });
      } else if (dlg === "transfer") {
        if (!fDestWh) throw new Error("اختر المستودع الوجهة");
        res = await supabase.rpc("inv_transfer", {
          p_source_item_id: activeItem.id, p_destination_warehouse_id: fDestWh,
          p_quantity: Number(fQty), p_reason: fReason,
        });
      }
      if (res?.error) throw res.error;
      toast.success("تم تنفيذ الحركة بنجاح");
      closeDlg();
      refresh();
    } catch (e: any) {
      const msg = e?.message || String(e);
      const map: Record<string, string> = {
        NOT_AUTHORIZED: "غير مصرح لك",
        INVALID_QUANTITY: "كمية غير صالحة",
        INSUFFICIENT_STOCK: "المخزون المتاح غير كافٍ",
        BLOCKED_ZERO_COST: "الصنف محجوب لأن تكلفته صفر — يجب اعتماد التكلفة من مركز المراجعة",
        OVERRIDE_NOT_AUTHORIZED: "لا تملك صلاحية تجاوز فحص المخزون",
        OVERRIDE_REASON_REQUIRED: "يجب كتابة سبب التجاوز",
        SAME_WAREHOUSE: "المستودع المصدر والوجهة متطابقان",
        SOURCE_NOT_FOUND: "الصنف المصدر غير موجود",
      };
      const k = Object.keys(map).find((kk) => msg.includes(kk));
      toast.error(k ? map[k] : "فشل: " + msg);
    } finally {
      setSubmitting(false);
    }
  };

  const exportCsv = (rows: any[], filename: string) => {
    if (!rows.length) return toast.info("لا توجد بيانات للتصدير");
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(","), ...rows.map((r) =>
      headers.map((h) => JSON.stringify(r[h] ?? "")).join(",")
    )].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <Header title="محرك التحكم في المخزون" subtitle="حركات • أرصدة • تحويلات • تنبيهات" />
      <div className="container mx-auto p-4 space-y-4" dir="rtl">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kpi label="إجمالي الأصناف" value={kpi.items} icon={<Boxes />} />
          <Kpi label="قيمة المخزون" value={`${kpi.total_value.toFixed(0)} ج.م`} icon={<DollarSign />} />
          <Kpi label="مخزون منخفض" value={kpi.low} icon={<AlertTriangle />} variant={kpi.low ? "warn" : undefined} />
          <Kpi label="محجوب من التكلفة" value={kpi.blocked} icon={<Lock />} variant={kpi.blocked ? "warn" : undefined} />
          <Kpi label="رصيد سالب" value={kpi.negative} icon={<AlertTriangle />} variant={kpi.negative ? "danger" : undefined} />
        </div>

        {/* Common filters */}
        <Card>
          <CardContent className="pt-4 flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="بحث..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
            </div>
            <Select value={whFilter} onValueChange={setWhFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="المستودع" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المستودعات</SelectItem>
                {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={moduleFilter} onValueChange={setModuleFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="الوحدة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الوحدات</SelectItem>
                <SelectItem value="meat">لحوم</SelectItem>
                <SelectItem value="feed">أعلاف</SelectItem>
                <SelectItem value="shared">مشترك</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={refresh}><RefreshCw className="w-4 h-4 ml-1" />تحديث</Button>
          </CardContent>
        </Card>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-4">
            <TabsTrigger value="dashboard">لوحة</TabsTrigger>
            <TabsTrigger value="balances">الأرصدة</TabsTrigger>
            <TabsTrigger value="ledger">دفتر الحركات</TabsTrigger>
            <TabsTrigger value="alerts">التنبيهات</TabsTrigger>
          </TabsList>

          {/* ========= Dashboard ========= */}
          <TabsContent value="dashboard">
            <div className="grid md:grid-cols-2 gap-3">
              <Card>
                <CardHeader><CardTitle className="text-base">قيمة المخزون حسب الوحدة</CardTitle></CardHeader>
                <CardContent>
                  {["meat", "feed", "shared", null].map((m) => {
                    const list = balances.filter((b) => (b.module || null) === m);
                    const val = list.reduce((s, b) => s + Number(b.total_value || 0), 0);
                    return (
                      <div key={m || "none"} className="flex justify-between py-1 border-b text-sm">
                        <span>{m === "meat" ? "لحوم" : m === "feed" ? "أعلاف" : m === "shared" ? "مشترك" : "غير مصنف"}</span>
                        <span className="font-mono">{val.toFixed(2)} ج.م ({list.length})</span>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">آخر 10 حركات</CardTitle></CardHeader>
                <CardContent>
                  {movements.slice(0, 10).map((m) => (
                    <div key={m.id} className="flex justify-between py-1 border-b text-xs">
                      <span><Badge variant="outline">{MOVEMENT_LABELS[m.movement_type] || m.movement_type}</Badge></span>
                      <span className="font-mono">{m.quantity}</span>
                      <span className="text-muted-foreground">{formatDate(m.performed_at)}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ========= Balances ========= */}
          <TabsContent value="balances">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">{loading ? "..." : `${filteredBalances.length} صنف`}</CardTitle>
                <Button size="sm" variant="outline" onClick={() => exportCsv(filteredBalances, "balances.csv")}>
                  <Download className="w-4 h-4 ml-1" />تصدير CSV
                </Button>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الصنف</TableHead>
                      <TableHead>المستودع</TableHead>
                      <TableHead>الوحدة</TableHead>
                      <TableHead>المخزون</TableHead>
                      <TableHead>محجوز</TableHead>
                      <TableHead>محظور</TableHead>
                      <TableHead>المتاح</TableHead>
                      <TableHead>التكلفة</TableHead>
                      <TableHead>القيمة</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>الإجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredBalances.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.name}<div className="text-xs text-muted-foreground">{b.category}</div></TableCell>
                        <TableCell className="text-xs">{b.warehouse_name}</TableCell>
                        <TableCell><Badge variant="outline">{b.module || "—"}</Badge></TableCell>
                        <TableCell className={b.current_stock < 0 ? "text-destructive font-bold" : ""}>{b.current_stock}</TableCell>
                        <TableCell>{b.reserved_stock}</TableCell>
                        <TableCell>{b.blocked_stock}</TableCell>
                        <TableCell className="font-bold">{b.available_stock}</TableCell>
                        <TableCell className={b.unit_cost === 0 ? "text-destructive" : ""}>{b.unit_cost}</TableCell>
                        <TableCell className="font-mono text-xs">{Number(b.total_value).toFixed(0)}</TableCell>
                        <TableCell className="space-y-1">
                          {b.is_low_stock && <Badge variant="destructive" className="text-[10px]">منخفض</Badge>}
                          {b.blocked_from_costing && <Badge variant="destructive" className="text-[10px]">صفر تكلفة</Badge>}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" title="إدخال" onClick={() => openDlg("stockin", b)}>
                              <Package2 className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="outline" title="إخراج" onClick={() => openDlg("stockout", b)}>
                              <ArrowDownUp className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="outline" title="تسوية" onClick={() => openDlg("adjust", b)}>
                              <FileEdit className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="outline" title="تحويل" onClick={() => openDlg("transfer", b)}>
                              <ArrowRightLeft className="w-3 h-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!filteredBalances.length && (
                      <TableRow><TableCell colSpan={11} className="text-center py-6 text-muted-foreground">لا توجد بيانات</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ========= Ledger ========= */}
          <TabsContent value="ledger">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base">{loading ? "..." : `${filteredMovements.length} حركة`}</CardTitle>
                <div className="flex gap-2 flex-wrap">
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="w-[160px]"><SelectValue placeholder="نوع الحركة" /></SelectTrigger>
                    <SelectContent>
                      {MOVEMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t === "all" ? "كل الأنواع" : (MOVEMENT_LABELS[t] || t)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[140px]" />
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-[140px]" />
                  <Button size="sm" variant="outline" onClick={() => exportCsv(filteredMovements, "movements.csv")}>
                    <Download className="w-4 h-4 ml-1" />CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead>الكمية</TableHead>
                      <TableHead>التكلفة</TableHead>
                      <TableHead>الإجمالي</TableHead>
                      <TableHead>المرجع/السبب</TableHead>
                      <TableHead>الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMovements.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono text-xs">{m.movement_no || m.id.slice(0, 8)}</TableCell>
                        <TableCell className="text-xs">{formatDate(m.performed_at)}</TableCell>
                        <TableCell><Badge variant="outline">{MOVEMENT_LABELS[m.movement_type] || m.movement_type}</Badge></TableCell>
                        <TableCell>{m.quantity}</TableCell>
                        <TableCell>{m.unit_cost}</TableCell>
                        <TableCell className="font-mono">{Number(m.total_cost || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-xs max-w-[250px]">{m.reason || m.reference}</TableCell>
                        <TableCell><Badge variant={m.approval_status === "posted" ? "default" : "secondary"}>{m.approval_status}</Badge></TableCell>
                      </TableRow>
                    ))}
                    {!filteredMovements.length && (
                      <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">لا توجد حركات</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ========= Alerts ========= */}
          <TabsContent value="alerts">
            <div className="grid md:grid-cols-3 gap-3">
              <AlertList title="مخزون منخفض" items={balances.filter((b) => b.is_low_stock)} variant="warn" />
              <AlertList title="محجوب من التكلفة (صفر تكلفة)" items={balances.filter((b) => b.blocked_from_costing)} variant="warn" />
              <AlertList title="رصيد سالب" items={balances.filter((b) => b.current_stock < 0)} variant="danger" />
            </div>
          </TabsContent>
        </Tabs>

        {/* ========= Action Dialog ========= */}
        <Dialog open={dlg !== null} onOpenChange={(o) => !o && closeDlg()}>
          <DialogContent dir="rtl">
            <DialogHeader>
              <DialogTitle>
                {dlg === "stockin" && "إدخال مخزون"}
                {dlg === "stockout" && "إخراج مخزون"}
                {dlg === "adjust" && "تسوية رصيد"}
                {dlg === "transfer" && "تحويل بين مستودعين"}
              </DialogTitle>
              <DialogDescription>{activeItem?.name} • {activeItem?.warehouse_name}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="bg-muted p-2 rounded text-xs grid grid-cols-3 gap-2">
                <div>الحالي: <strong>{activeItem?.current_stock}</strong></div>
                <div>المتاح: <strong>{activeItem?.available_stock}</strong></div>
                <div>التكلفة: <strong>{activeItem?.unit_cost}</strong></div>
              </div>
              <div>
                <label className="text-sm font-medium">
                  {dlg === "adjust" ? "القيمة الجديدة (الرصيد المطلق)" : "الكمية"} *
                </label>
                <Input type="number" value={fQty} onChange={(e) => setFQty(e.target.value)} />
              </div>
              {dlg === "stockin" && (
                <div>
                  <label className="text-sm font-medium">تكلفة الوحدة *</label>
                  <Input type="number" step="0.01" value={fCost} onChange={(e) => setFCost(e.target.value)} />
                  <div className="text-xs text-muted-foreground mt-1">سيتم حساب متوسط مرجح جديد + حفظ القديم في تاريخ التكلفة.</div>
                </div>
              )}
              {dlg === "transfer" && (
                <div>
                  <label className="text-sm font-medium">المستودع الوجهة *</label>
                  <Select value={fDestWh} onValueChange={setFDestWh}>
                    <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                    <SelectContent>
                      {warehouses.filter((w) => w.id !== activeItem?.warehouse_id).map((w) => (
                        <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <label className="text-sm font-medium">السبب{(dlg !== "stockin") && " *"}</label>
                <Textarea value={fReason} onChange={(e) => setFReason(e.target.value)} />
              </div>
              {dlg === "stockout" && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={fOverride} onChange={(e) => setFOverride(e.target.checked)} />
                  تجاوز فحص المخزون (يتطلب صلاحية مدير + سبب)
                </label>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeDlg}>إلغاء</Button>
              <Button onClick={submit} disabled={submitting}>{submitting ? "..." : "تأكيد"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
};

const Kpi = ({ label, value, icon, variant }: { label: string; value: any; icon: React.ReactNode; variant?: "warn" | "danger" }) => (
  <Card className={variant === "danger" ? "border-destructive" : variant === "warn" ? "border-yellow-500" : ""}>
    <CardContent className="pt-4 flex items-center justify-between">
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-bold">{value}</div>
      </div>
      <div className="text-primary opacity-60">{icon}</div>
    </CardContent>
  </Card>
);

const AlertList = ({ title, items, variant }: { title: string; items: Balance[]; variant: "warn" | "danger" }) => (
  <Card className={variant === "danger" ? "border-destructive" : "border-yellow-500"}>
    <CardHeader><CardTitle className="text-base">{title} ({items.length})</CardTitle></CardHeader>
    <CardContent className="space-y-1 max-h-[400px] overflow-y-auto">
      {items.length === 0 ? <div className="text-xs text-muted-foreground">لا توجد عناصر</div> :
        items.map((b) => (
          <div key={b.id} className="text-xs border-b py-1">
            <div className="font-medium">{b.name}</div>
            <div className="text-muted-foreground flex justify-between">
              <span>{b.warehouse_name}</span>
              <span>{b.current_stock} / {b.unit_cost} ج.م</span>
            </div>
          </div>
        ))}
    </CardContent>
  </Card>
);

export default InventoryEngine;
