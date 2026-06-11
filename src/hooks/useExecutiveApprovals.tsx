import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type ApprovalCategory = "treasury" | "meat" | "custody" | "slaughter" | "lab";

export type ApprovalItem = {
  id: string;
  category: ApprovalCategory;
  source: string;         // human-readable source label (e.g. "فاتورة تصنيع", "تصنيع داخلي", "تقسيمة دبح")
  title: string;
  subtitle?: string;
  amount?: number | null;
  qty?: number | null;
  unit?: string | null;
  created_at: string;
  created_by?: string | null;
  creator_name?: string | null;
  status: string;
  raw: any;
};

const TREASURY_PENDING = "pending_approval";
const LAB_PENDING = "pending";
const MEAT_PENDING = "draft";
const CUSTODY_PENDING = ["pending_review", "over_limit_pending"];
const SLAUGHTER_BATCH_PENDING = "pending";

async function resolveProfiles(ids: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return {};
  const { data } = await (supabase as any)
    .from("profiles")
    .select("id, full_name")
    .in("id", unique);
  const map: Record<string, string> = {};
  (data || []).forEach((p: any) => (map[p.id] = p.full_name || ""));
  return map;
}

export function useExecutiveApprovals() {
  const { user, roles, isGeneralManager, isExecutiveManager } = useAuth();
  const isApprover = isGeneralManager || isExecutiveManager;
  const queryClient = useQueryClient();
  const enabled = !!user && isApprover;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["executive-approvals"],
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
    queryFn: async () => {
      const [treasuryRes, labRes, meatInvRes, meatMfgRes, custodyRes, slaughterRes] = await Promise.all([
        (supabase as any)
          .from("main_treasury_transactions")
          .select("id, reference_no, txn_type, amount, txn_date, counterparty, description, status, created_at, created_by, payment_method, deposit_purpose, incoming_source")
          .eq("status", TREASURY_PENDING)
          .order("created_at", { ascending: false })
          .limit(200),
        (supabase as any)
          .from("lab_treasury_movements")
          .select("id, movement_type, movement_date, income_category, expense_category, customer_name, beneficiary, amount, payment_method, description, notes, created_by, created_at, status")
          .eq("status", LAB_PENDING)
          .order("created_at", { ascending: false })
          .limit(200),
        (supabase as any)
          .from("meat_manufacturing_invoices")
          .select("id, invoice_no, product_name, finished_qty, unit, total_manufacturing_cost, materials_total_cost, packaging_cost, status, created_at, created_by, notes, manufacturing_invoice_uuid")
          .eq("status", MEAT_PENDING)
          .order("created_at", { ascending: false })
          .limit(200),
        (supabase as any)
          .from("meat_factory_manufacturing")
          .select("id, invoice_number, finished_item_name, produced_qty, total_cost, status, created_at, created_by, notes, mfg_date")
          .eq("status", MEAT_PENDING)
          .order("created_at", { ascending: false })
          .limit(200),
        (supabase as any)
          .from("slaughter_custody_expenses")
          .select("id, expense_date, category, description, amount, payment_method, beneficiary, status, over_limit, created_by, created_at, notes")
          .in("status", CUSTODY_PENDING)
          .order("created_at", { ascending: false })
          .limit(200),
        (supabase as any)
          .from("slaughter_batches")
          .select("id, batch_number, slaughter_date, shift, birds_slaughtered, total_live_weight_kg, total_meat_kg, actual_yield_pct, approval_status, created_at, created_by, notes")
          .eq("approval_status", SLAUGHTER_BATCH_PENDING)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);

      const allCreators: string[] = [];
      [treasuryRes, labRes, meatInvRes, meatMfgRes, custodyRes, slaughterRes].forEach((r) =>
        (r.data || []).forEach((x: any) => x.created_by && allCreators.push(x.created_by))
      );
      const profiles = await resolveProfiles(allCreators);

      const treasury: ApprovalItem[] = (treasuryRes.data || []).map((t: any) => {
        const isToCustody = t.txn_type === "transfer_to_custody";
        const typeLabel =
          isToCustody ? "توريد إلى خزنة العهدة"
          : t.txn_type === "income" ? "إيراد"
          : t.txn_type === "expense" ? "مصروف"
          : t.txn_type === "transfer_out" ? "توريد/تحويل"
          : "حركة";
        const title = `${typeLabel}${t.deposit_purpose ? ` — ${t.deposit_purpose}` : ""}${t.incoming_source ? ` — ${t.incoming_source}` : ""}`;
        const keeperPart = isToCustody && t.counterparty ? `أمين العهدة: ${t.counterparty}` : "";
        const subtitleParts = [
          t.reference_no || "",
          keeperPart,
          !isToCustody && t.counterparty ? t.counterparty : "",
          t.description || "",
          t.payment_method ? `طريقة: ${t.payment_method}` : "",
        ].filter(Boolean);
        return {
          id: t.id,
          category: "treasury",
          source: isToCustody ? "توريد للخزنة العهدة" : "حركة خزنة رئيسية",
          title,
          subtitle: subtitleParts.join(" — "),
          amount: Number(t.amount || 0),
          created_at: t.created_at,
          created_by: t.created_by,
          creator_name: profiles[t.created_by] || null,
          status: t.status,
          raw: t,
        };
      });

      const lab: ApprovalItem[] = (labRes.data || []).map((m: any) => ({
        id: m.id,
        category: "lab",
        source: "خزنة المعمل",
        title: `${m.movement_type === "income" ? "إيراد معمل" : "مصروف معمل"}${m.income_category ? " — " + m.income_category : ""}${m.expense_category ? " — " + m.expense_category : ""}`,
        subtitle: `${m.customer_name || m.beneficiary || ""}${m.description ? " — " + m.description : ""}`.trim() || (m.notes || ""),
        amount: Number(m.amount || 0),
        created_at: m.created_at,
        created_by: m.created_by,
        creator_name: profiles[m.created_by] || null,
        status: m.status,
        raw: m,
      }));

      // Build meat list with defensive de-duplication:
      // - meat_manufacturing_invoices = formal invoice with material lines + warehouse transfer (the authoritative invoice)
      // - meat_factory_manufacturing  = lighter internal production record (separate workflow)
      // They are two independent flows today. If a meat_factory_manufacturing row is ever linked to an
      // invoice via manufacturing_invoice_uuid, hide it from the queue so the same item never appears twice.
      const linkedInvoiceIds = new Set(
        (meatInvRes.data || []).map((i: any) => i.manufacturing_invoice_uuid).filter(Boolean)
      );

      const meatInv: ApprovalItem[] = (meatInvRes.data || []).map((i: any) => ({
        id: i.id,
        category: "meat",
        source: "فاتورة تصنيع رسمية",
        title: `فاتورة تصنيع — ${i.product_name}`,
        subtitle: `${i.invoice_no}${i.notes ? " — " + i.notes : ""}`,
        amount: Number(i.total_manufacturing_cost || i.materials_total_cost || 0),
        qty: Number(i.finished_qty || 0),
        unit: i.unit,
        created_at: i.created_at,
        created_by: i.created_by,
        creator_name: profiles[i.created_by] || null,
        status: i.status,
        raw: { ...i, _source_table: "meat_manufacturing_invoices" },
      }));

      const meatMfg: ApprovalItem[] = (meatMfgRes.data || [])
        .filter((m: any) => !linkedInvoiceIds.has(m.id))
        .map((m: any) => ({
          id: m.id,
          category: "meat" as ApprovalCategory,
          source: "تصنيع داخلي",
          title: `تصنيع داخلي — ${m.finished_item_name}`,
          subtitle: `${m.invoice_number}${m.notes ? " — " + m.notes : ""}`,
          amount: Number(m.total_cost || 0),
          qty: Number(m.produced_qty || 0),
          created_at: m.created_at,
          created_by: m.created_by,
          creator_name: profiles[m.created_by] || null,
          status: m.status,
          raw: { ...m, _source_table: "meat_factory_manufacturing" },
        }));

      const custody: ApprovalItem[] = (custodyRes.data || []).map((e: any) => ({
        id: e.id,
        category: "custody",
        source: "مصروف عهدة المسلخ",
        title: `مصروف عهدة — ${e.category}${e.over_limit ? " (تجاوز الحد)" : ""}`,
        subtitle: `${e.beneficiary || ""}${e.description ? " — " + e.description : ""}`.trim(),
        amount: Number(e.amount || 0),
        created_at: e.created_at,
        created_by: e.created_by,
        creator_name: profiles[e.created_by] || null,
        status: e.status,
        raw: e,
      }));

      const slaughter: ApprovalItem[] = (slaughterRes.data || []).map((b: any) => ({
        id: b.id,
        category: "slaughter",
        source: "تقسيمة دبح نعام",
        title: `تقسيمة ${b.batch_number} — ${b.birds_slaughtered || 0} نعامة`,
        subtitle: `وزن حي: ${Number(b.total_live_weight_kg || 0).toFixed(1)} كجم • لحم ناتج: ${Number(b.total_meat_kg || 0).toFixed(1)} كجم • نسبة التصافي: ${Number(b.actual_yield_pct || 0).toFixed(1)}%${b.notes ? " — " + b.notes : ""}`,
        amount: null,
        qty: Number(b.birds_slaughtered || 0),
        unit: "نعامة",
        created_at: b.created_at,
        created_by: b.created_by,
        creator_name: profiles[b.created_by] || null,
        status: b.approval_status,
        raw: b,
      }));

      const items: ApprovalItem[] = [...treasury, ...lab, ...meatInv, ...meatMfg, ...custody, ...slaughter].sort(
        (a, b) => +new Date(b.created_at) - +new Date(a.created_at)
      );

      return {
        items,
        counts: {
          all: items.length,
          treasury: treasury.length,
          lab: lab.length,
          meat: meatInv.length + meatMfg.length,
          custody: custody.length,
          slaughter: slaughter.length,
        },
      };
    },
  });

  // Realtime invalidation across all approval tables
  useEffect(() => {
    if (!enabled) return;
    const channelName = `exec-approvals-rt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ch = supabase
      .channel(channelName)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "main_treasury_transactions" }, () =>
        queryClient.invalidateQueries({ queryKey: ["executive-approvals"] })
      )
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "lab_treasury_movements" }, () =>
        queryClient.invalidateQueries({ queryKey: ["executive-approvals"] })
      )
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "meat_manufacturing_invoices" }, () =>
        queryClient.invalidateQueries({ queryKey: ["executive-approvals"] })
      )
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "meat_factory_manufacturing" }, () =>
        queryClient.invalidateQueries({ queryKey: ["executive-approvals"] })
      )
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "slaughter_custody_expenses" }, () =>
        queryClient.invalidateQueries({ queryKey: ["executive-approvals"] })
      )
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "slaughter_batches" }, () =>
        queryClient.invalidateQueries({ queryKey: ["executive-approvals"] })
      )
      .subscribe();
    return () => {
      try { supabase.removeChannel(ch); } catch {}
    };
  }, [enabled, queryClient]);

  // ─── Approve / Reject helpers ─────────────────────────────────────────
  const approve = useCallback(
    async (item: ApprovalItem) => {
      // Guard against duplicate: re-check current status
      const tbl =
        item.category === "treasury" ? "main_treasury_transactions" :
        item.category === "lab" ? "lab_treasury_movements" :
        item.category === "custody" ? "slaughter_custody_expenses" :
        item.category === "slaughter" ? "slaughter_batches" :
        item.raw._source_table;

      const statusCol = item.category === "slaughter" ? "approval_status" : "status";
      const { data: fresh } = await (supabase as any).from(tbl).select(statusCol).eq("id", item.id).maybeSingle();
      if (!fresh) throw new Error("تم التعامل مع هذا الطلب بالفعل");
      const freshStatus = (fresh as any)[statusCol];
      const isPending =
        (item.category === "treasury" && freshStatus === TREASURY_PENDING) ||
        (item.category === "lab" && freshStatus === LAB_PENDING) ||
        (item.category === "meat" && freshStatus === MEAT_PENDING) ||
        (item.category === "custody" && CUSTODY_PENDING.includes(freshStatus)) ||
        (item.category === "slaughter" && freshStatus === SLAUGHTER_BATCH_PENDING);
      if (!isPending) throw new Error("تم التعامل مع هذا الطلب بالفعل");

      if (item.category === "treasury") {
        const { error } = await (supabase as any).rpc("mt_approve_txn", { p_txn_id: item.id });
        if (error) throw error;
      } else if (item.category === "lab") {
        const { error } = await (supabase as any)
          .from("lab_treasury_movements")
          .update({ status: "approved" })
          .eq("id", item.id);
        if (error) throw error;
        if (user) {
          await (supabase as any).from("lab_treasury_audit_log").insert({
            action: "approve",
            movement_id: item.id,
            actor_id: user.id,
            actor_name: user.email || null,
            before_data: { status: "pending" },
            after_data: { status: "approved" },
            metadata: { source: "executive_approvals" },
          });
        }
      } else if (item.category === "meat") {
        if (item.raw._source_table === "meat_manufacturing_invoices") {
          const { error } = await (supabase as any).rpc("approve_meat_manufacturing_invoice" as any, { p_invoice_id: item.id });
          if (error) throw error;
        } else {
          // meat_factory_manufacturing — direct status update (no RPC defined)
          const { error } = await (supabase as any)
            .from("meat_factory_manufacturing")
            .update({
              status: "approved",
              approved_by: user?.id,
              approved_at: new Date().toISOString(),
            })
            .eq("id", item.id);
          if (error) throw error;
        }
        if (user) {
          await (supabase as any).from("manager_review_audit").insert({
            action: "approve",
            module: "meat_factory",
            target_table: item.raw._source_table,
            target_id: item.id,
            performed_by: user.id,
            new_value: { status: "approved" },
          });
        }
      } else if (item.category === "custody") {
        const { error } = await (supabase as any)
          .from("slaughter_custody_expenses")
          .update({
            status: "approved",
            approved_by: user?.id,
            approved_at: new Date().toISOString(),
          })
          .eq("id", item.id);
        if (error) throw error;
        if (user) {
          await (supabase as any).from("slaughter_custody_audit_log").insert({
            action: "approve",
            entity: "expense",
            entity_id: item.id,
            actor_id: user.id,
            payload: { source: "executive_approvals", amount: item.amount },
          });
        }
      } else if (item.category === "slaughter") {
        const { error } = await (supabase as any).rpc("approve_slaughter_batch" as any, { p_batch_id: item.id });
        if (error) throw error;
        // RPC writes its own audit row.
      }
      await refetch();
    },
    [user, refetch]
  );

  const reject = useCallback(
    async (item: ApprovalItem, reason: string) => {
      if (!reason || reason.trim().length < 3) {
        throw new Error("سبب الرفض إلزامي (3 أحرف على الأقل)");
      }
      const r = reason.trim();

      if (item.category === "treasury") {
        const { error } = await (supabase as any).rpc("mt_reject_txn", { p_txn_id: item.id, p_reason: r });
        if (error) throw error;
      } else if (item.category === "lab") {
        const { error } = await (supabase as any)
          .from("lab_treasury_movements")
          .update({ status: "rejected", rejection_reason: r })
          .eq("id", item.id);
        if (error) throw error;
        if (user) {
          await (supabase as any).from("lab_treasury_audit_log").insert({
            action: "reject",
            movement_id: item.id,
            actor_id: user.id,
            actor_name: user.email || null,
            reason: r,
            before_data: { status: "pending" },
            after_data: { status: "rejected" },
            metadata: { source: "executive_approvals" },
          });
        }
      } else if (item.category === "meat") {
        const { error } = await (supabase as any)
          .from(item.raw._source_table)
          .update({ status: "cancelled", notes: `[رفض] ${r}` })
          .eq("id", item.id);
        if (error) throw error;
        if (user) {
          await (supabase as any).from("manager_review_audit").insert({
            action: "reject",
            module: "meat_factory",
            target_table: item.raw._source_table,
            target_id: item.id,
            reason: r,
            performed_by: user.id,
            new_value: { status: "cancelled" },
          });
        }
      } else if (item.category === "custody") {
        const { error } = await (supabase as any)
          .from("slaughter_custody_expenses")
          .update({ status: "rejected", rejection_reason: r, reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
          .eq("id", item.id);
        if (error) throw error;
        if (user) {
          await (supabase as any).from("slaughter_custody_audit_log").insert({
            action: "reject",
            entity: "expense",
            entity_id: item.id,
            actor_id: user.id,
            payload: { source: "executive_approvals", reason: r },
          });
        }
      } else if (item.category === "slaughter") {
        const { error } = await (supabase as any).rpc("reject_slaughter_batch" as any, { p_batch_id: item.id, p_reason: r });
        if (error) throw error;
      }
      await refetch();
    },
    [user, refetch]
  );

  return useMemo(
    () => ({
      isApprover,
      isLoading,
      items: data?.items ?? [],
      counts: data?.counts ?? { all: 0, treasury: 0, lab: 0, meat: 0, custody: 0, slaughter: 0 },
      refetch,
      approve,
      reject,
    }),
    [isApprover, isLoading, data, refetch, approve, reject]
  );
}
