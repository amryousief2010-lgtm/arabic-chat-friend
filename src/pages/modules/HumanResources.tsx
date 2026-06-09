import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UsersRound, KeyRound, Mail, Search, ShieldAlert, Copy, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, AppRole } from "@/hooks/useAuth";
import { toast } from "sonner";

interface EmployeeRow {
  id: string;
  full_name: string;
  email: string;
  roles: AppRole[];
}

const roleLabel: Partial<Record<AppRole, string>> = {
  general_manager: "مدير عام",
  executive_manager: "مدير تنفيذي",
  sales_manager: "مدير مبيعات",
  sales_moderator: "موديريتر",
  accountant: "محاسب",
  warehouse_supervisor: "مشرف مخزن",
  farm_manager: "مدير مزرعة",
  hatchery_manager: "مدير معمل تفريخ",
  brooding_manager: "مدير حضانات",
  slaughterhouse_manager: "مدير مجزر",
  meat_factory_manager: "مدير مصنع لحوم",
  feed_factory_manager: "مدير مصنع أعلاف",
  hr_manager: "مدير موارد بشرية",
  production_manager: "مدير إنتاج",
  marketing_sales_manager: "مدير المبيعات",
  financial_manager: "مدير مالي",
  quality_manager: "مدير جودة",
  shipping_company: "شركة شحن",
  private_delivery_rep: "مندوب توصيل",
  agouza_warehouse_keeper: "أمين مخزن العجوزة",
  brooding_dashboard_viewer: "عرض حضانات",
  lab_treasury_keeper: "أمين خزنة معمل",
  lab_external_collector: "محصّل خارجي",
  lab_treasury_approver: "معتمد خزنة معمل",
  slaughterhouse_custody_keeper: "أمين عهدة مجزر",
};

