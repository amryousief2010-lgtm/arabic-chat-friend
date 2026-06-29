/**
 * ⚠️ TEMPORARY DEV-ONLY DIAGNOSTICS PAGE — M4-A VERIFICATION ⚠️
 * Route: /dev/agouza-reservation-diagnostics
 * Access: General Manager / Executive Manager ONLY
 * Purpose: Test agouza reservation RPCs before wiring them to real orders (M4-B).
 *
 * REMOVAL INSTRUCTIONS:
 *   1. Delete this file: src/pages/dev/AgouzaReservationDiagnostics.tsx
 *   2. Remove the lazy import + <Route> entry from src/components/AnimatedRoutes.tsx
 *      (search for "AgouzaReservationDiagnostics")
 *   3. No DB cleanup required (RPCs and audit log table remain in place).
 */

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, ShieldAlert } from "lucide-react";

const AGOUZA_WH = "a970d469-37df-40e1-b99f-a49195a3778e";
const SHORTAGE_TEST_ORDER = "660d0771-4464-40b1-b9d3-4d78985c72e3";

type AnyObj = Record<string, any>;

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Card className="mb-4">
    <CardHeader><CardTitle className="text-lg">{title}</CardTitle></CardHeader>
    <CardContent className="space-y-3">{children}</CardContent>
  </Card>
);

const ResultBox = ({ label, data }: { label: string; data: any }) => (
  <div className="rounded-md border bg-muted/30 p-3">
    <div className="mb-1 text-xs font-semibold text-muted-foreground">{label}</div>
    <pre dir="ltr" className="max-h-96 overflow-auto text-xs whitespace-pre-wrap break-all">
      {typeof data === "string" ? data : JSON.stringify(data, null, 2)}
    </pre>
  </div>
);

