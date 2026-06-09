import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ShieldCheck, Eye, CheckCircle2, Trash2, Paperclip } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const statusBadge = (s: string) => {
  if (s === "reviewed")
    return <Badge className="bg-emerald-500 hover:bg-emerald-600">تمت المراجعة</Badge>;
  if (s === "submitted") return <Badge className="bg-blue-500 hover:bg-blue-600">تم الإرسال</Badge>;
  return <Badge variant="outline">مسودة</Badge>;
};

export default function SocialMediaReportsReview() {
  const { user } = useAuth();
  const [daily, setDaily] = useState<any[]>([]);
  const [weekly, setWeekly] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [editing, setEditing] = useState<{
    kind: "daily" | "weekly";
    row: any;
    notes: string;
  } | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "daily" | "weekly";
    row: any;
  } | null>(null);

  const load = async () => {
    setLoading(true);
    const [d, w] = await Promise.all([
      supabase
        .from("social_media_daily_reports")
        .select("*")
        .order("report_date", { ascending: false }),
      supabase
        .from("social_media_weekly_reports")
        .select("*, social_media_weekly_top_posts(*)")
        .order("week_start_date", { ascending: false }),
    ]);
    setDaily(d.data || []);
    setWeekly(w.data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filteredDaily = useMemo(
    () =>
      daily.filter((r) => {
        if (statusFilter !== "all" && r.status !== statusFilter) return false;
        if (dateFrom && r.report_date < dateFrom) return false;
        if (dateTo && r.report_date > dateTo) return false;
        return true;
      }),
    [daily, statusFilter, dateFrom, dateTo]
  );

  const filteredWeekly = useMemo(
    () =>
      weekly.filter((r) => {
        if (statusFilter !== "all" && r.status !== statusFilter) return false;
        if (dateFrom && r.week_end_date < dateFrom) return false;
        if (dateTo && r.week_start_date > dateTo) return false;
        return true;
      }),
    [weekly, statusFilter, dateFrom, dateTo]
  );

  const approve = async () => {
    if (!editing || !user) return;
    const table =
      editing.kind === "daily"
        ? "social_media_daily_reports"
        : "social_media_weekly_reports";
    const { error } = await supabase
      .from(table)
      .update({
        status: "reviewed",
        management_notes: editing.notes || null,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", editing.row.id);
    if (error) {
      toast.error("تعذّر الاعتماد", { description: error.message });
      return;
    }
    toast.success("تم اعتماد التقرير");
    setEditing(null);
    load();
  };

  const saveNotesOnly = async () => {
    if (!editing) return;
    const table =
      editing.kind === "daily"
        ? "social_media_daily_reports"
        : "social_media_weekly_reports";
    const { error } = await supabase
      .from(table)
      .update({ management_notes: editing.notes || null })
      .eq("id", editing.row.id);
    if (error) {
      toast.error("تعذّر الحفظ", { description: error.message });
      return;
    }
    toast.success("تم حفظ الملاحظة");
    setEditing(null);
    load();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const table =
      deleteTarget.kind === "daily"
        ? "social_media_daily_reports"
        : "social_media_weekly_reports";
    // Remove attachment image if present
    const path = deleteTarget.row?.complaint_attachment_path;
    if (path) {
      await supabase.storage.from("social-media-attachments").remove([path]);
    }
    const { error } = await supabase.from(table).delete().eq("id", deleteTarget.row.id);
    if (error) {
      toast.error("تعذّر الحذف", { description: error.message });
      return;
    }
    toast.success("تم حذف التقرير");
    setDeleteTarget(null);
    load();
  };

  // Signed URL for complaint attachment in dialog
  useEffect(() => {
    const path = editing?.row?.complaint_attachment_path;
    if (!path) {
      setAttachmentUrl(null);
      return;
    }
    (async () => {
      const { data } = await supabase.storage
        .from("social-media-attachments")
        .createSignedUrl(path, 3600);
      setAttachmentUrl(data?.signedUrl ?? null);
    })();
  }, [editing?.row?.complaint_attachment_path]);

  return (
    <DashboardLayout>
      <div className="space-y-6" dir="rtl">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-primary" /> مراجعة تقارير السوشيال ميديا
          </h1>
          <p className="text-muted-foreground mt-1">
            مراجعة واعتماد التقارير اليومية والأسبوعية.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <Label>الحالة</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="draft">مسودة</SelectItem>
                    <SelectItem value="submitted">تم الإرسال</SelectItem>
                    <SelectItem value="reviewed">تمت المراجعة</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>من تاريخ</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <Label>إلى تاريخ</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="daily">
          <TabsList>
            <TabsTrigger value="daily">التقارير اليومية ({filteredDaily.length})</TabsTrigger>
            <TabsTrigger value="weekly">التقارير الأسبوعية ({filteredWeekly.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="daily">
            <Card>
              <CardHeader>
                <CardTitle>التقارير اليومية</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-muted-foreground">جاري التحميل…</p>
                ) : filteredDaily.length === 0 ? (
                  <p className="text-muted-foreground text-center py-6">لا توجد تقارير.</p>
                ) : (
                  <>
                    {/* Mobile cards */}
                    <div className="grid gap-3 md:hidden">
                      {filteredDaily.map((r) => (
                        <div key={r.id} className="rounded-lg border p-3 bg-card space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="font-semibold">{r.report_date}</div>
                              <div className="text-xs text-muted-foreground">{r.employee_name}</div>
                            </div>
                            {statusBadge(r.status)}
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-sm">
                            <div className="text-center bg-muted/40 rounded p-2">
                              <div className="text-xs text-muted-foreground">بوستات</div>
                              <div className="font-bold">{r.posts_count}</div>
                            </div>
                            <div className="text-center bg-muted/40 rounded p-2">
                              <div className="text-xs text-muted-foreground">ريلز</div>
                              <div className="font-bold">{r.reels_videos_count}</div>
                            </div>
                            <div className="text-center bg-muted/40 rounded p-2">
                              <div className="text-xs text-muted-foreground">مهتمين</div>
                              <div className="font-bold">{r.interested_customers_count}</div>
                            </div>
                          </div>
                          {r.top_engaging_content && (
                            <div className="text-sm line-clamp-2">
                              <span className="text-muted-foreground">أعلى محتوى: </span>
                              {r.top_engaging_content}
                            </div>
                          )}
                          {r.complaint_attachment_path && (
                            <div className="text-xs text-primary flex items-center gap-1">
                              <Paperclip className="w-3 h-3" /> مرفق صورة شكوى
                            </div>
                          )}
                          <div className="flex gap-2 pt-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() =>
                                setEditing({ kind: "daily", row: r, notes: r.management_notes || "" })
                              }
                            >
                              <Eye className="w-4 h-4 ml-1" /> عرض
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => setDeleteTarget({ kind: "daily", row: r })}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Desktop table */}
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>التاريخ</TableHead>
                            <TableHead>الموظفة</TableHead>
                            <TableHead>بوستات</TableHead>
                            <TableHead>ريلز</TableHead>
                            <TableHead>مهتمين</TableHead>
                            <TableHead>أعلى محتوى</TableHead>
                            <TableHead>الحالة</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredDaily.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell>{r.report_date}</TableCell>
                              <TableCell>{r.employee_name}</TableCell>
                              <TableCell>{r.posts_count}</TableCell>
                              <TableCell>{r.reels_videos_count}</TableCell>
                              <TableCell>{r.interested_customers_count}</TableCell>
                              <TableCell className="max-w-[200px] truncate">
                                {r.top_engaging_content}
                                {r.complaint_attachment_path && (
                                  <Paperclip className="w-3 h-3 inline mr-1 text-primary" />
                                )}
                              </TableCell>
                              <TableCell>{statusBadge(r.status)}</TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      setEditing({ kind: "daily", row: r, notes: r.management_notes || "" })
                                    }
                                  >
                                    <Eye className="w-4 h-4 ml-1" /> عرض
                                  </Button>
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => setDeleteTarget({ kind: "daily", row: r })}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="weekly">
            <Card>
              <CardHeader>
                <CardTitle>التقارير الأسبوعية</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-muted-foreground">جاري التحميل…</p>
                ) : filteredWeekly.length === 0 ? (
                  <p className="text-muted-foreground text-center py-6">لا توجد تقارير.</p>
                ) : (
                  <>
                    {/* Mobile cards */}
                    <div className="grid gap-3 md:hidden">
                      {filteredWeekly.map((r) => (
                        <div key={r.id} className="rounded-lg border p-3 bg-card space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="font-semibold text-sm">
                                {r.week_start_date} → {r.week_end_date}
                              </div>
                              <div className="text-xs text-muted-foreground">{r.employee_name}</div>
                            </div>
                            {statusBadge(r.status)}
                          </div>
                          <div className="grid grid-cols-4 gap-1 text-xs">
                            <div className="text-center bg-muted/40 rounded p-1.5">
                              <div className="text-muted-foreground">FB</div>
                              <div className="font-bold">{r.facebook_followers_growth}</div>
                            </div>
                            <div className="text-center bg-muted/40 rounded p-1.5">
                              <div className="text-muted-foreground">IG</div>
                              <div className="font-bold">{r.instagram_followers_growth}</div>
                            </div>
                            <div className="text-center bg-muted/40 rounded p-1.5">
                              <div className="text-muted-foreground">TT</div>
                              <div className="font-bold">{r.tiktok_followers_growth}</div>
                            </div>
                            <div className="text-center bg-muted/40 rounded p-1.5">
                              <div className="text-muted-foreground">YT</div>
                              <div className="font-bold">{r.youtube_followers_growth}</div>
                            </div>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span><span className="text-muted-foreground">Leads: </span>{r.leads_count}</span>
                            <span><span className="text-muted-foreground">أفضل: </span>{r.best_platform}</span>
                          </div>
                          <div className="flex gap-2 pt-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() =>
                                setEditing({ kind: "weekly", row: r, notes: r.management_notes || "" })
                              }
                            >
                              <Eye className="w-4 h-4 ml-1" /> عرض
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => setDeleteTarget({ kind: "weekly", row: r })}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Desktop table */}
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>الأسبوع</TableHead>
                            <TableHead>الموظفة</TableHead>
                            <TableHead>FB</TableHead>
                            <TableHead>IG</TableHead>
                            <TableHead>TikTok</TableHead>
                            <TableHead>YouTube</TableHead>
                            <TableHead>Leads</TableHead>
                            <TableHead>أفضل منصة</TableHead>
                            <TableHead>الحالة</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredWeekly.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell>
                                {r.week_start_date} → {r.week_end_date}
                              </TableCell>
                              <TableCell>{r.employee_name}</TableCell>
                              <TableCell>{r.facebook_followers_growth}</TableCell>
                              <TableCell>{r.instagram_followers_growth}</TableCell>
                              <TableCell>{r.tiktok_followers_growth}</TableCell>
                              <TableCell>{r.youtube_followers_growth}</TableCell>
                              <TableCell>{r.leads_count}</TableCell>
                              <TableCell>{r.best_platform}</TableCell>
                              <TableCell>{statusBadge(r.status)}</TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      setEditing({ kind: "weekly", row: r, notes: r.management_notes || "" })
                                    }
                                  >
                                    <Eye className="w-4 h-4 ml-1" /> عرض
                                  </Button>
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => setDeleteTarget({ kind: "weekly", row: r })}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="max-w-2xl" dir="rtl">
            <DialogHeader>
              <DialogTitle>
                {editing?.kind === "daily" ? "تقرير يومي" : "تقرير أسبوعي"} —{" "}
                {editing?.row?.employee_name}
              </DialogTitle>
            </DialogHeader>
            {editing && (
              <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                <pre className="text-xs whitespace-pre-wrap bg-muted/40 p-3 rounded">
                  {JSON.stringify(
                    Object.fromEntries(
                      Object.entries(editing.row).filter(
                        ([k]) =>
                          !["id", "employee_id", "reviewed_by", "created_at", "updated_at"].includes(
                            k
                          )
                      )
                    ),
                    null,
                    2
                  )}
                </pre>
                {editing.kind === "daily" && editing.row.complaint_attachment_path && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Paperclip className="w-4 h-4" /> صورة الشكوى المرفقة
                    </Label>
                    {attachmentUrl ? (
                      <a href={attachmentUrl} target="_blank" rel="noreferrer">
                        <img
                          src={attachmentUrl}
                          alt="مرفق الشكوى"
                          className="max-h-80 rounded border w-auto"
                        />
                      </a>
                    ) : (
                      <p className="text-xs text-muted-foreground">جاري تحميل الصورة…</p>
                    )}
                  </div>
                )}
                <div>
                  <Label>ملاحظة الإدارة</Label>
                  <Textarea
                    rows={3}
                    value={editing.notes}
                    onChange={(e) =>
                      setEditing((s) => (s ? { ...s, notes: e.target.value } : s))
                    }
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={saveNotesOnly}>
                حفظ الملاحظة
              </Button>
              <Button onClick={approve} disabled={editing?.row?.status === "reviewed"}>
                <CheckCircle2 className="w-4 h-4 ml-2" /> اعتماد كمراجع
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>حذف التقرير؟</AlertDialogTitle>
              <AlertDialogDescription>
                لا يمكن التراجع عن هذه العملية. سيتم حذف التقرير وأي مرفقات مرتبطة به نهائيًا.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                <Trash2 className="w-4 h-4 ml-2" /> حذف
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
