
# Phase 5D UI — Ready to implement

The system is still in plan mode. Click the **Implement plan** button below this message to switch to build mode, and I will execute immediately.

## What will happen the moment you click

**No DB changes.** All six planning RPCs already exist (verified): `generate_stock_reconciliation_proposals()`, `submit_proposal_for_review(p_id, p_note)`, `approve_proposal_for_future(p_id, p_note)`, `reject_proposal(p_id, p_note)`, `dismiss_proposal(p_id, p_reason)`, `request_proposal_investigation(p_id, p_note)`. Status CHECK values verified: `draft`, `pending_review`, `approved_for_future_execution`, `rejected`, `dismissed`. No migration, no triggers, no RLS edits.

**Baseline (captured now, will be re-checked after):**
- `SUM(products.stock)` = 229
- `SUM(inventory_items.stock)` = 62 824.568
- `COUNT(inventory_movements)` = 145

**Three files, UI only:**

1. **Create** `src/pages/StockReconciliation.tsx` — Arabic RTL, warning banner "هذه الشاشة للتخطيط والمراجعة فقط — لا يتم تعديل المخزون من هنا."; header "تحديث" + "توليد المقترحات" (confirm dialog → rpc); three tabs: **المقترحات** (filters: search, issue_type, risk_level, status; row → details Dialog with the five action buttons — إرسال للمراجعة, اعتماد للتنفيذ المستقبلي [with "لن يتم تعديل أي مخزون الآن" notice], رفض, طلب فحص, إلغاء بسبب [reason required]), **جاهزية العجوزة** (read-only `v_agouza_readiness`), **سجل اللقطات** (`products_stock_snapshot_5d` grouped by `batch_id`). No Delete / Execute / Apply / Transfer buttons.
2. **Edit** `src/components/AnimatedRoutes.tsx` — import `StockReconciliation`, add `/stock-reconciliation` route inside `<ProtectedRoute allowedRoles={['general_manager','executive_manager','warehouse_supervisor']}>` + `<PageTransition>`.
3. **Edit** `src/components/layout/SidebarMenuSections.tsx` — in section "9. المخازن" add `{ ShieldCheck, "مطابقة المخزون (تخطيط)", "/stock-reconciliation", ['general_manager','executive_manager','warehouse_supervisor'] }`.

## Completion report I will send right after

Real before/after for the three baseline counts, files created/updated, route added, sidebar entry added, allowed roles, confirmations (no Delete button, no stock-execution button, no DELETE policy, no order-status change, no legacy trigger touched, service_role not used, RLS unchanged), tabs/actions description, recommendation on Phase 5E readiness. **Stop.**