const HumanResources = () => {
  const { isGeneralManager, isExecutiveManager } = useAuth();
  const canManage = isGeneralManager;
  const canView = isGeneralManager || isExecutiveManager;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [search, setSearch] = useState("");

  const [pwdTarget, setPwdTarget] = useState<EmployeeRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [pwdSubmitting, setPwdSubmitting] = useState(false);

  const [emailTarget, setEmailTarget] = useState<EmployeeRow | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [emailSubmitting, setEmailSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: profiles }, { data: roleRows }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email").order("full_name"),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    const byUser = new Map<string, AppRole[]>();
    (roleRows || []).forEach((r: any) => {
      const arr = byUser.get(r.user_id) || [];
      arr.push(r.role);
      byUser.set(r.user_id, arr);
    });
    setRows(
      (profiles || []).map((p: any) => ({
        id: p.id,
        full_name: p.full_name || "—",
        email: p.email || "—",
        roles: byUser.get(p.id) || [],
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    if (canView) load();
  }, [canView]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.roles.some((role) => (roleLabel[role] || role).toLowerCase().includes(q))
    );
  }, [rows, search]);

  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    let out = "";
    for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
    setNewPassword(out);
    setShowPwd(true);
  };

  const submitPassword = async () => {
    if (!pwdTarget) return;
    if (newPassword.length < 8) {
      toast.error("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
      return;
    }
    setPwdSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("reset-password", {
        body: { userId: pwdTarget.id, newPassword },
      });
      if (error) throw error;
      toast.success(`تم تحديث كلمة سر ${pwdTarget.full_name}`);
      setPwdTarget(null);
      setNewPassword("");
      setShowPwd(false);
    } catch (e: any) {
      toast.error("فشل التحديث: " + (e?.message || "خطأ غير معروف"));
    } finally {
      setPwdSubmitting(false);
    }
  };

  const submitEmail = async () => {
    if (!emailTarget) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      toast.error("صيغة الإيميل غير صحيحة");
      return;
    }
    setEmailSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("update-user-email", {
        body: { user_id: emailTarget.id, new_email: newEmail },
      });
      if (error) throw error;
      toast.success(`تم تحديث إيميل ${emailTarget.full_name}`);
      setEmailTarget(null);
      setNewEmail("");
      await load();
    } catch (e: any) {
      toast.error("فشل التحديث: " + (e?.message || "خطأ غير معروف"));
    } finally {
      setEmailSubmitting(false);
    }
  };

  if (!canView) {
    return (
      <DashboardLayout>
        <Card>
          <CardHeader>
            <CardTitle>غير مصرح</CardTitle>
            <CardDescription>هذه الصفحة متاحة للمدير العام والمدير التنفيذي فقط.</CardDescription>
          </CardHeader>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <UsersRound className="w-7 h-7 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">حسابات الموظفين</h1>
            <p className="text-muted-foreground mt-1">إدارة بيانات الدخول وكلمات السر لكل موظف</p>
          </div>
        </div>

        <Card className="border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="flex gap-3 items-start pt-6">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              كلمات السر مخزّنة بشكل مشفّر (hash) لأسباب أمنية ولا يمكن استرجاع كلمة السر الأصلية.
              المتاح هو <strong>تعيين كلمة سر جديدة</strong> أو <strong>تغيير الإيميل</strong> ثم تسليمها للموظف.
              {!canManage && <span className="block mt-1 text-muted-foreground">العرض فقط — التعديل متاح للمدير العام.</span>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle>قائمة الموظفين ({filtered.length})</CardTitle>
              <div className="relative w-72 max-w-full">
                <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="بحث بالاسم أو الإيميل أو الدور..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pr-9"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الاسم</TableHead>
                    <TableHead>الإيميل (يوزر الدخول)</TableHead>
                    <TableHead>الأدوار</TableHead>
                    <TableHead className="text-left">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">جارٍ التحميل...</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">لا يوجد موظفون</TableCell></TableRow>
                  ) : (
                    filtered.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.full_name}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm">{r.email}</span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => {
                                navigator.clipboard.writeText(r.email);
                                toast.success("تم النسخ");
                              }}
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {r.roles.length === 0 ? (
                              <Badge variant="outline" className="text-muted-foreground">بدون دور</Badge>
                            ) : (
                              r.roles.map((role) => (
                                <Badge key={role} variant="secondary">{roleLabel[role] || role}</Badge>
                              ))
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2 justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canManage}
                              onClick={() => { setPwdTarget(r); setNewPassword(""); setShowPwd(false); }}
                            >
                              <KeyRound className="w-3.5 h-3.5 ml-1" />
                              كلمة سر
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canManage}
                              onClick={() => { setEmailTarget(r); setNewEmail(r.email); }}
                            >
                              <Mail className="w-3.5 h-3.5 ml-1" />
                              تغيير إيميل
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Reset Password Dialog */}
      <Dialog open={!!pwdTarget} onOpenChange={(o) => !o && setPwdTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعيين كلمة سر جديدة</DialogTitle>
            <DialogDescription>
              {pwdTarget && <>الموظف: <strong>{pwdTarget.full_name}</strong> ({pwdTarget.email})</>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label>كلمة السر الجديدة (8 أحرف على الأقل)</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showPwd ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-9 font-mono"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="absolute left-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setShowPwd((s) => !s)}
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <Button type="button" variant="outline" onClick={generatePassword}>توليد</Button>
            </div>
            {newPassword && showPwd && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { navigator.clipboard.writeText(newPassword); toast.success("تم نسخ كلمة السر"); }}
              >
                <Copy className="w-3.5 h-3.5 ml-1" /> نسخ كلمة السر
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwdTarget(null)}>إلغاء</Button>
            <Button onClick={submitPassword} disabled={pwdSubmitting}>
              {pwdSubmitting ? "جارٍ الحفظ..." : "حفظ كلمة السر"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Email Dialog */}
      <Dialog open={!!emailTarget} onOpenChange={(o) => !o && setEmailTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تغيير الإيميل</DialogTitle>
            <DialogDescription>
              {emailTarget && <>الموظف: <strong>{emailTarget.full_name}</strong></>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label>الإيميل الجديد</Label>
            <Input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="user@example.com"
              dir="ltr"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailTarget(null)}>إلغاء</Button>
            <Button onClick={submitEmail} disabled={emailSubmitting}>
              {emailSubmitting ? "جارٍ الحفظ..." : "حفظ الإيميل"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default HumanResources;
