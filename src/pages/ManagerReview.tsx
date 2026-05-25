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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Barcode,
  DollarSign,
  PackageOpen,
  RefreshCw,
  ShieldCheck,
  XCircle,
  CheckCircle2,
  Search,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDate } from "@/lib/dateFormat";

type Task = {
  id: string;
  task_type: string;
  module: string;
  severity: string;
  title: string;
  description: string | null;
  reference_table: string | null;
  reference_id: string | null;
  status: string;
  created_at: string;
  resolution_notes: string | null;
};

const SEVERITIES = ["all", "critical", "high", "medium", "low"];
const MODULES = ["all", "meat", "feed", "shared", "warehouse"];
const STATUSES = ["open", "in_progress", "resolved", "dismissed"];

const ManagerReview = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("missing_barcode");
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("all");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [status, setStatus] = useState("open");
  const [refreshKey, setRefreshKey] = useState(0);

  // dialog state
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [dialogType, setDialogType] = useState<
    "barcode" | "stock" | "cost" | "dismiss" | null
  >(null);
  const [formValue, setFormValue] = useState("");
  const [formReason, setFormReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // for barcode dialog: product details
  const [productInfo, setProductInfo] = useState<any>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("data_quality_tasks")
        .select("*")
        .order("severity", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) {
        toast.error("فشل تحميل المهام: " + error.message);
      } else {
        setTasks((data || []) as Task[]);
      }
      setLoading(false);
    };
    load();
  }, [refreshKey]);

  const counts = useMemo(() => {
    const open = tasks.filter((t) => t.status === "open");
    return {
      missing_barcode: open.filter((t) => t.task_type === "missing_barcode").length,
      negative_stock: open.filter((t) => t.task_type === "negative_stock").length,
      cost_review: open.filter((t) => t.task_type === "cost_review").length,
      other: open.filter((t) => t.task_type === "other").length,
      total: open.length,
    };
  }, [tasks]);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (t.task_type !== tab) return false;
      if (status !== "all" && t.status !== status) return false;
      if (severity !== "all" && t.severity !== severity) return false;
      if (moduleFilter !== "all" && t.module !== moduleFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hit =
          t.title?.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.reference_id?.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [tasks, tab, status, severity, moduleFilter, search]);

  const openBarcodeDialog = async (t: Task) => {
    setActiveTask(t);
    setDialogType("barcode");
    setFormValue("");
    setFormReason("");
    setProductInfo(null);
    if (t.reference_table === "products" && t.reference_id) {
      const { data } = await supabase
        .from("products")
        .select("id, name, barcode, is_active, stock, price")
        .eq("id", t.reference_id)
        .maybeSingle();
      setProductInfo(data);
    }
  };

  const openStockDialog = (t: Task) => {
    setActiveTask(t);
    setDialogType("stock");
    setFormValue("0");
    setFormReason("");
  };

  const openCostDialog = (t: Task) => {
    setActiveTask(t);
    setDialogType("cost");
    setFormValue("");
    setFormReason("");
  };

  const openDismissDialog = (t: Task) => {
    setActiveTask(t);
    setDialogType("dismiss");
    setFormValue("");
    setFormReason("");
  };

  const closeDialog = () => {
    setActiveTask(null);
    setDialogType(null);
    setFormValue("");
    setFormReason("");
    setProductInfo(null);
  };

  const refresh = () => setRefreshKey((k) => k + 1);

  const submit = async () => {
    if (!activeTask) return;
    setSubmitting(true);
    try {
      let rpc: any;
      if (dialogType === "barcode") {
        if (!productInfo) throw new Error("لا يوجد منتج مرتبط بالمهمة");
        rpc = await supabase.rpc("mr_assign_barcode", {
          p_task_id: activeTask.id,
          p_product_id: productInfo.id,
          p_barcode: formValue.trim(),
          p_reason: formReason || null,
        });
      } else if (dialogType === "stock") {
        rpc = await supabase.rpc("mr_reconcile_negative_stock", {
          p_task_id: activeTask.id,
          p_target_table: activeTask.reference_table || "",
          p_target_id: activeTask.reference_id || "",
          p_new_stock: Number(formValue),
          p_reason: formReason,
        });
      } else if (dialogType === "cost") {
        rpc = await supabase.rpc("mr_approve_cost", {
          p_task_id: activeTask.id,
          p_module: activeTask.module,
          p_target_table: activeTask.reference_table || "",
          p_target_id: activeTask.reference_id || "",
          p_new_cost: Number(formValue),
          p_reason: formReason,
        });
      } else if (dialogType === "dismiss") {
        rpc = await supabase.rpc("mr_dismiss_task", {
          p_task_id: activeTask.id,
          p_reason: formReason,
        });
      }
      if (rpc?.error) throw rpc.error;
      toast.success("تم تنفيذ الإجراء بنجاح");
      closeDialog();
      refresh();
    } catch (e: any) {
      const msg = e?.message || String(e);
      const map: Record<string, string> = {
        BARCODE_REQUIRED: "الباركود مطلوب",
        BARCODE_DUPLICATE: "هذا الباركود مستخدم بالفعل لمنتج آخر",
        NOT_AUTHORIZED: "غير مصرح لك بتنفيذ هذا الإجراء",
        REASON_REQUIRED: "يرجى كتابة سبب التعديل",
        INVALID_COST: "يجب أن تكون التكلفة أكبر من صفر",
        INVALID_TARGET: "السجل المستهدف غير مدعوم",
        TASK_NOT_FOUND: "المهمة غير موجودة",
      };
      const key = Object.keys(map).find((k) => msg.includes(k));
      toast.error(key ? map[key] : "فشل: " + msg);
    } finally {
      setSubmitting(false);
    }
  };

  const renderActions = (t: Task) => {
    if (t.status !== "open" && t.status !== "in_progress") {
      return <Badge variant="secondary">{t.status === "resolved" ? "تم الحل" : "مرفوض"}</Badge>;
    }
    if (t.task_type === "missing_barcode") {
      return (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => openBarcodeDialog(t)}>
            <Barcode className="w-3 h-3 ml-1" /> تعيين باركود
          </Button>
          <Button size="sm" variant="outline" onClick={() => openDismissDialog(t)}>
            <XCircle className="w-3 h-3 ml-1" /> رفض
          </Button>
        </div>
      );
    }
    if (t.task_type === "negative_stock") {
      return (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => openStockDialog(t)}>
            <RefreshCw className="w-3 h-3 ml-1" /> تسوية مخزون
          </Button>
          <Button size="sm" variant="outline" onClick={() => openDismissDialog(t)}>
            <XCircle className="w-3 h-3 ml-1" /> رفض
          </Button>
        </div>
      );
    }
    if (t.task_type === "cost_review") {
      return (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => openCostDialog(t)}>
            <DollarSign className="w-3 h-3 ml-1" /> اعتماد تكلفة
          </Button>
          <Button size="sm" variant="outline" onClick={() => openDismissDialog(t)}>
            <XCircle className="w-3 h-3 ml-1" /> رفض
          </Button>
        </div>
      );
    }
    return (
      <Button size="sm" variant="outline" onClick={() => openDismissDialog(t)}>
        <CheckCircle2 className="w-3 h-3 ml-1" /> إغلاق
      </Button>
    );
  };

  const severityColor = (s: string) => {
    if (s === "critical") return "destructive";
    if (s === "high") return "destructive";
    if (s === "medium") return "default";
    return "secondary";
  };

  return (
    <DashboardLayout>
      <Header title="مركز مراجعة المدير" subtitle="جودة البيانات والاعتمادات الحرجة" />
      <div className="container mx-auto p-4 space-y-4" dir="rtl">
        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryCard label="إجمالي مفتوح" value={counts.total} icon={<ShieldCheck />} />
          <SummaryCard label="باركود ناقص" value={counts.missing_barcode} icon={<Barcode />} />
          <SummaryCard label="مخزون سالب" value={counts.negative_stock} icon={<AlertTriangle />} />
          <SummaryCard label="مراجعة تكلفة" value={counts.cost_review} icon={<DollarSign />} />
          <SummaryCard label="أخرى" value={counts.other} icon={<PackageOpen />} />
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4 flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="بحث بالعنوان أو المرجع..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-9"
              />
            </div>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="الأولوية" /></SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>{s === "all" ? "كل الأولويات" : s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={moduleFilter} onValueChange={setModuleFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="الوحدة" /></SelectTrigger>
              <SelectContent>
                {MODULES.map((m) => (
                  <SelectItem key={m} value={m}>{m === "all" ? "كل الوحدات" : m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="الحالة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                {STATUSES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={refresh}><RefreshCw className="w-4 h-4 ml-1" />تحديث</Button>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-4">
            <TabsTrigger value="missing_barcode">
              باركود ناقص <Badge variant="secondary" className="mr-2">{counts.missing_barcode}</Badge>
            </TabsTrigger>
            <TabsTrigger value="negative_stock">
              مخزون سالب <Badge variant="secondary" className="mr-2">{counts.negative_stock}</Badge>
            </TabsTrigger>
            <TabsTrigger value="cost_review">
              مراجعة تكلفة <Badge variant="secondary" className="mr-2">{counts.cost_review}</Badge>
            </TabsTrigger>
            <TabsTrigger value="other">
              أخرى <Badge variant="secondary" className="mr-2">{counts.other}</Badge>
            </TabsTrigger>
          </TabsList>

          {(["missing_barcode", "negative_stock", "cost_review", "other"] as const).map((k) => (
            <TabsContent key={k} value={k}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {loading ? "جارٍ التحميل..." : `${filtered.length} عنصر`}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>الأولوية</TableHead>
                          <TableHead>الوحدة</TableHead>
                          <TableHead>العنوان</TableHead>
                          <TableHead>المرجع</TableHead>
                          <TableHead>التاريخ</TableHead>
                          <TableHead>الإجراء</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                              لا توجد عناصر مطابقة
                            </TableCell>
                          </TableRow>
                        ) : filtered.map((t) => (
                          <TableRow key={t.id}>
                            <TableCell>
                              <Badge variant={severityColor(t.severity) as any}>{t.severity}</Badge>
                            </TableCell>
                            <TableCell><Badge variant="outline">{t.module}</Badge></TableCell>
                            <TableCell className="max-w-[400px]">
                              <div className="font-medium">{t.title}</div>
                              {t.description && (
                                <div className="text-xs text-muted-foreground">{t.description}</div>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {t.reference_table}<br />
                              <span className="text-muted-foreground">{t.reference_id?.slice(0, 8)}</span>
                            </TableCell>
                            <TableCell className="text-xs">{formatDate(t.created_at)}</TableCell>
                            <TableCell>{renderActions(t)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>

        {/* Dialog */}
        <Dialog open={dialogType !== null} onOpenChange={(o) => !o && closeDialog()}>
          <DialogContent dir="rtl">
            <DialogHeader>
              <DialogTitle>
                {dialogType === "barcode" && "تعيين باركود للمنتج"}
                {dialogType === "stock" && "تسوية مخزون سالب"}
                {dialogType === "cost" && "اعتماد تكلفة"}
                {dialogType === "dismiss" && "رفض المهمة"}
              </DialogTitle>
              <DialogDescription>{activeTask?.title}</DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {dialogType === "barcode" && (
                <>
                  {productInfo && (
                    <div className="bg-muted p-3 rounded text-sm space-y-1">
                      <div><strong>الاسم:</strong> {productInfo.name}</div>
                      <div><strong>السعر:</strong> {productInfo.price} ج.م</div>
                      <div><strong>المخزون:</strong> {productInfo.stock}</div>
                      <div><strong>الحالة:</strong> {productInfo.is_active ? "نشط" : "معطل"}</div>
                    </div>
                  )}
                  <div>
                    <label className="text-sm font-medium">الباركود الجديد *</label>
                    <Input
                      value={formValue}
                      onChange={(e) => setFormValue(e.target.value)}
                      placeholder="مثال: 6221234567890"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">ملاحظات (اختياري)</label>
                    <Textarea value={formReason} onChange={(e) => setFormReason(e.target.value)} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    سيتم تفعيل المنتج تلقائياً وفتحه للبيع والإنتاج.
                  </div>
                </>
              )}

              {dialogType === "stock" && (
                <>
                  <div className="text-sm bg-muted p-3 rounded">
                    <div><strong>السجل:</strong> {activeTask?.reference_table}</div>
                    <div><strong>المعرف:</strong> {activeTask?.reference_id}</div>
                  </div>
                  <div>
                    <label className="text-sm font-medium">القيمة الصحيحة للمخزون *</label>
                    <Input
                      type="number"
                      value={formValue}
                      onChange={(e) => setFormValue(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">سبب التسوية * (مطلوب)</label>
                    <Textarea
                      value={formReason}
                      onChange={(e) => setFormReason(e.target.value)}
                      placeholder="مثال: تم جرد الصنف فعلياً وتأكيد الرصيد"
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    سيتم إنشاء حركة مخزون "تسوية" مع تسجيل السبب وموافقتك في سجل التدقيق.
                  </div>
                </>
              )}

              {dialogType === "cost" && (
                <>
                  <div className="text-sm bg-muted p-3 rounded">
                    <div><strong>السجل:</strong> {activeTask?.reference_table}</div>
                    <div><strong>المعرف:</strong> {activeTask?.reference_id}</div>
                  </div>
                  <div>
                    <label className="text-sm font-medium">التكلفة المعتمدة (ج.م/وحدة) *</label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formValue}
                      onChange={(e) => setFormValue(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">مصدر/سبب التكلفة * (مطلوب)</label>
                    <Textarea
                      value={formReason}
                      onChange={(e) => setFormReason(e.target.value)}
                      placeholder="مثال: متوسط آخر 3 فواتير شراء"
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    سيتم حفظ القيمة القديمة في تاريخ التكلفة وفتح المادة للاستخدام في التكلفة الإنتاجية.
                  </div>
                </>
              )}

              {dialogType === "dismiss" && (
                <>
                  <div>
                    <label className="text-sm font-medium">سبب الرفض * (مطلوب)</label>
                    <Textarea
                      value={formReason}
                      onChange={(e) => setFormReason(e.target.value)}
                      placeholder="مثال: تم التحقق وغير مطلوب اتخاذ إجراء"
                    />
                  </div>
                </>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>إلغاء</Button>
              <Button onClick={submit} disabled={submitting}>
                {submitting ? "جارٍ التنفيذ..." : "تأكيد"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
};

const SummaryCard = ({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) => (
  <Card>
    <CardContent className="pt-4 flex items-center justify-between">
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold">{value}</div>
      </div>
      <div className="text-primary opacity-60">{icon}</div>
    </CardContent>
  </Card>
);

export default ManagerReview;
