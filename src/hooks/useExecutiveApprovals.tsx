import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type ApprovalCategory = "treasury" | "meat" | "custody" | "lab";

export type ApprovalItem = {
  id: string;
  category: ApprovalCategory;
  title: string;          // نوع/منتج
  subtitle?: string;      // الخزنة/المخزن/الفاتورة
  amount?: number | null; // المبلغ
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
      const [treasuryRes, labRes, meatInvRes, meatMfgRes, custodyRes] = await Promise.all([
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
          .select("id, invoice_no, product_name, finished_qty, unit, total_manufacturing_cost, materials_total_cost, packaging_cost, status, created_at, created_by, notes")
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
      ]);

      const allCreators: string[] = [];
      [treasuryRes, labRes, meatInvRes, meatMfgRes, custodyRes].forEach((r) =>
        (r.data || []).forEach((x: any) => x.created_by && allCreators.push(x.created_by))
      );
      const profiles = await resolveProfiles(allCreators);

      const treasury: ApprovalItem[] = (treasuryRes.data || []).map((t: any) => ({
        id: t.id,
        category: "treasury",
        title: `${t.txn_type === "income" ? "إيراد" : t.txn_type === "expense" ? "مصروف" : t.txn_type === "transfer_out" ? "توريد/تحويل" : "حركة"}${t.deposit_purpose ? ` — ${t.deposit_purpose}` : ""}${t.incoming_source ? ` — ${t.incoming_source}` : ""}`,
        subtitle: `${t.reference_no || ""} ${t.counterparty ? "— " + t.counterparty : ""}${t.description ? " — " + t.description : ""}`.trim(),
        amount: Number(t.amount || 0),
        created_at: t.created_at,
        created_by: t.created_by,
        creator_name: profiles[t.created_by] || null,
        status: t.status,
        raw: t,
      }));

      const lab: ApprovalItem[] = (labRes.data || []).map((m: any) => ({
        id: m.id,
        category: "lab",
        title: `${m.movement_type === "income" ? "إيراد معمل" : "مصروف معمل"}${m.income_category ? " — " + m.income_category : ""}${m.expense_category ? " — " + m.expense_category : ""}`,
        subtitle: `${m.customer_name || m.beneficiary || ""}${m.description ? " — " + m.description : ""}`.trim() || (m.notes || ""),
        amount: Number(m.amount || 0),
        created_at: m.created_at,
        created_by: m.created_by,
        creator_name: profiles[m.created_by] || null,
        status: m.status,
        raw: m,
      }));

      const meatInv: ApprovalItem[] = (meatInvRes.data || []).map((i: any) => ({
        id: i.id,
        category: "meat",
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

      const meatMfg: ApprovalItem[] = (meatMfgRes.data || []).map((m: any) => ({
        id: m.id,
        category: "meat",
        title: `تصنيع — ${m.finished_item_name}`,
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
        title: `عهدة المسلخ — ${e.category}${e.over_limit ? " (تجاوز الحد)" : ""}`,
        subtitle: `${e.beneficiary || ""}${e.description ? " — " + e.description : ""}`.trim(),
        amount: Number(e.amount || 0),
        created_at: e.created_at,
        created_by: e.created_by,
        creator_name: profiles[e.created_by] || null,
        status: e.status,
        raw: e,
      }));

      const items: ApprovalItem[] = [...treasury, ...lab, ...meatInv, ...meatMfg, ...custody].sort(
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
        item.raw._source_table;

      const { data: fresh } = await (supabase as any).from(tbl).select("status").eq("id", item.id).maybeSingle();
      if (!fresh) throw new Error("تم التعامل مع هذا الطلب بالفعل");
      const isPending =
        (item.category === "treasury" && fresh.status === TREASURY_PENDING) ||
        (item.category === "lab" && fresh.status === LAB_PENDING) ||
        (item.category === "meat" && fresh.status === MEAT_PENDING) ||
        (item.category === "custody" && CUSTODY_PENDING.includes(fresh.status));
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
        const rpcName =
          item.raw._source_table === "meat_manufacturing_invoices"
            ? "approve_meat_manufacturing_invoice"
            : "approve_meat_factory_manufacturing";
        const param =
          item.raw._source_table === "meat_manufacturing_invoices"
            ? { p_invoice_id: item.id }
            : { p_id: item.id };
        const { error } = await (supabase as any).rpc(rpcName as any, param);
        if (error) throw error;
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
      counts: data?.counts ?? { all: 0, treasury: 0, lab: 0, meat: 0, custody: 0 },
      refetch,
      approve,
      reject,
    }),
    [isApprover, isLoading, data, refetch, approve, reject]
  );
}
