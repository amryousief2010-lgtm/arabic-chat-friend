import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { MapPin, Plus, Edit } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface Location { id: string; name: string; department: string | null; sort_order: number; is_active: boolean; notes: string | null }

const HRWorkLocations = () => {
  const { isGeneralManager, isExecutiveManager, roles } = useAuth();
  const canManage = isGeneralManager || isExecutiveManager || roles.includes("hr_manager");

  const [rows, setRows] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Location | null>(null);
  const [form, setForm] = useState<Partial<Location>>({ name: "", department: "", sort_order: 100, is_active: true });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("hr_work_locations").select("*").order("sort_order").order("name");
    setRows((data || []) as Location[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm({ name: "", department: "", sort_order: 100, is_active: true }); setOpen(true); };
  const openEdit = (l: Location) => { setEditing(l); setForm({ ...l }); setOpen(true); };

  const save = async () => {
    if (!form.name?.trim()) { toast.error("الاسم مطلوب"); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name!.trim(),
        department: form.department || null,
        sort_order: form.sort_order ?? 100,
        is_active: form.is_active ?? true,
        notes: form.notes || null,
      };
      if (editing) {
        const { error } = await supabase.from("hr_work_locations").update(payload).eq("id", editing.id);
        if (error) throw error;
        toast.success("تم التحديث");
      } else {
        const { error } = await supabase.from("hr_work_locations").insert(payload);
        if (error) throw error;
        toast.success("تمت الإضافة");
      }
      setOpen(false);
      await load();
    } catch (e: any) {
      toast.error("فشل الحفظ: " + (e?.message || "خطأ"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <MapPin className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">أماكن العمل والأقسام</h1>
              <p className="text-muted-foreground mt-1">الأقسام والمواقع التي يعمل بها الموظفون</p>
            </div>
          </div>
          {canManage && <Button onClick={openCreate}><Plus className="w-4 h-4 ml-1" />إضافة مكان</Button>}
        </div>

        <Card>
          <CardHeader><CardTitle>القائمة ({rows.length})</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الترتيب</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>القسم</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="text-left">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">جارٍ التحميل...</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">لا توجد أماكن</TableCell></TableRow>
                ) : (
                  rows.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs">{l.sort_order}</TableCell>
                      <TableCell className="font-medium">{l.name}</TableCell>
                      <TableCell>{l.department || "—"}</TableCell>
                      <TableCell>
                        {l.is_active
                          ? <Badge className="bg-emerald-500/15 text-emerald-700">نشط</Badge>
                          : <Badge variant="outline">معطّل</Badge>}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          {canManage && (
                            <Button size="sm" variant="outline" onClick={() => openEdit(l)}>
                              <Edit className="w-3.5 h-3.5 ml-1" />تعديل
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل مكان العمل" : "إضافة مكان عمل"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>الاسم *</Label>
              <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>القسم</Label>
              <Input value={form.department || ""} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </div>
            <div>
              <Label>الترتيب</Label>
              <Input type="number" value={form.sort_order ?? 100} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 100 })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active ?? true} onCheckedChange={(c) => setForm({ ...form, is_active: c })} />
              <Label>نشط</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={save} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default HRWorkLocations;
