import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, Loader2, Package, AlertCircle } from "lucide-react";

const fmt = (n: any) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 3 });

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  available: { label: "متاح", cls: "bg-emerald-500" },
  partial: { label: "مستخدم جزئيًا", cls: "bg-amber-500" },
  used: { label: "مستخدم بالكامل", cls: "bg-slate-500" },
  damaged: { label: "تالف", cls: "bg-rose-600" },
};

export default function CarryoverDough() {
  const { user, roles } = useAuth();
  const canDamage = roles?.some(r => r === "general_manager" || r === "executive_manager");

  const [rows, setRows] = useState<any[]>([]);
  const [usages, setUsages] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [damageTarget, setDamageTarget] = useState<any | null>(null);
  const [damageReason, setDamageReason] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("meat_factory_carryover_dough" as any)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data as any[]) || []);
    const ids = ((data as any[]) || []).map(r => r.id);
    if (ids.length) {
      const { data: us } = await supabase
        .from("meat_factory_carryover_dough_usage" as any)
        .select("*").in("carryover_id", ids);
      const map: Record<string, any[]> = {};
      ((us as any[]) || []).forEach(u => {
        (map[u.carryover_id] = map[u.carryover_id] || []).push(u);
      });
      setUsages(map);
    }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter(r => r.status === filter);
  }, [rows, filter]);

  const totals = useMemo(() => {
    const avail = rows.filter(r => r.status === "available" || r.status === "partial");
    return {
      countAvail: avail.length,
      qtyAvail: avail.reduce((s, r) => s + Number(r.remaining_qty_kg || 0), 0),
      valueAvail: avail.reduce((s, r) => s + Number(r.total_value || 0), 0),
      countDamaged: rows.filter(r => r.status === "damaged").length,
    };
  }, [rows]);

  const submitDamage = async () => {
    if (!damageTarget) return;
    if (!damageReason.trim()) { toast.error("اكتب سبب الإعدام"); return; }
    setBusy(true);
    const { error } = await supabase.from("meat_factory_carryover_dough" as any).update({
      status: "damaged",
      remaining_qty_kg: 0,
      damaged_at: new Date().toISOString(),
      damaged_by: user?.id || null,
      damaged_by_name: (user as any)?.user_metadata?.full_name || user?.email || null,
      damaged_reason: damageReason.trim(),
    }).eq("id", damageTarget.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تم تسجيل العجينة كتالف");
    setDamageTarget(null);
    setDamageReason("");
    fetchAll();
  };

  return (
    <DashboardLayout>
      <Header title="العجينة المرحلة" subtitle="مصنع اللحوم — رصيد العجينة المتبقي من فواتير التصنيع" />
      <div className="p-4 space-y-4 max-w-7xl mx-auto">

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="border-emerald-300">
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">أرصدة متاحة</div>
              <div className="text-2xl font-bold text-emerald-700">{totals.countAvail}</div>
            </CardContent>
          </Card>
          <Card className="border-emerald-300">
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">إجمالي الكمية المتاحة (كجم)</div>
              <div className="text-2xl font-bold text-emerald-700">{fmt(totals.qtyAvail)}</div>
            </CardContent>
          </Card>
          <Card className="border-purple-300">
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">إجمالي قيمة المتاح</div>
              <div className="text-2xl font-bold text-purple-700">{fmt(totals.valueAvail)} ج</div>
            </CardContent>
          </Card>
          <Card className="border-rose-300">
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">تم إعدامه</div>
              <div className="text-2xl font-bold text-rose-700">{totals.countDamaged}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-base"><Package className="w-5 h-5 text-purple-600" /> سجل العجينة المرحلة</CardTitle>
                <CardDescription>كل صف يمثل عجينة متبقية من فاتورة تصنيع — يتم استخدامها يدويًا في فواتير لاحقة.</CardDescription>
              </div>
              <div className="flex gap-1 flex-wrap">
                {[
                  { k: "all", l: "الكل" },
                  { k: "available", l: "متاح" },
                  { k: "partial", l: "جزئي" },
                  { k: "used", l: "مستخدم" },
                  { k: "damaged", l: "تالف" },
                ].map(f => (
                  <Button key={f.k} size="sm" variant={filter === f.k ? "default" : "outline"} onClick={() => setFilter(f.k)}>
                    {f.l}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">لا توجد سجلات</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الفاتورة الأصلية</TableHead>
                      <TableHead>المنتج</TableHead>
                      <TableHead>تاريخ الإنتاج</TableHead>
                      <TableHead>الكمية الأصلية</TableHead>
                      <TableHead>المتبقي (كجم)</TableHead>
                      <TableHead>تكلفة الكيلو</TableHead>
                      <TableHead>القيمة</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>ملاحظات</TableHead>
                      <TableHead>إجراء</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(r => {
                      const us = usages[r.id] || [];
                      const stat = STATUS_BADGE[r.status] || { label: r.status, cls: "bg-slate-400" };
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-xs">{r.source_invoice_no || "—"}</TableCell>
                          <TableCell className="text-xs font-medium">{r.source_product_name}</TableCell>
                          <TableCell className="text-xs">{r.production_date}</TableCell>
                          <TableCell className="text-xs">{fmt(r.original_qty_kg)}</TableCell>
                          <TableCell className="text-xs font-bold text-emerald-700">{fmt(r.remaining_qty_kg)}</TableCell>
                          <TableCell className="text-xs">{fmt(r.unit_cost)}</TableCell>
                          <TableCell className="text-xs font-semibold">{fmt(r.total_value)} ج</TableCell>
                          <TableCell><Badge className={`${stat.cls} text-white`}>{stat.label}</Badge></TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px]">
                            {r.notes || "—"}
                            {us.length > 0 && (
                              <div className="mt-1 text-[11px] text-muted-foreground border-t pt-1">
                                استخدامات: {us.map((u, i) => <span key={u.id}>{i > 0 ? "، " : ""}{fmt(u.used_qty_kg)} كجم في {u.used_in_invoice_no || "—"}</span>)}
                              </div>
                            )}
                            {r.status === "damaged" && r.damaged_reason && (
                              <div className="mt-1 text-[11px] text-rose-700 border-t pt-1">
                                سبب الإعدام: {r.damaged_reason}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {canDamage && (r.status === "available" || r.status === "partial") && Number(r.remaining_qty_kg) > 0 && (
                              <Button size="sm" variant="destructive" onClick={() => setDamageTarget(r)}>
                                <Trash2 className="w-3 h-3 ml-1" /> إعدام
                              </Button>
                            )}
                            {!canDamage && (r.status === "available" || r.status === "partial") && (
                              <span className="text-[11px] text-muted-foreground">للمدير العام فقط</span>
                            )}
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

        <AlertDialog open={!!damageTarget} onOpenChange={(o) => !o && setDamageTarget(null)}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-rose-700">
                <AlertCircle className="w-5 h-5" /> إعدام عجينة مرحلة
              </AlertDialogTitle>
              <AlertDialogDescription>
                سيتم تسجيل العجينة المتبقية ({damageTarget && fmt(damageTarget.remaining_qty_kg)} كجم من {damageTarget?.source_product_name})
                كتالف وتصفير المتبقي. هذا الإجراء لا يُعكَس. اكتب السبب أدناه.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="my-2">
              <Textarea
                placeholder="سبب الإعدام (إجباري) — مثل: عجينة فسدت، تجاوزت الصلاحية…"
                value={damageReason}
                onChange={e => setDamageReason(e.target.value)}
                rows={3}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>إلغاء</AlertDialogCancel>
              <AlertDialogAction onClick={submitDamage} disabled={busy} className="bg-rose-600 hover:bg-rose-700">
                {busy ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Trash2 className="w-4 h-4 ml-1" />}
                نعم، تسجيل كتالف
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
