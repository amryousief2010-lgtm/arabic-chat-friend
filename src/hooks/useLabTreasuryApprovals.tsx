import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type PendingMovement = {
  id: string;
  movement_type: "income" | "expense";
  movement_date: string;
  income_category: string | null;
  expense_category: string | null;
  customer_name: string | null;
  beneficiary: string | null;
  amount: number;
  payment_method: string;
  description: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type PendingAdvanceDiff = {
  id: string;
  recipient_name: string;
  issued_at: string;
  amount: number;
  payment_method: string;
  pending_employee_amount: number;
  actual_expense_total: number;
  returned_amount: number;
  purpose: string | null;
  notes: string | null;
  created_by: string | null;
  settled_at: string | null;
  status: string;
};

export function useLabTreasuryApprovals() {
  const { user, roles, isGeneralManager, isExecutiveManager } = useAuth();
  const isApprover =
    isGeneralManager ||
    isExecutiveManager ||
    (roles || []).includes("lab_treasury_approver");

  const queryClient = useQueryClient();

  const enabled = !!user && isApprover;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["lab-treasury-approvals"],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const [movRes, advRes] = await Promise.all([
        (supabase as any)
          .from("lab_treasury_movements")
          .select(
            "id,movement_type,movement_date,income_category,expense_category,customer_name,beneficiary,amount,payment_method,description,notes,created_by,created_at"
          )
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(200),
        (supabase as any)
          .from("lab_treasury_advances")
          .select(
            "id,recipient_name,issued_at,amount,payment_method,pending_employee_amount,actual_expense_total,returned_amount,purpose,notes,created_by,settled_at,status,difference_movement_id"
          )
          .eq("status", "settled")
          .is("difference_movement_id", null)
          .gt("pending_employee_amount", 0)
          .limit(200),
      ]);

      const movements = (movRes.data || []) as PendingMovement[];
      const advances = ((advRes.data || []) as any[]).filter(
        (a) => Number(a.pending_employee_amount) > 0
      ) as PendingAdvanceDiff[];

      // Resolve creator names
      const ids = Array.from(
        new Set(
          [
            ...movements.map((m) => m.created_by),
            ...advances.map((a) => a.created_by),
          ].filter(Boolean) as string[]
        )
      );
      const profiles: Record<string, string> = {};
      if (ids.length) {
        const { data: profs } = await (supabase as any)
          .from("profiles")
          .select("id,full_name")
          .in("id", ids);
        (profs || []).forEach((p: any) => {
          profiles[p.id] = p.full_name || "";
        });
      }

      return { movements, advances, profiles };
    },
  });

  // Realtime invalidation
  useEffect(() => {
    if (!enabled) return;
    const ch = supabase
      .channel("lab-treasury-approvals-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lab_treasury_movements" },
        () => queryClient.invalidateQueries({ queryKey: ["lab-treasury-approvals"] })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lab_treasury_advances" },
        () => queryClient.invalidateQueries({ queryKey: ["lab-treasury-approvals"] })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [enabled, queryClient]);

  const movements = data?.movements ?? [];
  const advances = data?.advances ?? [];
  const profiles = data?.profiles ?? {};
  const total = movements.length + advances.length;

  const approveMovement = useCallback(
    async (m: PendingMovement) => {
      const { error } = await (supabase as any)
        .from("lab_treasury_movements")
        .update({ status: "approved" })
        .eq("id", m.id);
      if (error) throw error;
      if (user) {
        await (supabase as any).from("lab_treasury_audit_log").insert({
          action: "approve",
          movement_id: m.id,
          actor_id: user.id,
          actor_name: user.email || null,
          before_data: { status: "pending" },
          after_data: { status: "approved" },
          metadata: { source: "exec_alert_popup" },
        });
      }
      await refetch();
    },
    [user, refetch]
  );

  const rejectMovement = useCallback(
    async (m: PendingMovement, reason: string) => {
      if (!reason || reason.trim().length < 3) {
        throw new Error("سبب الرفض إلزامي (3 أحرف على الأقل)");
      }
      const { error } = await (supabase as any)
        .from("lab_treasury_movements")
        .update({ status: "rejected", rejection_reason: reason.trim() })
        .eq("id", m.id);
      if (error) throw error;
      if (user) {
        await (supabase as any).from("lab_treasury_audit_log").insert({
          action: "reject",
          movement_id: m.id,
          actor_id: user.id,
          actor_name: user.email || null,
          reason: reason.trim(),
          before_data: { status: "pending" },
          after_data: { status: "rejected" },
          metadata: { source: "exec_alert_popup" },
        });
      }
      await refetch();
    },
    [user, refetch]
  );

  const approveAdvanceDifference = useCallback(
    async (a: PendingAdvanceDiff) => {
      const { error } = await (supabase as any).rpc(
        "lab_treasury_approve_advance_difference",
        { p_advance_id: a.id }
      );
      if (error) throw error;
      await refetch();
    },
    [refetch]
  );

  const rejectAdvance = useCallback(
    async (a: PendingAdvanceDiff, reason: string) => {
      if (!reason || reason.trim().length < 3) {
        throw new Error("سبب الرفض إلزامي (3 أحرف على الأقل)");
      }
      const { error } = await (supabase as any).rpc(
        "lab_treasury_cancel_advance",
        { p_advance_id: a.id, p_reason: reason.trim() }
      );
      if (error) throw error;
      await refetch();
    },
    [refetch]
  );

  return useMemo(
    () => ({
      isApprover,
      isLoading,
      movements,
      advances,
      profiles,
      total,
      refetch,
      approveMovement,
      rejectMovement,
      approveAdvanceDifference,
      rejectAdvance,
    }),
    [
      isApprover,
      isLoading,
      movements,
      advances,
      profiles,
      total,
      refetch,
      approveMovement,
      rejectMovement,
      approveAdvanceDifference,
      rejectAdvance,
    ]
  );
}
