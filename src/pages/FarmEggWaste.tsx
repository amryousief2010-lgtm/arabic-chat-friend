import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Plus, AlertTriangle, Egg } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface WasteRow {
  id: string;
  waste_date: string;
  family_id: string | null;
  egg_count: number;
  reason: string | null;
  notes: string | null;
  created_at: string;
  farm_families?: { family_number: string } | null;
}

interface Family { id: string; family_number: string }

const CAN_MANAGE = ["general_manager", "executive_manager", "farm_manager", "production_manager", "quality_manager"];

export default function FarmEggWaste() {
  const { roles } = useAuth();
  const canManage = roles.some((r) => CAN_MANAGE.includes(r));
  const qc = useQueryClient();
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [familyFilter, setFamilyFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ waste_date: new Date().toISOString().slice(0, 10), family_id: "", egg_count: 1, reason: "", notes: "" });

  const { data: families = [] } = useQuery<Family[]>({
    queryKey: ["farm_families_min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("farm_families").select("id,family_number").order("family_number");
      if (error) throw error;
      return (data as Family[]).sort((a, b) => Number(a.family_number) - Number(b.family_number));
    },
  });

  const { data: rows = [], isLoading } = useQuery<WasteRow[]>({
    queryKey: ["farm_egg_waste", from, to, familyFilter],
    queryFn: async () => {
      let q = supabase
        .from("farm_egg_waste")
        .select("id,waste_date,family_id,egg_count,reason,notes,created_at,farm_families(family_number)")
        .order("waste_date", { ascending: false })
        .limit(1000);
      if (from) q = q.gte("waste_date", from);
      if (to) q = q.lte("waste_date", to);
      if (familyFilter !== "all") q = q.eq("family_id", familyFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as WasteRow[];
    },
  });

  const addMut = useMutation({
    mutationFn: async () => {
      if (!form.family_id) throw new Error("اختاري الأسرة");
      if (!form.egg_count || form.egg_count < 1) throw new Error("عدد البيض يجب أن يكون أكبر من صفر");
      const { error } = await supabase.from("farm_egg_waste").insert({
        waste_date: form.waste_date,
        family_id: form.family_id,
        egg_count: form.egg_count,
        reason: form.reason || null,
        notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم تسجيل الهالك");
      qc.invalidateQueries({ queryKey: ["farm_egg_waste"] });
      setOpen(false);
      setForm({ waste_date: new Date().toISOString().slice(0, 10), family_id: "", egg_count: 1, reason: "", notes: "" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("farm_egg_waste").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: ["farm_egg_waste"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const total = rows.reduce((s, r) => s + (r.egg_count || 0), 0);

  return (
    <DashboardLayout>
      <Header title="الهالك / المكسور" subtitle="بيض الأمهات الهالك — يُخصم من الرصيد ولا يدخل المعمل ولا الحضانات" />

      <div className="grid gap-4 md:grid-cols-3 mb-4">
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">إجمالي البيض الهالك</div>
              <div className="text-2xl font-bold text-destructive">{total}</div>
            </div>
            <AlertTriangle className="h-8 w-8 text-destructive/60" />
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">عدد سجلات الهالك</div>
              <div className="text-2xl font-bold">{rows.length}</div>
            </div>
            <Egg className="h-8 w-8 text-muted-foreground/60" />
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 text-xs text-muted-foreground leading-6">
            الهالك لا يتم نقله للمعمل، ولا يدخل الحضانات. يُسجَّل كحركة هالك مستقلة ويُخصم فقط من رصيد المزرعة.
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle>سجل الهالك</CardTitle>
          {canManage && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="ml-1 h-4 w-4" />تسجيل هالك جديد</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>تسجيل هالك / مكسور</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>التاريخ</Label>
                    <Input type="date" value={form.waste_date} onChange={(e) => setForm({ ...form, waste_date: e.target.value })} />
                  </div>
                  <div>
                    <Label>الأسرة</Label>
                    <Select value={form.family_id} onValueChange={(v) => setForm({ ...form, family_id: v })}>
                      <SelectTrigger><SelectValue placeholder="اختاري الأسرة" /></SelectTrigger>
                      <SelectContent>
                        {families.map((f) => (
                          <SelectItem key={f.id} value={f.id}>أسرة {f.family_number}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>عدد البيض الهالك</Label>
                    <Input type="number" min={1} value={form.egg_count} onChange={(e) => setForm({ ...form, egg_count: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label>السبب (اختياري)</Label>
                    <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="مكسور، فاسد، ..." />
                  </div>
                  <div>
                    <Label>ملاحظات (اختياري)</Label>
                    <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button>
                  <Button onClick={() => addMut.mutate()} disabled={addMut.isPending}>حفظ</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-3">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
            <Select value={familyFilter} onValueChange={setFamilyFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأسر</SelectItem>
                {families.map((f) => (<SelectItem key={f.id} value={f.id}>أسرة {f.family_number}</SelectItem>))}
              </SelectContent>
            </Select>
            {(from || to || familyFilter !== "all") && (
              <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); setFamilyFilter("all"); }}>مسح الفلاتر</Button>
            )}
          </div>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الأسرة</TableHead>
                  <TableHead>عدد الهالك</TableHead>
                  <TableHead>السبب</TableHead>
                  <TableHead>ملاحظات</TableHead>
                  {canManage && <TableHead></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">جارٍ التحميل...</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">لا توجد سجلات هالك</TableCell></TableRow>
                ) : rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.waste_date}</TableCell>
                    <TableCell><Badge variant="outline">أسرة {r.farm_families?.family_number ?? "-"}</Badge></TableCell>
                    <TableCell className="font-bold text-destructive">{r.egg_count}</TableCell>
                    <TableCell>{r.reason ?? "-"}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground">{r.notes ?? "-"}</TableCell>
                    {canManage && (
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => { if (confirm("حذف هذا السجل؟")) delMut.mutate(r.id); }}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
