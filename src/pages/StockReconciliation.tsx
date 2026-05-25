import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, RefreshCw, Sparkles, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

type Proposal = {
  proposal_id: string;
  product_id: string;
  barcode: string | null;
  product_name: string | null;
  legacy_stock: number | null;
  main_warehouse_stock: number | null;
  agouza_warehouse_stock: number | null;
  total_sales_inventory_stock: number | null;
  difference: number | null;
  issue_type: string;
  proposed_action: string;
  proposed_adjustment_qty: number | null;
  reason: string | null;
  risk_level: string;
  requires_manager_approval: boolean | null;
  status: string;
  created_at: string;
  updated_at: string | null;
  audit_notes: any;
};

type AgouzaRow = {
  product_id: string;
  barcode: string | null;
  product_name: string | null;
  is_active: boolean | null;
  demand_qty: number | null;
  agouza_stock: number | null;
  main_stock: number | null;
  shortage: number | null;
  suggested_transfer: number | null;
  main_sufficient: boolean | null;
};

type SnapshotRow = {
  id: string;
  batch_id: string | null;
  product_id: string;
  legacy_stock_before: number | null;
  inventory_stock_before: number | null;
  main_stock_before: number | null;
  agouza_stock_before: number | null;
  snapped_at: string;
  reason: string | null;
  notes: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "مسودة",
  pending_review: "بانتظار المراجعة",
  approved_for_future_execution: "معتمد للتنفيذ المستقبلي",
  rejected: "مرفوض",
  dismissed: "مُلغى",
};

const RISK_LABEL: Record<string, string> = {
  low: "منخفض",
  medium: "متوسط",
  high: "مرتفع",
  critical: "حرج",
};

const ISSUE_LABEL: Record<string, string> = {
  legacy_gt_inventory: "Legacy > Inventory",
  inventory_gt_legacy: "Inventory > Legacy",
  missing_inventory_row: "صف مخزون مفقود",
  inactive_product: "منتج غير نشط",
  missing_barcode: "باركود مفقود",
  agouza_zero_with_demand: "العجوزة صفر مع طلب",
  matched: "مطابق",
};

const num = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : Number(v).toLocaleString("ar-EG");