export default function AgouzaReservationDiagnostics() {
  const { isGeneralManager, isExecutiveManager, loading } = useAuth();
  const allowed = isGeneralManager || isExecutiveManager;

  const [statusOrderId, setStatusOrderId] = useState(SHORTAGE_TEST_ORDER);
  const [statusResult, setStatusResult] = useState<any>(null);

  const [shortageResult, setShortageResult] = useState<any>(null);
  const [shortageAudit, setShortageAudit] = useState<any>(null);

  const [reserveOrderId, setReserveOrderId] = useState("");
  const [reserveResult, setReserveResult] = useState<any>(null);
  const [reserveAgainResult, setReserveAgainResult] = useState<any>(null);
  const [releaseResult, setReleaseResult] = useState<any>(null);
  const [reservations, setReservations] = useState<any>(null);

  const [dryOrderId, setDryOrderId] = useState("");
  const [dryRunResult, setDryRunResult] = useState<any>(null);

  // ---- Commit (TEMP / DANGEROUS) ----
  const [commitOrderId, setCommitOrderId] = useState("");
  const [commitConfirm, setCommitConfirm] = useState("");
  const [commitPreview, setCommitPreview] = useState<any>(null);
  const [commitOrderMeta, setCommitOrderMeta] = useState<any>(null);
  const [commitResult, setCommitResult] = useState<any>(null);
  const [doubleCommitResult, setDoubleCommitResult] = useState<any>(null);
  const [postCommitInfo, setPostCommitInfo] = useState<any>(null);
  const [commitRunning, setCommitRunning] = useState(false);

  if (loading) return <div className="p-8">جارٍ التحميل…</div>;
  if (!allowed) return <Navigate to="/unauthorized" replace />;


  const runStatus = async () => {
    const { data, error } = await supabase.rpc("get_agouza_order_reservation_status", { p_order_id: statusOrderId });
    setStatusResult(error ? { error: error.message } : data);
  };

  const runShortageTest = async () => {
    const { data, error } = await supabase.rpc("reserve_agouza_stock_for_order", { p_order_id: SHORTAGE_TEST_ORDER });
    setShortageResult(error ? { error: error.message } : data);
    const { data: audit } = await supabase
      .from("agouza_reservation_audit_log")
      .select("*")
      .eq("order_id", SHORTAGE_TEST_ORDER)
      .order("acted_at", { ascending: false })
      .limit(5);
    setShortageAudit(audit);
  };

  const fetchReservations = async (orderId: string) => {
    const { data } = await supabase
      .from("agouza_stock_reservations")
      .select("inventory_item_id, product_id, quantity, status, reserved_at, released_at, committed_at")
      .eq("order_id", orderId)
      .order("reserved_at", { ascending: false });
    setReservations(data);
  };

  const runReserve = async () => {
    if (!reserveOrderId) return;
    const { data, error } = await supabase.rpc("reserve_agouza_stock_for_order", { p_order_id: reserveOrderId });
    setReserveResult(error ? { error: error.message } : data);
    await fetchReservations(reserveOrderId);
  };

  const runReserveAgain = async () => {
    if (!reserveOrderId) return;
    const { data, error } = await supabase.rpc("reserve_agouza_stock_for_order", { p_order_id: reserveOrderId });
    setReserveAgainResult(error ? { error: error.message } : data);
    await fetchReservations(reserveOrderId);
  };

  const runRelease = async () => {
    if (!reserveOrderId) return;
    const { data, error } = await supabase.rpc("release_agouza_stock_reservation", {
      p_order_id: reserveOrderId,
      p_reason: "اختبار فك الحجز",
    });
    setReleaseResult(error ? { error: error.message } : data);
    await fetchReservations(reserveOrderId);
  };

  const runDryRun = async () => {
    if (!dryOrderId) return;
    const { data: status, error } = await supabase.rpc("get_agouza_order_reservation_status", { p_order_id: dryOrderId });
    if (error) { setDryRunResult({ error: error.message }); return; }
    const items = (status as AnyObj[]) || [];
    const preview = items.map((i) => ({
      product_id: i.product_id,
      inventory_item_id: i.inventory_item_id,
      requested: Number(i.requested),
      stock_before: Number(i.stock),
      stock_after_expected: Number(i.stock) - Number(i.requested),
      affected_warehouse: "العجوزة فقط",
      reservation_status: i.reservation_status,
    }));
    setDryRunResult({ preview, note: "Dry-run فقط — لم يتم تنفيذ أي خصم." });
  };

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const AGOUZA_WH_ID = AGOUZA_WH;

  const loadCommitPreview = async () => {
    setCommitResult(null); setDoubleCommitResult(null); setPostCommitInfo(null);
    setCommitPreview(null); setCommitOrderMeta(null);
    const oid = commitOrderId.trim();
    if (!UUID_RE.test(oid)) { setCommitPreview({ error: "order_id غير صحيح — يجب UUID كامل." }); return; }

    const { data: ord, error: oErr } = await supabase
      .from("orders")
      .select("id, order_number, status, source_warehouse_id, customer_id, total")
      .eq("id", oid)
      .maybeSingle();
    if (oErr || !ord) { setCommitPreview({ error: oErr?.message || "الأوردر غير موجود." }); return; }
    if (ord.source_warehouse_id !== AGOUZA_WH_ID) {
      setCommitPreview({ error: "هذا الأوردر ليس تابعاً لمخزن العجوزة — Commit مرفوض.", source_warehouse_id: ord.source_warehouse_id });
      return;
    }
    setCommitOrderMeta(ord);

    const { data: status, error: sErr } = await supabase.rpc("get_agouza_order_reservation_status", { p_order_id: oid });
    if (sErr) { setCommitPreview({ error: sErr.message }); return; }
    const items = (status as AnyObj[]) || [];
    const activeRes = items.filter((i) => i.reservation_status === "active");
    const preview = items.map((i) => ({
      product_id: i.product_id,
      inventory_item_id: i.inventory_item_id,
      requested_qty_to_deduct: Number(i.requested),
      stock_before: Number(i.stock),
      stock_after_expected: Number(i.stock) - Number(i.requested),
      warehouse: "مخزن فرع العجوزة فقط",
      reservation_status: i.reservation_status,
    }));
    setCommitPreview({
      order_id: oid,
      order_number: ord.order_number,
      lines: preview,
      total_lines: preview.length,
      active_reservations_count: activeRes.length,
      expected_inventory_movements: activeRes.length,
      blockers: activeRes.length === 0 ? ["لا توجد حجوزات active — لازم تعمل Reserve أولاً قبل Commit."] : [],
    });
  };

  const refreshPostCommit = async (oid: string, stockBeforeMap: Record<string, number>) => {
    const { data: status } = await supabase.rpc("get_agouza_order_reservation_status", { p_order_id: oid });
    const { data: res } = await supabase
      .from("agouza_stock_reservations")
      .select("inventory_item_id, product_id, quantity, status, reserved_at, released_at, committed_at")
      .eq("order_id", oid);
    const { data: movs } = await supabase
      .from("inventory_movements")
      .select("id, inventory_item_id, warehouse_id, movement_type, quantity, reference_id, reference_type, created_at, notes")
      .eq("reference_id", oid)
      .order("created_at", { ascending: false });
    const { data: audit } = await supabase
      .from("agouza_reservation_audit_log")
      .select("*")
      .eq("order_id", oid)
      .order("acted_at", { ascending: false })
      .limit(10);
    const itemIds = (status as AnyObj[] || []).map((i) => i.inventory_item_id);
    const { data: invNow } = await supabase
      .from("inventory_items")
      .select("id, warehouse_id, stock")
      .in("id", itemIds.length ? itemIds : ["00000000-0000-0000-0000-000000000000"]);
    const stockDiff = (invNow || []).map((row: any) => ({
      inventory_item_id: row.id,
      warehouse_id: row.warehouse_id,
      is_agouza: row.warehouse_id === AGOUZA_WH_ID,
      stock_before: stockBeforeMap[row.id] ?? null,
      stock_after: Number(row.stock),
      deducted: stockBeforeMap[row.id] != null ? Number(stockBeforeMap[row.id]) - Number(row.stock) : null,
    }));
    setPostCommitInfo({
      reservations: res,
      inventory_movements_for_order: movs,
      audit_log: audit,
      stock_diff: stockDiff,
      affected_warehouses: Array.from(new Set((movs || []).map((m: any) => m.warehouse_id))),
      main_warehouse_untouched: !(movs || []).some((m: any) => m.warehouse_id !== AGOUZA_WH_ID),
    });
  };

  const runCommit = async () => {
    if (commitConfirm !== "COMMIT-AGOUZA") return;
    if (!commitPreview || commitPreview.error || (commitPreview.blockers?.length ?? 0) > 0) return;
    const oid = commitOrderId.trim();
    if (!UUID_RE.test(oid)) return;
    setCommitRunning(true);
    const stockBeforeMap: Record<string, number> = {};
    (commitPreview.lines || []).forEach((l: any) => { stockBeforeMap[l.inventory_item_id] = l.stock_before; });
    const { data, error } = await supabase.rpc("commit_agouza_stock_on_delivery", { p_order_id: oid });
    setCommitResult(error ? { error: error.message } : data);
    await refreshPostCommit(oid, stockBeforeMap);
    setCommitRunning(false);
  };

  const runDoubleCommit = async () => {
    const oid = commitOrderId.trim();
    if (!UUID_RE.test(oid)) return;
    setCommitRunning(true);
    const { data, error } = await supabase.rpc("commit_agouza_stock_on_delivery", { p_order_id: oid });
    setDoubleCommitResult(error ? { error: error.message } : data);
    const stockBeforeMap: Record<string, number> = {};
    (postCommitInfo?.stock_diff || []).forEach((l: any) => { stockBeforeMap[l.inventory_item_id] = l.stock_after; });
    await refreshPostCommit(oid, stockBeforeMap);
    setCommitRunning(false);
  };


  return (
    <div className="container mx-auto max-w-5xl p-6" dir="rtl">
      <Alert variant="destructive" className="mb-6">
        <ShieldAlert className="h-5 w-5" />
        <AlertTitle>صفحة تشخيص مؤقتة — Dev Only</AlertTitle>
        <AlertDescription>
          هذه الصفحة مخصصة لاختبار RPCs الحجز قبل ربطها بالأوردرات (M4-A Verification). للمدير العام والتنفيذي فقط.
          سيتم حذفها بعد اعتماد الاختبارات.
        </AlertDescription>
      </Alert>

      <Section title="1) فحص حالة الحجز (Read-only)">
        <div className="flex gap-2">
          <Input value={statusOrderId} onChange={(e) => setStatusOrderId(e.target.value)} placeholder="order_id" />
          <Button onClick={runStatus}>فحص حالة الحجز</Button>
        </div>
        {statusResult && <ResultBox label="get_agouza_order_reservation_status" data={statusResult} />}
      </Section>

      <Section title="2) اختبار رفض الحجز بسبب العجز">
        <div className="text-sm text-muted-foreground">
          أوردر ثابت بـ 5 أصناف بعجز: <code dir="ltr">{SHORTAGE_TEST_ORDER}</code>
        </div>
        <Button onClick={runShortageTest} variant="secondary">اختبار رفض الحجز بسبب العجز</Button>
        {shortageResult && <ResultBox label="reserve (متوقع: ok=false + shortages)" data={shortageResult} />}
        {shortageAudit && <ResultBox label="آخر صفوف audit log" data={shortageAudit} />}
      </Section>

      <Section title="3) اختبار Reserve / Release الآمن (بدون أي خصم)">
        <div className="flex gap-2">
          <Input value={reserveOrderId} onChange={(e) => setReserveOrderId(e.target.value)} placeholder="order_id لأوردر عجوزة بكميات متاحة" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={runReserve}>تشغيل Reserve</Button>
          <Button onClick={runReserveAgain} variant="secondary">تشغيل Reserve مرة ثانية</Button>
          <Button onClick={runRelease} variant="outline">تشغيل Release</Button>
        </div>
        {reserveResult && <ResultBox label="Reserve #1" data={reserveResult} />}
        {reserveAgainResult && <ResultBox label="Reserve #2 (متوقع: بدون تكرار)" data={reserveAgainResult} />}
        {releaseResult && <ResultBox label="Release" data={releaseResult} />}
        {reservations && <ResultBox label="حجوزات الأوردر الحالية" data={reservations} />}
      </Section>

      <Section title="4) Dry-Run للخصم (Commit Preview) — بدون تنفيذ">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>تنويه</AlertTitle>
          <AlertDescription>
            تم استبعاد زر Commit الفعلي عمداً من هذه الصفحة. هذا قسم Dry-Run فقط يعرض ما <b>سيتم</b> خصمه دون تنفيذ.
            تنفيذ Commit الفعلي يجب أن يتم لاحقاً ضمن M4-B أو يدوياً عبر SQL Editor تحت رقابة المدير.
          </AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <Input value={dryOrderId} onChange={(e) => setDryOrderId(e.target.value)} placeholder="order_id" />
          <Button onClick={runDryRun} variant="secondary">عرض ما كان سيُخصم (Dry-Run)</Button>
        </div>
        {dryRunResult && <ResultBox label="Dry-Run Preview" data={dryRunResult} />}
      </Section>
    </div>
  );
}