export default function StockReconciliation() {
  const [tab, setTab] = useState("proposals");
  const [loading, setLoading] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [agouza, setAgouza] = useState<AgouzaRow[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);

  const [search, setSearch] = useState("");
  const [issueType, setIssueType] = useState<string>("all");
  const [risk, setRisk] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");

  const [active, setActive] = useState<Proposal | null>(null);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [actionKind, setActionKind] = useState<null | "submit" | "approve" | "reject" | "dismiss" | "investigate">(null);
  const [actionNote, setActionNote] = useState("");
  const [busy, setBusy] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [pRes, aRes, sRes] = await Promise.all([
        supabase
          .from("stock_reconciliation_proposals")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase.from("v_agouza_readiness").select("*").limit(1000),
        supabase
          .from("products_stock_snapshot_5d")
          .select("*")
          .order("snapped_at", { ascending: false })
          .limit(1000),
      ]);
      if (pRes.error) throw pRes.error;
      if (aRes.error) throw aRes.error;
      if (sRes.error) throw sRes.error;
      setProposals((pRes.data as Proposal[]) || []);
      setAgouza((aRes.data as AgouzaRow[]) || []);
      setSnapshots((sRes.data as SnapshotRow[]) || []);
    } catch (e: any) {
      toast.error(`فشل التحميل: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return proposals.filter((p) => {
      if (issueType !== "all" && p.issue_type !== issueType) return false;
      if (risk !== "all" && p.risk_level !== risk) return false;
      if (status !== "all" && p.status !== status) return false;
      if (q) {
        const hay = `${p.barcode ?? ""} ${p.product_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [proposals, search, issueType, risk, status]);

  const issueTypes = useMemo(
    () => Array.from(new Set(proposals.map((p) => p.issue_type))).sort(),
    [proposals]
  );

  const runGenerate = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("generate_stock_reconciliation_proposals" as any);
      if (error) throw error;
      const row = Array.isArray(data) ? (data[0] as any) : (data as any);
      toast.success(
        `تم التوليد: معالجة ${row?.total_processed ?? "?"} / مُدرج ${row?.inserted ?? "?"} / محدّث ${row?.updated ?? "?"}`
      );
      setConfirmGenerate(false);
      await loadAll();
    } catch (e: any) {
      toast.error(`فشل التوليد: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const runAction = async () => {
    if (!active || !actionKind) return;
    if (actionKind === "dismiss" && actionNote.trim().length === 0) {
      toast.error("سبب الإلغاء مطلوب");
      return;
    }
    setBusy(true);
    try {
      const fn =
        actionKind === "submit" ? "submit_proposal_for_review"
        : actionKind === "approve" ? "approve_proposal_for_future"
        : actionKind === "reject" ? "reject_proposal"
        : actionKind === "dismiss" ? "dismiss_proposal"
        : "request_proposal_investigation";

      const args: Record<string, any> = { p_id: active.proposal_id };
      if (actionKind === "dismiss") args.p_reason = actionNote.trim();
      else args.p_note = actionNote.trim() || null;

      const { error } = await supabase.rpc(fn as any, args);
      if (error) throw error;
      toast.success("تم تنفيذ الإجراء");
      setActionKind(null);
      setActionNote("");
      setActive(null);
      await loadAll();
    } catch (e: any) {
      toast.error(`فشل الإجراء: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const riskColor = (r: string) =>
    r === "critical" || r === "high" ? "destructive"
    : r === "medium" ? "default"
    : "secondary";

  const statusColor = (s: string) =>
    s === "approved_for_future_execution" ? "default"
    : s === "rejected" || s === "dismissed" ? "secondary"
    : "outline";

  const groupedSnapshots = useMemo(() => {
    const map = new Map<string, SnapshotRow[]>();
    for (const r of snapshots) {
      const k = r.batch_id ?? "no-batch";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return Array.from(map.entries());
  }, [snapshots]);

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">مطابقة المخزون (تخطيط)</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadAll} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ml-1 ${loading ? "animate-spin" : ""}`} />
            تحديث
          </Button>
          <Button onClick={() => setConfirmGenerate(true)} disabled={busy}>
            <Sparkles className="w-4 h-4 ml-1" />
            توليد المقترحات
          </Button>
        </div>
      </div>

      <Card className="border-amber-400/50 bg-amber-50/60 dark:bg-amber-950/20">
        <CardContent className="p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm font-medium leading-relaxed">
            هذه الشاشة للتخطيط والمراجعة فقط — لا يتم تعديل المخزون من هنا.
          </p>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="proposals">المقترحات ({proposals.length})</TabsTrigger>
          <TabsTrigger value="agouza">جاهزية العجوزة ({agouza.length})</TabsTrigger>
          <TabsTrigger value="snapshots">سجل اللقطات ({snapshots.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="proposals" className="space-y-3">
          <Card>
            <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
              <Input
                placeholder="بحث بالباركود أو اسم المنتج"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Select value={issueType} onValueChange={setIssueType}>
                <SelectTrigger><SelectValue placeholder="نوع المشكلة" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل أنواع المشاكل</SelectItem>
                  {issueTypes.map((t) => (
                    <SelectItem key={t} value={t}>{ISSUE_LABEL[t] ?? t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={risk} onValueChange={setRisk}>
                <SelectTrigger><SelectValue placeholder="مستوى الخطر" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المستويات</SelectItem>
                  {Object.entries(RISK_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue placeholder="الحالة" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحالات</SelectItem>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">المنتج</TableHead>
                    <TableHead className="text-right">الباركود</TableHead>
                    <TableHead className="text-right">نوع المشكلة</TableHead>
                    <TableHead className="text-right">الخطر</TableHead>
                    <TableHead className="text-right">Legacy</TableHead>
                    <TableHead className="text-right">Main</TableHead>
                    <TableHead className="text-right">Agouza</TableHead>
                    <TableHead className="text-right">الفرق</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">لا توجد مقترحات</TableCell></TableRow>
                  )}
                  {filtered.map((p) => (
                    <TableRow key={p.proposal_id} className="cursor-pointer" onClick={() => setActive(p)}>
                      <TableCell className="font-medium">{p.product_name ?? "—"}</TableCell>
                      <TableCell>{p.barcode ?? "—"}</TableCell>
                      <TableCell>{ISSUE_LABEL[p.issue_type] ?? p.issue_type}</TableCell>
                      <TableCell><Badge variant={riskColor(p.risk_level) as any}>{RISK_LABEL[p.risk_level] ?? p.risk_level}</Badge></TableCell>
                      <TableCell>{num(p.legacy_stock)}</TableCell>
                      <TableCell>{num(p.main_warehouse_stock)}</TableCell>
                      <TableCell>{num(p.agouza_warehouse_stock)}</TableCell>
                      <TableCell>{num(p.difference)}</TableCell>
                      <TableCell><Badge variant={statusColor(p.status) as any}>{STATUS_LABEL[p.status] ?? p.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agouza">
          <Card>
            <CardHeader><CardTitle>جاهزية مخزن العجوزة (للقراءة فقط)</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">المنتج</TableHead>
                    <TableHead className="text-right">الباركود</TableHead>
                    <TableHead className="text-right">الطلب</TableHead>
                    <TableHead className="text-right">العجوزة</TableHead>
                    <TableHead className="text-right">Main</TableHead>
                    <TableHead className="text-right">العجز</TableHead>
                    <TableHead className="text-right">التحويل المقترح</TableHead>
                    <TableHead className="text-right">Main كافي؟</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agouza.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">لا توجد بيانات</TableCell></TableRow>
                  )}
                  {agouza.map((r) => (
                    <TableRow key={r.product_id}>
                      <TableCell className="font-medium">{r.product_name ?? "—"}</TableCell>
                      <TableCell>{r.barcode ?? "—"}</TableCell>
                      <TableCell>{num(r.demand_qty)}</TableCell>
                      <TableCell>{num(r.agouza_stock)}</TableCell>
                      <TableCell>{num(r.main_stock)}</TableCell>
                      <TableCell>{num(r.shortage)}</TableCell>
                      <TableCell>{num(r.suggested_transfer)}</TableCell>
                      <TableCell>
                        <Badge variant={r.main_sufficient ? "default" : "destructive"}>
                          {r.main_sufficient ? "نعم" : "لا"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="snapshots" className="space-y-3">
          {groupedSnapshots.length === 0 && (
            <Card><CardContent className="text-center text-muted-foreground py-8">لا توجد لقطات</CardContent></Card>
          )}
          {groupedSnapshots.map(([batchId, rows]) => (
            <Card key={batchId}>
              <CardHeader>
                <CardTitle className="text-base">
                  دفعة: {batchId === "no-batch" ? "بدون دفعة" : batchId.slice(0, 8)}
                  <span className="text-xs text-muted-foreground mr-2">
                    — {rows.length} صف — {new Date(rows[0].snapped_at).toLocaleString("ar-EG")}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">Product ID</TableHead>
                      <TableHead className="text-right">Legacy قبل</TableHead>
                      <TableHead className="text-right">Inventory قبل</TableHead>
                      <TableHead className="text-right">Main قبل</TableHead>
                      <TableHead className="text-right">Agouza قبل</TableHead>
                      <TableHead className="text-right">السبب</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 50).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.product_id.slice(0, 8)}</TableCell>
                        <TableCell>{num(r.legacy_stock_before)}</TableCell>
                        <TableCell>{num(r.inventory_stock_before)}</TableCell>
                        <TableCell>{num(r.main_stock_before)}</TableCell>
                        <TableCell>{num(r.agouza_stock_before)}</TableCell>
                        <TableCell className="text-xs">{r.reason ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {rows.length > 50 && (
                  <div className="p-2 text-center text-xs text-muted-foreground">
                    (عرض أول 50 من {rows.length})
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      <Dialog open={!!active && actionKind === null} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>تفاصيل المقترح</DialogTitle>
          </DialogHeader>
          {active && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><b>المنتج:</b> {active.product_name ?? "—"}</div>
                <div><b>الباركود:</b> {active.barcode ?? "—"}</div>
                <div><b>نوع المشكلة:</b> {ISSUE_LABEL[active.issue_type] ?? active.issue_type}</div>
                <div><b>الخطر:</b> {RISK_LABEL[active.risk_level] ?? active.risk_level}</div>
                <div><b>Legacy:</b> {num(active.legacy_stock)}</div>
                <div><b>Main:</b> {num(active.main_warehouse_stock)}</div>
                <div><b>Agouza:</b> {num(active.agouza_warehouse_stock)}</div>
                <div><b>Sales Inventory:</b> {num(active.total_sales_inventory_stock)}</div>
                <div><b>الفرق:</b> {num(active.difference)}</div>
                <div><b>الإجراء المقترح:</b> {active.proposed_action}</div>
                <div><b>كمية التعديل المقترحة:</b> {num(active.proposed_adjustment_qty)}</div>
                <div><b>الحالة:</b> {STATUS_LABEL[active.status] ?? active.status}</div>
              </div>
              {active.reason && (
                <div className="p-2 bg-muted rounded text-xs">{active.reason}</div>
              )}
              {Array.isArray(active.audit_notes) && active.audit_notes.length > 0 && (
                <div className="space-y-1">
                  <div className="font-semibold text-xs">سجل التدقيق:</div>
                  <pre className="text-[10px] bg-muted p-2 rounded overflow-x-auto max-h-40">
                    {JSON.stringify(active.audit_notes, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            {active?.status === "draft" && (
              <Button variant="outline" onClick={() => { setActionKind("submit"); setActionNote(""); }}>
                إرسال للمراجعة
              </Button>
            )}
            {(active?.status === "draft" || active?.status === "pending_review") && (
              <>
                <Button onClick={() => { setActionKind("approve"); setActionNote(""); }}>
                  اعتماد للتنفيذ المستقبلي
                </Button>
                <Button variant="destructive" onClick={() => { setActionKind("reject"); setActionNote(""); }}>
                  رفض
                </Button>
                <Button variant="outline" onClick={() => { setActionKind("investigate"); setActionNote(""); }}>
                  طلب فحص
                </Button>
              </>
            )}
            {active && active.status !== "approved_for_future_execution" && active.status !== "dismissed" && (
              <Button variant="secondary" onClick={() => { setActionKind("dismiss"); setActionNote(""); }}>
                إلغاء بسبب
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={actionKind !== null} onOpenChange={(o) => !o && setActionKind(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {actionKind === "submit" && "إرسال للمراجعة"}
              {actionKind === "approve" && "اعتماد للتنفيذ المستقبلي"}
              {actionKind === "reject" && "رفض المقترح"}
              {actionKind === "dismiss" && "إلغاء المقترح (سبب مطلوب)"}
              {actionKind === "investigate" && "طلب فحص"}
            </DialogTitle>
          </DialogHeader>
          {actionKind === "approve" && (
            <p className="text-xs text-muted-foreground">
              ملاحظة: هذا اعتماد للتنفيذ المستقبلي فقط — لن يتم تعديل أي مخزون الآن.
            </p>
          )}
          <div className="space-y-2">
            <Label>
              {actionKind === "dismiss" ? "السبب (إلزامي)" : "ملاحظة (اختياري)"}
            </Label>
            <Textarea
              value={actionNote}
              onChange={(e) => setActionNote(e.target.value)}
              rows={3}
              placeholder={actionKind === "dismiss" ? "اكتب سبب الإلغاء..." : "اكتب ملاحظة..."}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setActionKind(null)} disabled={busy}>إلغاء</Button>
            <Button onClick={runAction} disabled={busy}>تأكيد</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmGenerate} onOpenChange={setConfirmGenerate}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>توليد المقترحات</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم توليد مقترحات مطابقة جديدة من بيانات المطابقة الحالية.
              لن يتم تعديل المخزون. هل تريد المتابعة؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={runGenerate} disabled={busy}>تأكيد التوليد</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
